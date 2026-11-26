
export interface AdmissionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type PromptMessage = { role: 'system' | AdmissionMessage['role']; content: string };

export type TraceEvent =
  | { type: 'model.start'; round: number; model?: string; messages?: PromptMessage[] }
  | { type: 'model.result'; round: number; elapsed_ms: number; summary?: string; output?: string; finish_reason?: string; reasoning?: string; error?: string }
  | { type: 'tool.start'; round: number; id: string; tool: 'sql_query' | 'graph_search'; input: string; command: string }
  | { type: 'tool.result'; round: number; id: string; elapsed_ms: number; result: Record<string, unknown>; executed: boolean };
