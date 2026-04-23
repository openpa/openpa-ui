/**
 * API client for the Process Manager.
 *
 * Mirrors the shape of configApi.ts.  ``openProcessSocket`` uses the
 * ``Sec-WebSocket-Protocol`` subprotocol header trick to pass the JWT,
 * because browsers cannot set ``Authorization`` on the native WebSocket
 * constructor.  The backend echoes ``bearer`` as the accepted subprotocol
 * after validating the token.
 */

function resolveBaseUrl(agentUrl: string): string {
  if (agentUrl.startsWith('http://') || agentUrl.startsWith('https://')) {
    return agentUrl;
  }
  return `${window.location.origin}${agentUrl}`;
}

function resolveWsBaseUrl(agentUrl: string): string {
  const http = resolveBaseUrl(agentUrl);
  if (http.startsWith('https://')) return 'wss://' + http.slice('https://'.length);
  if (http.startsWith('http://')) return 'ws://' + http.slice('http://'.length);
  return http;
}

function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export type ProcessStatus = 'running' | 'exited';

export interface ProcessRow {
  process_id: string;
  command: string;
  working_dir: string;
  log_dir: string;
  status: ProcessStatus;
  exit_code: number | null;
  /** Unix seconds (wall clock) when the process was created. */
  created_at: number;
  /** Unix seconds (wall clock) when the registry entry will expire. */
  expire_at: number;
  is_pty: boolean;
}

export async function listProcesses(
  agentUrl: string,
  token: string,
): Promise<{ processes: ProcessRow[] }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/processes`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to list processes: ${res.statusText}`);
  return res.json();
}

export async function getProcess(
  agentUrl: string,
  token: string,
  pid: string,
): Promise<ProcessRow> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/processes/${encodeURIComponent(pid)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get process: ${res.statusText}`);
  return res.json();
}

export async function stopProcess(
  agentUrl: string,
  token: string,
  pid: string,
): Promise<{ stopped?: boolean; return_code?: number | null; error?: string }> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/processes/${encodeURIComponent(pid)}/stop`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to stop process: ${res.statusText}`);
  }
  return res.json();
}

export async function sendStdin(
  agentUrl: string,
  token: string,
  pid: string,
  body: { input_text?: string; keys?: string[]; line_ending?: string },
): Promise<Record<string, unknown>> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/processes/${encodeURIComponent(pid)}/stdin`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function resizeProcess(
  agentUrl: string,
  token: string,
  pid: string,
  cols: number,
  rows: number,
): Promise<Record<string, unknown>> {
  const base = resolveBaseUrl(agentUrl);
  const res = await fetch(`${base}/api/processes/${encodeURIComponent(pid)}/resize`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ cols, rows }),
  });
  return res.json();
}

/**
 * Open a streaming WebSocket for a process.  The token is passed via the
 * ``Sec-WebSocket-Protocol`` subprotocol header because the browser
 * WebSocket constructor does not allow custom headers.
 */
export function openProcessSocket(
  agentUrl: string,
  token: string,
  pid: string,
): WebSocket {
  if (!token) {
    // The WebSocket constructor throws a SyntaxError on an empty
    // subprotocol token (RFC 7230 requires at least one tchar).  Fail
    // fast with a clear message instead.
    throw new Error('Missing auth token — please log in before opening a process stream.');
  }
  const base = resolveWsBaseUrl(agentUrl);
  const url = `${base}/api/processes/${encodeURIComponent(pid)}/ws`;
  return new WebSocket(url, ['bearer', token]);
}
