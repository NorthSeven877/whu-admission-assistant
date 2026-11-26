
import { create } from 'zustand';
import type { ChatMessage, ChatMode, ChatSession } from '@/types/chat';
import type { AdmissionMessage } from '@/types/admission';
import { streamAdmission } from '@/services/admission';
import { streamDemoAnswer } from '@/services/demo';
import { generateId, loadSessions, saveSessions } from '@/utils/storage';

const MODE: ChatMode = 'chat_with_db_react';

export function admissionHistory(messages: ChatMessage[]): AdmissionMessage[] {
  const history: AdmissionMessage[] = [];
  messages.forEach((message, index) => {
    const question = messages[index - 1];
    if (message.role === 'assistant' && message.content && !message.error &&
        !message.offline && question?.role === 'user') {
      history.push({ role: 'user', content: question.content.slice(0, 12000) });
      history.push({ role: 'assistant', content: message.content.slice(0, 12000) });
    }
  });
  return history.slice(-12);
}

interface ChatState {
  sessions: ChatSession[];
  current: ChatSession | null;
  streaming: boolean;
  init: () => void;
  newSession: () => void;
  openSession: (convUid: string) => void;
  deleteSession: (convUid: string) => void;
  clearAll: () => void;
  sendMessage: (text: string) => void;
  cancel: () => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  let cancelAnswer: (() => void) | undefined;
  let loaded = false;

  const updateMessage = (sessionUid: string, messageId: string, update: (message: ChatMessage) => ChatMessage) => {
    const { current, sessions } = get();
    const session = sessions.find((item) => item.convUid === sessionUid);
    if (!session) return;
    const updated = {
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.map((message) => message.id === messageId ? update(message) : message),
    };
    set({
      current: current?.convUid === sessionUid ? updated : current,
      sessions: sessions.map((item) => item.convUid === sessionUid ? updated : item),
    });
  };

  const persist = () => saveSessions(get().sessions.map((session) => ({
    ...session,
    messages: session.messages.map(({ trace, ...message }) => ({
      ...message,
      trace: trace?.map((event) => event.type === 'tool.result' && !event.result.error
        ? { ...event, result: { saved: false } }
        : event),
    })),
  })));

  function answer(question: string, sessionUid: string, messageId: string, history: AdmissionMessage[]) {
    let closed = false;
    let stopDemo: (() => void) | undefined;
    let stopStream: (() => void) | undefined;
    const patch = (fields: Partial<ChatMessage>) => updateMessage(
      sessionUid, messageId, (message) => ({ ...message, ...fields }),
    );
    const finish = () => {
      if (closed) return;
      closed = true;
      cancelAnswer = undefined;
      set({ streaming: false });
      persist();
    };
    cancelAnswer = () => {
      stopStream?.();
      stopDemo?.();
      patch({ content: '已停止生成。', error: true });
      finish();
    };
    try {
      stopStream = streamAdmission(question, history, {
        onTrace: (event) => {
          if (closed) return;
          updateMessage(sessionUid, messageId, (message) => ({
            ...message, trace: [...(message.trace || []), event],
          }));
        },
        onAnswer: (content, meta) => {
          if (!closed) patch({ content, ...meta });
        },
        onDone: finish,
        onError: (error, offline) => {
          if (closed) return;
          if (offline) {
            patch({ offline: true });
            stopDemo = streamDemoAnswer(question, undefined, (content) => patch({ content }), finish);
            return;
          }
          patch({ content: error.message, error: true });
          finish();
        },
      });
    } catch (error) {
      patch({ content: error instanceof Error ? error.message : '无法发起问答请求。', error: true });
      finish();
    }
  }

  return {
    sessions: [],
    current: null,
    streaming: false,
    init: () => {
      if (loaded || get().streaming) return;
      loaded = true;
      set({ sessions: loadSessions() });
    },
    newSession: () => set({ current: null }),
    openSession: (convUid) => {
      const session = get().sessions.find((item) => item.convUid === convUid);
      if (session) set({ current: session });
    },
    deleteSession: (convUid) => {
      const sessions = get().sessions.filter((item) => item.convUid !== convUid);
      const current = get().current;
      set({ sessions, current: current?.convUid === convUid ? null : current });
      persist();
    },
    clearAll: () => {
      set({ sessions: [], current: null });
      persist();
    },
    cancel: () => cancelAnswer?.(),
    sendMessage: (text) => {
      const question = text.trim();
      if (!question || get().streaming) return;

      const session = get().current;
      const previous = session?.messages || [];
      const user: ChatMessage = {
        id: generateId(), role: 'user', content: question, mode: MODE, timestamp: Date.now(),
      };
      const assistant: ChatMessage = {
        id: generateId(), role: 'assistant', content: '', mode: MODE, timestamp: Date.now(),
      };
      const updated: ChatSession = {
        ...session,
        convUid: session?.convUid || generateId(),
        title: session?.title && session.title !== '新会话' ? session.title : question.slice(0, 20),
        mode: MODE,
        messages: [...previous, user, assistant],
        createdAt: session?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      const sessions = get().sessions;
      set({
        current: updated,
        sessions: session ? sessions.map((item) => item.convUid === updated.convUid ? updated : item) : [updated, ...sessions],
        streaming: true,
      });
      answer(question, updated.convUid, assistant.id, admissionHistory(previous));
    },
  };
});
