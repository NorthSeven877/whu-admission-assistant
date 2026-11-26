
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdmissionCallbacks } from '@/services/admission';
import { useChatStore } from '@/store/chatStore';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  demo: vi.fn(),
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
}));
vi.mock('@/services/admission', () => ({ streamAdmission: mocks.request }));
vi.mock('@/services/demo', () => ({ streamDemoAnswer: mocks.demo }));
vi.mock('@tarojs/taro', () => ({
  default: { getStorageSync: mocks.getStorageSync, setStorageSync: mocks.setStorageSync },
}));

const current = () => useChatStore.getState().current;
const callbacks = () => mocks.request.mock.lastCall?.[2] as AdmissionCallbacks;

describe('admissions chat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useChatStore.setState({ sessions: [], current: null, streaming: false });
    mocks.getStorageSync.mockReturnValue([]);
    mocks.request.mockReturnValue(vi.fn());
  });

  it('uses the same endpoint for policy and numerical queries and sends confirmed history', () => {
    useChatStore.getState().sendMessage('报考条件是什么？');
    callbacks().onAnswer('第一轮答案');
    callbacks().onDone();
    useChatStore.getState().sendMessage('2024 年的分数呢？');
    expect(mocks.request.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['报考条件是什么？', []],
      ['2024 年的分数呢？', [
        { role: 'user', content: '报考条件是什么？' },
        { role: 'assistant', content: '第一轮答案' },
      ]],
    ]);
  });

  it('keeps process events separate from the answer and omits result bodies from storage', () => {
    useChatStore.getState().sendMessage('查录取线');
    callbacks().onTrace({ type: 'model.start', round: 1 });
    callbacks().onTrace({
      type: 'tool.result', round: 1, id: '1.1', result: { rows: [[641]] }, elapsed_ms: 5, executed: true,
    });
    expect(current()?.messages[1].content).toEqual('');
    expect(current()?.messages[1].trace).toHaveLength(2);
    callbacks().onAnswer('最低分为 641。');
    callbacks().onDone();
    const saved = mocks.setStorageSync.mock.lastCall?.[1];
    expect(saved[0].messages[1].trace[1].result).toEqual({ saved: false });
    expect(useChatStore.getState().streaming).toBe(false);
  });

  it('keeps a live error visible instead of replacing it with an offline answer', () => {
    useChatStore.getState().sendMessage('报考条件');
    callbacks().onError(new Error('模型超时'), false);
    expect(current()?.messages[1]).toMatchObject({ content: '模型超时', error: true });
    expect(mocks.demo).not.toHaveBeenCalled();
  });

  it('uses a marked offline example only before a live connection and excludes it from follow-ups', () => {
    mocks.demo.mockImplementation((_q, _mode, delta, done) => {
      delta('离线样例');
      done();
      return vi.fn();
    });
    useChatStore.getState().sendMessage('报考条件');
    callbacks().onError(new Error('网络错误'), true);
    expect(current()?.messages[1]).toMatchObject({ content: '离线样例', offline: true });
    useChatStore.getState().sendMessage('然后呢？');
    expect(mocks.request.mock.lastCall?.[1]).toEqual([]);
  });

  it('cancels the active request and ignores late frames', () => {
    const abort = vi.fn();
    mocks.request.mockReturnValueOnce(abort);
    useChatStore.getState().sendMessage('报考条件');
    const first = callbacks();
    useChatStore.getState().cancel();
    useChatStore.getState().sendMessage('第二题');
    first.onAnswer('late');
    first.onDone();
    expect(abort).toHaveBeenCalledOnce();
    expect(current()?.messages[1].content).toBe('已停止生成。');
    expect(current()?.messages[3].content).toBe('');
    expect(useChatStore.getState().streaming).toBe(true);
  });
});
