
import Taro from '@tarojs/taro';
import { createUtf8Decoder, getBaseUrl } from '@/services/dbgpt';
import type { AdmissionMessage, AnswerMeta, AnswerSource, TraceEvent } from '@/types/admission';

export interface AdmissionCallbacks {
  onTrace: (event: TraceEvent) => void;
  onAnswer: (answer: string, meta?: AnswerMeta) => void;
  onDone: () => void;
  onError: (error: Error, offline: boolean) => void;
}

export function streamAdmission(
  question: string,
  history: AdmissionMessage[],
  callbacks: AdmissionCallbacks,
  debug = false,
): () => void {
  const url = `${getBaseUrl().replace(/\/$/, '')}/api/v1/chat/admission-react`;
  const body = { question, history, debug };
  let settled = false;
  let started = false;
  let answered = false;
  let tail = '';
  let errorResponse = '';

  function fail(message: string, offline = false) {
    if (settled) return;
    settled = true;
    callbacks.onError(new Error(message), offline && !started);
  }

  function read(chunk: string, flush = false) {
    if (settled) return;
    const parts = (tail + chunk).split(/\r?\n\r?\n/);
    tail = flush ? '' : parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split(/\r?\n/)) {
        if (settled || !line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5));
        switch (event.type) {
          case 'start':
            started = true;
            break;
          case 'model.start':
          case 'model.result':
          case 'tool.start':
          case 'tool.result':
            callbacks.onTrace(event);
            break;
          case 'final':
            answered = true;
            if (debug) {
              callbacks.onAnswer(event.content);
            } else {
              const sources = Array.isArray(event.sources)
                ? event.sources.filter((source: unknown): source is AnswerSource =>
                  !!source && typeof source === 'object' && 'title' in source && typeof source.title === 'string' &&
                  'kind' in source && (source.kind === 'document' || source.kind === 'database'))
                : undefined;
              callbacks.onAnswer(event.content, {
                sources,
                seconds: typeof event.seconds === 'number' ? event.seconds : undefined,
              });
            }
            break;
          case 'error':
            fail(event.message);
            break;
          case 'done':
            if (!answered) {
              fail('问答服务未返回最终答案。');
              break;
            }
            settled = true;
            callbacks.onDone();
            break;
        }
      }
    }
  }

  function safeRead(chunk: string, flush = false) {
    try {
      read(chunk, flush);
    } catch {
      fail('无法解析问答服务返回的事件。');
    }
  }

  function finish(status: number, data: unknown) {
    if (settled) return;
    if (status < 200 || status >= 300) {
      let detail: unknown = null;
      try {
        const response = typeof data === 'string' ? JSON.parse(data) : data;
        detail = response?.detail;
      } catch {}
      fail(typeof detail === 'string' ? detail : `问答服务返回 HTTP ${status}。`);
      return;
    }
    safeRead('', true);
    if (!settled) fail('问答连接在最终答案返回前断开。');
  }

  const networkError = () => fail(`无法连接问答服务（${getBaseUrl()}）。`, true);
  if (process.env.TARO_ENV === 'h5') {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 115000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    let offset = 0;
    const progress = () => {
      if (xhr.status < 200 || xhr.status >= 300) return;
      const current = xhr.responseText;
      safeRead(current.slice(offset));
      offset = current.length;
    };
    xhr.onprogress = progress;
    xhr.onload = () => {
      progress();
      finish(xhr.status, xhr.responseText);
    };
    xhr.onerror = networkError;
    xhr.ontimeout = () => fail('问答请求超时。');
    xhr.send(JSON.stringify(body));
    return () => {
      settled = true;
      xhr.abort();
    };
  }

  const task = Taro.request<string>({
    url, method: 'POST', data: body, responseType: 'text',
    enableChunked: process.env.TARO_ENV === 'weapp', timeout: 115000,
  });
  let receivedChunk = false;
  if (process.env.TARO_ENV === 'weapp') {
    const decoder = createUtf8Decoder();
    task.onChunkReceived((response) => {
      receivedChunk = true;
      const chunk = decoder.decode(response.data as ArrayBuffer);
      if (!started && (errorResponse || chunk.trimStart().startsWith('{'))) {
        errorResponse += chunk;
      } else {
        safeRead(chunk);
      }
    });
  }
  task.then((response) => {
    if (settled) return;
    if (!receivedChunk && response.statusCode === 200) safeRead(String(response.data));
    finish(response.statusCode, errorResponse || response.data);
  }).catch(networkError);
  return () => {
    settled = true;
    task.abort();
  };
}
