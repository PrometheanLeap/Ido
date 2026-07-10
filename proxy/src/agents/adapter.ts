// ── AgentAdapter Interface ──────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentContext {
  tenantId: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface AgentAdapter {
  type: string;
  sendMessage(msg: ChatMessage, ctx: AgentContext): Promise<AgentResponse>;
  healthCheck(): Promise<boolean>;
}

// ── Adapter Registry ────────────────────────────────────────

const adapters = new Map<string, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: string): AgentAdapter | undefined {
  return adapters.get(type);
}

export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}
