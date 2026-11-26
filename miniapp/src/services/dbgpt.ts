import Taro from '@tarojs/taro';
import { ChatMode } from '@/types/chat';
import { sanitizeAnswer } from '@/utils/answerFormat';
import { streamDemoAnswer } from '@/services/demo';

const DEFAULT_BASE = 'http://127.0.0.1:15670';
const MODEL_NAME = 'qwen3.8-flash-next';

export function getBaseUrl(): string {
  try {
    const v = Taro.getStorageSync('whu_base_url');
    if (/^http:\/\/(?:127\.0\.0\.1|localhost):(?:5670|8767)\/?$/.test(v)) return DEFAULT_BASE;
    if (v) return v;
  } catch {}
  return DEFAULT_BASE;
}

export function setBaseUrl(url: string) {
  try {
    Taro.setStorageSync('whu_base_url', url);
  } catch (e) {
    console.error('[Api] setBaseUrl error', e);
  }
}

export const MODE_CONFIG: Record<
  ChatMode,
  { label: string; selectParam: string; desc: string; endpoint: string; extInfo?: Record<string, unknown> }
> = {
  chat_knowledge: {
    label: '知识库问答',
    selectParam: 'whu_admission',
    desc: '招生政策·规则·流程',
    endpoint: '/api/v1/chat/completions',
  },
  chat_with_db_execute: {
    label: '数据查询',
    selectParam: 'admission_agent',
    desc: '分数线·位次·招生计划',
    // 直接走 chat_with_db_execute，命中 fastpath 时毫秒级返回
    endpoint: '/api/v1/chat/completions',
  },
  chat_with_db_react: {
    label: '数据查询',
    selectParam: 'admission_agent',
    desc: '复杂数据推理',
    // 走 ReAct 智能体，挂载数据库 + 知识库，由 sql_query 工具真实查库
    endpoint: '/api/v1/chat/react-agent',
    extInfo: {
      database_name: 'admission_agent',
      knowledge_space: 'whu_admission',
    },
  },
};

export async function createConversation(mode: ChatMode): Promise<string | null> {
  // react 模式复用 chat_with_db_execute 的底层会话类型（后端无独立 react 会话场景）
  const backendMode = mode === 'chat_with_db_react' ? 'chat_with_db_execute' : mode;
  const url = `${getBaseUrl()}/api/v1/chat/dialogue/new?chat_mode=${backendMode}`;
  const res = await Taro.request({ url, method: 'POST', timeout: 15000 }).catch(() => null);
  if (!res) return null;
  const data = res.data as any;
  if (data?.success && data.data?.conv_uid) return data.data.conv_uid;
  throw new Error(data?.err_msg || '创建会话失败');
}

export interface StreamCallbacks {
  // replace=true 时 text 为全量内容（非增量帧），直接覆盖当前回答
  onDelta: (text: string, replace?: boolean) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

// 增量 UTF-8 解码器：优先用 TextDecoder，真机 JS 环境缺失时降级为手动解码
// （需处理多字节字符被分块截断的情况）
export function createUtf8Decoder(): { decode: (buf: ArrayBuffer, opts?: { stream?: boolean }) => string } {
  if (typeof TextDecoder !== 'undefined') {
    const td = new TextDecoder('utf-8');
    return { decode: (buf) => td.decode(buf, { stream: true }) };
  }
  let pending: number[] = [];
  return {
    decode(buf: ArrayBuffer) {
      const bytes = new Uint8Array(buf);
      const all = pending.concat(Array.from(bytes));
      pending = [];
      let out = '';
      let i = 0;
      while (i < all.length) {
        const b = all[i];
        let need = 0;
        if (b < 0x80) need = 0;
        else if (b >= 0xc0 && b < 0xe0) need = 1;
        else if (b >= 0xe0 && b < 0xf0) need = 2;
        else if (b >= 0xf0 && b < 0xf8) need = 3;
        else {
          i++;
          continue;
        }
        if (i + need >= all.length) {
          pending = all.slice(i);
          break;
        }
        if (need === 0) {
          out += String.fromCharCode(b);
        } else {
          let cp = b & (0x3f >> need);
          let ok = true;
          for (let k = 1; k <= need; k++) {
            const cb = all[i + k];
            if ((cb & 0xc0) !== 0x80) {
              ok = false;
              break;
            }
            cp = (cp << 6) | (cb & 0x3f);
          }
          if (ok) {
            if (cp > 0xffff) {
              cp -= 0x10000;
              out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            } else {
              out += String.fromCharCode(cp);
            }
            i += need;
          } else {
            out += '\ufffd';
          }
        }
        i++;
      }
      return out;
    },
  };
}

function streamChatCompletionsReal(
  params: { mode: ChatMode; convUid: string; userInput: string },
  callbacks: StreamCallbacks,
): () => void {
  const cfg = MODE_CONFIG[params.mode];
  const url = `${getBaseUrl()}${cfg.endpoint}`;
  // 知识库走增量流式；数据库执行场景走非增量：incremental=false 才会执行 SQL，
  // 并在最后一个全量帧中返回 speak + <chart-view>（含真实查询数据）
  const incremental = params.mode === 'chat_knowledge';
  const isReact = cfg.endpoint.includes('/react-agent');
  const backendMode = params.mode === 'chat_with_db_react' ? 'chat_with_db_execute' : params.mode;
  const body: Record<string, unknown> = {
    chat_mode: backendMode,
    conv_uid: params.convUid,
    user_input: params.userInput,
    select_param: cfg.selectParam,
    model_name: MODEL_NAME,
    incremental,
    user_name: 'miniapp_user',
    sys_code: 'whu_admission_app',
  };
  if (isReact) {
    // ReAct 接口通过 ext_info 挂载数据库与知识库资源
    body.ext_info = cfg.extInfo || {};
  }

  let cancelled = false;
  let finished = false;
  let doneFired = false;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  const friendlyError = (e: unknown): Error => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fail|abort|network|timeout|ERR/i.test(msg)) {
      return new Error(`无法连接问答服务，请确认后端已启动 (${getBaseUrl()})`);
    }
    return e instanceof Error ? e : new Error(msg);
  };

  // [DONE] 分支会先置 finished；收尾只由 doneFired 保证幂等，不能漏掉 onDone。
  const finalize = () => {
    if (doneFired || cancelled) return;
    doneFired = true;
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    callbacks.onDone();
  };

  // 知识库检索和模型首帧可能较慢。ReAct 的工具步骤之间也可能等待较久。
  const SILENCE_MS = isReact ? 120000 : incremental ? 8000 : 2500;

  const armSilenceTimer = (timeoutMs: number = SILENCE_MS) => {
    if (finished || cancelled || doneFired) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(finalize, timeoutMs);
  };

  const clearSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  // 处理非增量全量帧：丢弃第一轮模型思考 JSON，仅在拿到最终视图时覆盖展示
  const handleFullFrame = (content: string) => {
    if (incremental) return;
    if (/^\s*[{[]/.test(content)) return;
    const clean = sanitizeAnswer(content);
    if (clean) callbacks.onDelta(clean, true);
  };

  const parseSseChunk = (raw: string) => {
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data:'));
    for (const line of lines) {
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        finished = true;
        clearSilenceTimer();
        finalize();
        return true;
      }
      if (payload.startsWith('[SERVER_ERROR]')) {
        finished = true;
        clearSilenceTimer();
        callbacks.onError(new Error(payload.replace('[SERVER_ERROR]', '')));
        return true;
      }
      try {
        const json = JSON.parse(payload);
        const choice = json?.choices?.[0];
        const delta = choice?.delta?.content;
        const message = choice?.message?.content;
        if (typeof delta === 'string' && delta) {
          callbacks.onDelta(delta);
          armSilenceTimer();
        }
        if (typeof message === 'string' && message) {
          handleFullFrame(message);
          armSilenceTimer();
          // 含查询结果的 <chart-view> 帧即最终答案帧
          if (message.includes('<chart-view')) finalize();
        }
      } catch {}
    }
    return false;
  };

  // ReAct 智能体 SSE 解析：事件协议 v2
  //   step.start(title)  -> 提示当前动作（sql_query/知识库检索等）
  //   step.chunk(text/markdown) -> 中间过程增量
  //   final(content)    -> 最终答案，覆盖展示
  //   done              -> 流结束
  const parseReactSseChunk = (raw: string) => {
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data:'));
    for (const line of lines) {
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        finished = true;
        clearSilenceTimer();
        finalize();
        return true;
      }
      try {
        const json = JSON.parse(payload);
        const t = json?.type;
        armSilenceTimer();
        if (t === 'done') {
          finished = true;
          clearSilenceTimer();
          finalize();
          return true;
        }
        if (t === 'final' && typeof json?.content === 'string') {
          // 最终答案：整理后的自然语言，覆盖中间过程
          callbacks.onDelta(json.content, true);
          armSilenceTimer();
        } else if (t === 'step.chunk') {
          const out = json?.output_type;
          const content = json?.content;
          if ((out === 'text' || out === 'markdown') && typeof content === 'string' && content) {
            callbacks.onDelta(content);
            armSilenceTimer();
          }
        } else if (t === 'step.start') {
          const title = json?.title;
          if (title === 'sql_query') {
            callbacks.onDelta('\n（正在查询数据库…）\n', false);
          }
        }
      } catch {}
    }
    return false;
  };

  const parseChunk = isReact ? parseReactSseChunk : parseSseChunk;

  armSilenceTimer(isReact ? SILENCE_MS : 90000);

  if (process.env.TARO_ENV === 'h5') {
    // 使用 XHR 增量读取 SSE：云预览等嵌入式环境中 fetch 流式请求可能被
    // 中止（net::ERR_ABORTED），XHR 与常规请求走同一通道更稳定。
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.responseType = 'text';
    let lastIndex = 0;
    let tail = '';

    const handleProgress = () => {
      if (cancelled || finished) return;
      const text = xhr.responseText || '';
      if (text.length <= lastIndex) return;
      const fresh = text.slice(lastIndex);
      lastIndex = text.length;
      const data = tail + fresh;
      const parts = data.split('\n\n');
      tail = parts.pop() || '';
      for (const part of parts) {
        if (parseChunk(part)) return;
      }
    };

    const handleComplete = () => {
      if (cancelled || finished) return;
      handleProgress();
      // 冲刷尾部残留的最后一条事件
      if (tail && !finished) {
        parseChunk(tail);
        tail = '';
      }
      finalize();
    };

    xhr.onprogress = handleProgress;
    xhr.onload = handleComplete;
    xhr.onerror = () => {
      if (!cancelled && !finished && !doneFired) {
        finished = true;
        clearSilenceTimer();
        callbacks.onError(friendlyError(new Error(`网络错误（HTTP ${xhr.status}）`)));
      }
    };
    xhr.onabort = () => {
      if (!finished) finalize();
    };
    xhr.send(JSON.stringify(body));
    return () => {
      cancelled = true;
      clearSilenceTimer();
      try {
        xhr.abort();
      } catch {}
    };
  }

  if (process.env.TARO_ENV === 'weapp') {
    const task = Taro.request({
      url,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: body,
      enableChunked: true,
      timeout: 120000,
    });
    let buffer = '';
    const decoder = createUtf8Decoder();
    task.onChunkReceived((res) => {
      if (cancelled || finished) return;
      try {
        const chunk = decoder.decode(res.data as ArrayBuffer, { stream: true });
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          if (parseChunk(part)) return;
        }
      } catch (e) {
        console.error('[SSE] parse error', e);
      }
    });
    task
      .then(() => {
        if (!finished && !cancelled) finalize();
      })
      .catch((err) => {
        if (!cancelled && !finished && !doneFired) {
          finished = true;
          clearSilenceTimer();
          callbacks.onError(friendlyError(err));
        }
      });
    return () => {
      cancelled = true;
      clearSilenceTimer();
      try {
        task.abort();
      } catch {}
    };
  }

  // 其他平台降级：等待完整响应后解析
  const task = Taro.request({
    url,
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    data: body,
    timeout: 120000,
  });
  task
    .then((res) => {
      if (cancelled) return;
      try {
        const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const parts = raw.split('\n\n');
        let fullDelta = '';
        let fullText = '';
        let finalContent = '';
        for (const part of parts) {
          const lines = part.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data:'));
          for (const line of lines) {
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              finished = true;
              break;
            }
            if (payload.startsWith('[SERVER_ERROR]')) {
              finished = true;
              callbacks.onError(new Error(payload.replace('[SERVER_ERROR]', '')));
              return;
            }
            try {
              const json = JSON.parse(payload);
              if (isReact) {
                if (json?.type === 'final' && typeof json.content === 'string') {
                  finalContent = json.content;
                }
              } else {
                const choice = json?.choices?.[0];
                if (typeof choice?.delta?.content === 'string') {
                  fullDelta += choice.delta.content;
                }
                if (typeof choice?.message?.content === 'string') {
                  fullText = choice.message.content;
                }
              }
            } catch {}
          }
          if (finished) break;
        }
        if (isReact) {
          if (finalContent) callbacks.onDelta(finalContent, true);
        } else if (!incremental && fullText && !/^\s*[{[]/.test(fullText)) {
          const clean = sanitizeAnswer(fullText);
          if (clean) callbacks.onDelta(clean, true);
        } else if (fullDelta) {
          callbacks.onDelta(fullDelta);
        }
        finalize();
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    })
    .catch((err) => {
      if (!cancelled && !doneFired) callbacks.onError(friendlyError(err));
    });
  return () => {
    cancelled = true;
    clearSilenceTimer();
    try {
      task.abort();
    } catch {}
  };
}

const isNetworkError = (err: Error): boolean =>
  /无法连接|网络错误|network|ERR_CONNECTION|ERR_INTERNET|abort|timeout|超时/i.test(err.message);

/**
 * 对外入口：真实请求失败时自动降级为离线演示答案。
 * 目的是让克隆仓库的老师在没有 PostgreSQL / DB-GPT 的情况下也能完整体验对话流程；
 * 一旦拿到任意真实内容就不再降级，避免掩盖服务端问题。
 */
export function streamChatCompletions(
  params: { mode: ChatMode; convUid: string | null; userInput: string },
  callbacks: StreamCallbacks,
): () => void {
  const { mode, convUid, userInput } = params;
  if (convUid === null) {
    return streamDemoAnswer(userInput, mode, callbacks.onDelta, callbacks.onDone);
  }

  let sawContent = false;
  let demoStarted = false;
  let finished = false;
  let cancelDemo: (() => void) | null = null;
  let abortReal: (() => void) | null = null;

  const finishOnce = () => {
    if (finished) return;
    finished = true;
    callbacks.onDone();
  };

  const startDemo = () => {
    if (demoStarted || finished) return;
    demoStarted = true;
    if (abortReal) abortReal();
    cancelDemo = streamDemoAnswer(
      userInput,
      mode,
      (text, replace) => callbacks.onDelta(text, replace),
      finishOnce,
    );
  };

  const wrapped: StreamCallbacks = {
    onDelta: (text, replace) => {
      if (text) sawContent = true;
      // 保持原有回调形态：未传 replace 时不额外传 undefined
      if (replace === undefined) callbacks.onDelta(text);
      else callbacks.onDelta(text, replace);
    },
    onDone: () => {
      // 服务可达但整轮没有任何内容（例如后端 hang 后静默收尾），同样用样例兜底
      if (!sawContent && !demoStarted) {
        startDemo();
        return;
      }
      finishOnce();
    },
    onError: (err) => {
      if (!sawContent && !demoStarted && isNetworkError(err)) {
        startDemo();
        return;
      }
      callbacks.onError(err);
    },
  };

  abortReal = streamChatCompletionsReal({ mode, convUid, userInput }, wrapped);

  return () => {
    if (cancelDemo) cancelDemo();
    if (abortReal) abortReal();
  };
}
