/**
 * API client for server configuration, LLM providers, tool management, and profiles.
 */

function resolveBaseUrl(agentUrl: string): string {
  if (agentUrl.startsWith('http://') || agentUrl.startsWith('https://')) {
    return agentUrl;
  }
  return `${window.location.origin}${agentUrl}`;
}

function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ── Setup ──

export async function checkSetupStatus(
  agentUrl: string,
  profile?: string
): Promise<{ setup_complete: boolean; profile_exists?: boolean; has_profiles?: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : '';
  const res = await fetch(`${base}/api/config/setup-status${params}`);
  if (!res.ok) throw new Error(`Failed to check setup status: ${res.statusText}`);
  return res.json();
}

export async function resetOrphanedSetup(
  agentUrl: string
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/config/reset-orphaned-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to reset setup: ${res.statusText}`);
  }
  return res.json();
}

export async function completeSetup(
  agentUrl: string,
  config: {
    profile: string;
    server_config?: Record<string, string>;
    llm_config?: Record<string, string>;
    tool_configs?: Record<string, Record<string, string>>;
  }
): Promise<{ success: boolean; token: string; expires_at: string; profile: string }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/config/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Setup failed: ${res.statusText}`);
  }
  return res.json();
}

export async function reconfigure(
  agentUrl: string,
  token: string
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/config/reconfigure`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to reconfigure: ${res.statusText}`);
  return res.json();
}

// ── Server Config ──

export async function getServerConfig(
  agentUrl: string,
  token: string
): Promise<{ config: Record<string, string> }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/config/server`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get server config: ${res.statusText}`);
  return res.json();
}

export async function updateServerConfig(
  agentUrl: string,
  token: string,
  config: Record<string, string>
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/config/server`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ config }),
  });
  if (!res.ok) throw new Error(`Failed to update server config: ${res.statusText}`);
  return res.json();
}

// ── LLM Providers ──

export interface ProviderConfigField {
  description: string;
  type: string;
  secret: boolean;
  required: boolean;
  default?: string;
  configured: boolean;
}

export interface LLMProvider {
  name: string;
  display_name: string;
  requires_api_key: boolean;
  requires_service_account: boolean;
  configured: boolean;
  model_count: number;
  config_fields?: Record<string, ProviderConfigField>;
  current_values?: Record<string, string>;
}

export interface LLMModel {
  id: string;
  display_name: string;
  group_hint: string;
  input_price_per_1m: number;
  output_price_per_1m: number;
  reasoning_effort?: string[];
}

export async function listLLMProviders(
  agentUrl: string,
  token: string
): Promise<{ providers: LLMProvider[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/llm/providers`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to list providers: ${res.statusText}`);
  return res.json();
}

export async function getProviderModels(
  agentUrl: string,
  token: string,
  providerName: string
): Promise<{ provider: Record<string, unknown>; models: LLMModel[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/llm/providers/${encodeURIComponent(providerName)}/models`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get models: ${res.statusText}`);
  return res.json();
}

export async function updateProvider(
  agentUrl: string,
  token: string,
  providerName: string,
  config: Record<string, string>
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/llm/providers/${encodeURIComponent(providerName)}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to update provider: ${res.statusText}`);
  return res.json();
}

export async function getModelGroups(
  agentUrl: string,
  token: string
): Promise<{ model_groups: Record<string, string>; default_provider: string; reasoning_efforts: Record<string, string | null> }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/llm/model-groups`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get model groups: ${res.statusText}`);
  return res.json();
}

export async function updateModelGroups(
  agentUrl: string,
  token: string,
  modelGroups: Record<string, string>,
  defaultProvider?: string,
  reasoningEfforts?: Record<string, string | null>,
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const body: Record<string, unknown> = { model_groups: modelGroups };
  if (defaultProvider) body.default_provider = defaultProvider;
  if (reasoningEfforts) body.reasoning_efforts = reasoningEfforts;
  const res = await fetch(`${base}/api/llm/model-groups`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to update model groups: ${res.statusText}`);
  return res.json();
}

// ── Tools ──

export interface ToolConfigField {
  description: string;
  type: string;
  secret: boolean;
  configured: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolStatus {
  /** Unique system identifier (slug). */
  tool_id: string;
  /** Human-readable display name shown in the UI. */
  name: string;
  /** Description shown in tool listings. */
  description: string;
  /** One of: 'builtin' | 'a2a' | 'mcp' | 'skill'.
   *  (Intrinsic tools are filtered out server-side.) */
  tool_type: 'builtin' | 'a2a' | 'mcp' | 'skill' | string;
  enabled: boolean;
  configured: boolean;
  /** TOML required_config schema for built-in tools. {} for skills/a2a/mcp. */
  required_fields: Record<string, ToolConfigField>;
  /** Per-profile per-tool config grouped by scope. */
  config: {
    arguments: Record<string, unknown>;
    variables: Record<string, string>;
    llm: Record<string, unknown>;
    meta?: Record<string, string>;
  };
  /** Mirrored from config.llm.full_reasoning for convenience. */
  full_reasoning: boolean;
  arguments_schema: Record<string, unknown> | null;
  /** Optional fields surfaced by the registry: */
  url?: string;
  owner_profile?: string | null;
  is_stub?: boolean;
  connection_error?: string | null;
  /** Built-in tools only: false until a child LLM is bound (post-setup). */
  llm_bound?: boolean;
}

export async function listTools(
  agentUrl: string,
  token: string
): Promise<{ tools: ToolStatus[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to list tools: ${res.statusText}`);
  return res.json();
}

/** Fetch full config + schema for a tool (used by the per-tool view). */
export async function getToolConfig(
  agentUrl: string,
  token: string,
  toolId: string
): Promise<ToolStatus> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools/${encodeURIComponent(toolId)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get tool config: ${res.statusText}`);
  return res.json();
}

/** Update Tool Variables (env-style secrets / required_config values). */
export async function updateToolConfig(
  agentUrl: string,
  token: string,
  toolId: string,
  variables: Record<string, string>
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools/${encodeURIComponent(toolId)}/variables`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ variables }),
  });
  if (!res.ok) throw new Error(`Failed to update tool variables: ${res.statusText}`);
  return res.json();
}

/** Toggle a tool's enabled state for the current profile. */
export async function setToolEnabled(
  agentUrl: string,
  token: string,
  toolId: string,
  enabled: boolean
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools/${encodeURIComponent(toolId)}/enabled`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Failed to set tool enabled: ${res.statusText}`);
  return res.json();
}

/** Set the full_reasoning LLM parameter for a built-in or MCP tool. */
export async function setToolFullReasoning(
  agentUrl: string,
  token: string,
  toolId: string,
  fullReasoning: boolean
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools/${encodeURIComponent(toolId)}/llm`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ llm: { full_reasoning: fullReasoning } }),
  });
  if (!res.ok) throw new Error(`Failed to set full reasoning: ${res.statusText}`);
  return res.json();
}

// ── Profiles ──

export async function listProfiles(
  agentUrl: string,
  token: string
): Promise<{ profiles: string[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/profiles`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to list profiles: ${res.statusText}`);
  return res.json();
}

export async function createProfile(
  agentUrl: string,
  token: string,
  name: string
): Promise<{ success: boolean; profile: string }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/profiles`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to create profile: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteProfile(
  agentUrl: string,
  token: string,
  name: string
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/profiles/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to delete profile: ${res.statusText}`);
  return res.json();
}

export async function getPersona(
  agentUrl: string,
  token: string,
  profileName: string
): Promise<{ content: string }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/profiles/${encodeURIComponent(profileName)}/persona`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load persona: ${res.statusText}`);
  return res.json();
}

export async function updatePersona(
  agentUrl: string,
  token: string,
  profileName: string,
  content: string
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/profiles/${encodeURIComponent(profileName)}/persona`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to update persona: ${res.statusText}`);
  return res.json();
}

// ── Tool Arguments ──

export async function getToolArguments(
  agentUrl: string,
  token: string,
  toolName: string
): Promise<{ arguments: Record<string, unknown> }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools/${encodeURIComponent(toolName)}/arguments`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to load tool arguments: ${res.statusText}`);
  return res.json();
}

export async function updateToolArguments(
  agentUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/tools/${encodeURIComponent(toolName)}/arguments`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ arguments: args }),
  });
  if (!res.ok) throw new Error(`Failed to update tool arguments: ${res.statusText}`);
  return res.json();
}

// ── Agents (for the unified agents/tools page) ──

export interface RemoteAgentInfo {
  /** Unique system identifier; the value to pass in /api/agents/{tool_id} URLs. */
  tool_id: string;
  /** Human-readable display name. */
  name: string;
  encoded_name: string;
  description: string;
  url: string;
  badge_class: string;
  status_text: string;
  expiration_info: { timestamp: number; formatted: string; relative: string } | null;
  show_authenticate: boolean;
  show_unlink: boolean;
  arguments_schema: Record<string, unknown> | null;
  agent_type: 'a2a' | 'mcp' | string;
  enabled: boolean;
  /** Profile that originally registered this tool (a2a/mcp only). */
  owner_profile: string | null;
  is_stub: boolean;
  connection_error: string | null;
}

export async function listAgents(
  agentUrl: string,
  profile: string
): Promise<{ agents: RemoteAgentInfo[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/agents?profile=${encodeURIComponent(profile)}`);
  if (!res.ok) throw new Error(`Failed to list agents: ${res.statusText}`);
  return res.json();
}

export async function addAgent(
  agentUrl: string,
  config: { url?: string; type: string; profile: string; json_config?: string; llm_provider?: string; llm_model?: string; reasoning_effort?: string; system_prompt?: string; description?: string }
): Promise<{ success: boolean; agent: { name: string; description: string; url: string; type: string } }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to add agent: ${res.statusText}`);
  }
  return res.json();
}

export async function removeAgent(
  agentUrl: string,
  agentName: string,
  profile: string
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(
    `${base}/api/agents/${encodeURIComponent(agentName)}?profile=${encodeURIComponent(profile)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to remove agent: ${res.statusText}`);
  }
  return res.json();
}

export async function updateAgentConfig(
  agentUrl: string,
  agentName: string,
  config: { profile: string; llm_provider?: string | null; llm_model?: string | null; reasoning_effort?: string | null; system_prompt?: string | null; description?: string | null; full_reasoning?: boolean }
): Promise<{ success: boolean }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/agents/${encodeURIComponent(agentName)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update agent config: ${res.statusText}`);
  }
  return res.json();
}
