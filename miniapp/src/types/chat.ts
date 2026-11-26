import type { TraceEvent } from './admission';

export type ChatMode = 'chat_knowledge' | 'chat_with_db_execute' | 'chat_with_db_react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode: ChatMode;
  timestamp: number;
  error?: boolean;
  offline?: boolean;
  trace?: TraceEvent[];
}

export interface ChatSession {
  /** 本地会话主标识，历史列表按此去重 */
  convUid: string;
  title: string;
  /** 最近一次回答所用的引擎 */
  mode: ChatMode;
  /**
   * 每个引擎各自独立的底层会话 id：
   * 同一界面会话内追问时复用对应引擎的会话，避免切换引擎丢失多轮上下文
   */
  convUids?: Partial<Record<ChatMode, string>>;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
