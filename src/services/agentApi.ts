export interface JsonSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface JsonSchema {
  type: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface RemoteAgent {
  name: string;
  encoded_name: string;
  description: string;
  url: string;
  badge_class: string;
  status_text: string;
  expiration_info: { timestamp: number; formatted: string; relative: string } | null;
  show_authenticate: boolean;
  show_unlink: boolean;
  arguments_schema: JsonSchema | null;
  is_default: boolean;
  enabled: boolean;
  connection_error: string | null;
}

function resolveBaseUrl(agentUrl: string): string {
  if (agentUrl.startsWith('http://') || agentUrl.startsWith('https://')) {
    return agentUrl;
  }
  return `${window.location.origin}${agentUrl}`;
}

export async function fetchAgents(agentUrl: string, profile: string): Promise<RemoteAgent[]> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/agents?profile=${encodeURIComponent(profile)}`);
  if (!res.ok) throw new Error(`Failed to fetch agents: ${res.statusText}`);
  const data = await res.json();
  return data.agents;
}

export async function getAuthUrl(agentUrl: string, agentName: string, profile: string): Promise<string> {
  const base = resolveBaseUrl(agentUrl);
  const returnUrl = window.location.origin + window.location.pathname;
  const res = await fetch(
    `${base}/api/agents/${encodeURIComponent(agentName)}/auth-url?profile=${encodeURIComponent(profile)}&return_url=${encodeURIComponent(returnUrl)}`
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to get auth URL: ${res.statusText}`);
  }
  const data = await res.json();
  return data.auth_url;
}

export async function fetchMe(
  agentUrl: string,
  token: string
): Promise<{ sub: string; profile: string; exp: number | null; iat: number | null; working_dir?: string }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/me`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch user info: ${res.statusText}`);
  }
  return res.json();
}

export async function toggleAgentEnabled(agentUrl: string, agentName: string, enabled: boolean, profile: string): Promise<void> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(
    `${base}/api/agents/${encodeURIComponent(agentName)}/enabled`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, profile }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to toggle agent: ${res.statusText}`);
  }
}

export async function reconnectAgent(agentUrl: string, agentName: string, profile: string): Promise<void> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(
    `${base}/api/agents/${encodeURIComponent(agentName)}/reconnect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to reconnect: ${res.statusText}`);
  }
}

export async function unlinkAgent(agentUrl: string, agentName: string, profile: string): Promise<void> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(
    `${base}/api/agents/${encodeURIComponent(agentName)}/unlink?profile=${encodeURIComponent(profile)}`,
    { method: 'POST' }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to unlink agent: ${res.statusText}`);
  }
}
