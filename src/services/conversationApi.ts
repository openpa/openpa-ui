function resolveBaseUrl(agentUrl: string): string {
  if (agentUrl.startsWith('http://') || agentUrl.startsWith('https://')) {
    return agentUrl;
  }
  return `${window.location.origin}${agentUrl}`;
}

function authHeaders(authToken: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

export interface ConversationSummary {
  id: string;
  profile: string;
  context_id: string | null;
  task_id: string | null;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'agent';
  content: string | null;
  parts: any[] | null;
  thinking_steps: { thought: string; action: string; action_input: string; observation?: { kind: string; text?: string; data?: Record<string, any>; file?: any }[]; model_label?: string | null; reasoning_model_label?: string | null }[] | null;
  token_usage: { input_tokens: number; output_tokens: number } | null;
  metadata: Record<string, any> | null;
  created_at: number;
  ordering: number;
}

export async function fetchConversations(
  agentUrl: string, authToken: string, profile: string,
  limit: number = 50, offset: number = 0,
): Promise<ConversationSummary[]> {
  const base = resolveBaseUrl(agentUrl);
  const params = new URLSearchParams({
    profile,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${base}/api/conversations?${params}`, {
    headers: authHeaders(authToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch conversations: ${res.statusText}`);
  const data = await res.json();
  return data.conversations;
}

export async function fetchConversationMessages(
  agentUrl: string, authToken: string, conversationId: string,
  limit: number = 100, offset: number = 0,
): Promise<{ conversation: ConversationSummary; messages: MessageRecord[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/conversations/${encodeURIComponent(conversationId)}`, {
    headers: authHeaders(authToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch conversation: ${res.statusText}`);
  return res.json();
}

export async function deleteConversation(
  agentUrl: string, authToken: string, conversationId: string,
): Promise<void> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    headers: authHeaders(authToken),
  });
  if (!res.ok) throw new Error(`Failed to delete conversation: ${res.statusText}`);
}

export async function deleteAllConversations(
  agentUrl: string, authToken: string, profile: string,
): Promise<number> {
  const base = resolveBaseUrl(agentUrl);
  const params = new URLSearchParams({ profile });
  const res = await fetch(`${base}/api/conversations?${params}`, {
    method: 'DELETE',
    headers: authHeaders(authToken),
  });
  if (!res.ok) throw new Error(`Failed to delete conversations: ${res.statusText}`);
  const data = await res.json();
  return data.deleted_count;
}

export async function updateConversationTitle(
  agentUrl: string, authToken: string, conversationId: string, title: string,
): Promise<void> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PUT',
    headers: authHeaders(authToken),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to update conversation: ${res.statusText}`);
}
