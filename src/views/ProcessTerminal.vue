<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElButton, ElTag, ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useSettingsStore } from '../stores/settings';
import { getToolConfig } from '../services/configApi';
import {
  openProcessSocket,
  stopProcess,
  type ProcessStatus,
} from '../services/processApi';

const props = defineProps<{ profile: string; pid: string }>();
const router = useRouter();
const settings = useSettingsStore();

const termEl = ref<HTMLDivElement | null>(null);
const command = ref<string>('');
const workingDir = ref<string>('');
const status = ref<ProcessStatus | 'connecting' | 'disconnected'>('connecting');
const exitCode = ref<number | null>(null);
const isPty = ref<boolean>(false);

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;

// Client-side cooked-mode line buffer for non-PTY processes. Pipes don't
// run through a tty driver, so backspace/DEL bytes (including those an IME
// like Vietnamese Telex emits when erasing a composition) would otherwise
// be forwarded verbatim and end up inside the string read by input().
let inputBuffer = '';

async function loadDefaultSize(): Promise<{ cols: number; rows: number }> {
  try {
    const tool = await getToolConfig(settings.agentUrl, settings.authToken, 'exec_shell');
    const vars = tool.config?.variables || {};
    const cols = Number(vars.TERMINAL_DEFAULT_COLS) || 80;
    const rows = Number(vars.TERMINAL_DEFAULT_ROWS) || 24;
    return { cols, rows };
  } catch {
    return { cols: 80, rows: 24 };
  }
}

// Non-PTY cooked-mode handler: echoes printable chars, processes BS/DEL
// against the local buffer, and only flushes a completed line (+ \n) to
// the backend on Enter. Returns the bytes to send.
function handleNonPtyInput(data: string): string {
  if (!term) return '';
  // Normalize CRLF / lone CR to LF so we treat Enter consistently.
  const norm = data.replace(/\r\n?/g, '\n');
  let echo = '';
  let toSend = '';
  for (const ch of norm) {
    const code = ch.charCodeAt(0);
    if (ch === '\n') {
      toSend += inputBuffer + '\n';
      inputBuffer = '';
      echo += '\r\n';
    } else if (ch === '\x7f' || ch === '\b') {
      if (inputBuffer.length > 0) {
        // Slice by code point so a trailing surrogate pair is removed cleanly.
        const chars = [...inputBuffer];
        chars.pop();
        inputBuffer = chars.join('');
        echo += '\b \b';
      }
    } else if (code >= 0x20 && code !== 0x7f) {
      inputBuffer += ch;
      echo += ch;
    }
    // Other control bytes (arrow keys, ^C, ^D, escape sequences, …) are
    // dropped — they're not meaningful to a pipe-backed stdin reader.
  }
  if (echo) term.write(echo);
  return toSend;
}

function writeChunk(stream: string, data: string) {
  if (!term) return;
  if (stream === 'stderr') {
    // Render stderr in red so the user can visually separate it from
    // stdout when the process is non-PTY (PTY merges streams anyway).
    term.write(`\x1b[31m${data}\x1b[0m`);
  } else {
    term.write(data);
  }
}

function sendResize() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
  ws.send(JSON.stringify({
    type: 'resize',
    cols: term.cols,
    rows: term.rows,
  }));
}

async function waitForToken(maxMs = 5000): Promise<boolean> {
  // If App.vue's auth gate is still resolving when this view mounts, give
  // it a brief window to populate the store before we try to open the WS
  // with an empty token (the WebSocket constructor rejects empty bearer
  // subprotocol values, which would leave us wedged on "connecting").
  if (settings.authToken) return true;
  const start = Date.now();
  while (!settings.authToken && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return Boolean(settings.authToken);
}

onMounted(async () => {
  if (!termEl.value) return;

  // Defensive token load — see ProcessList.vue for the same rationale.
  if (!settings.authToken && props.profile) {
    settings.activateProfile(props.profile);
  }
  const ok = await waitForToken();
  if (!ok) {
    status.value = 'disconnected';
    return;
  }

  const { cols, rows } = await loadDefaultSize();

  term = new Terminal({
    cols,
    rows,
    convertEol: false,
    cursorBlink: true,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: 13,
    theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(termEl.value);
  try { fitAddon.fit(); } catch { /* ignore early-fit race */ }

  // Suppress xterm's automatic replies to host-sent queries (Device
  // Attributes and Device Status Reports — final bytes 'c', 'n', 'R').
  // Left enabled, those replies travel out via onData, get written to
  // the PTY's stdin, and echo right back as visible garbage like
  // "[?1;2c" or "[O1;2c" at the top of a shell session. Returning true
  // from a custom handler tells the parser "handled, skip the default",
  // which is the xterm-sanctioned way to opt out of these responses.
  term.parser.registerCsiHandler({ final: 'c' }, () => true);
  term.parser.registerCsiHandler({ final: 'n' }, () => true);

  term.onData((data: string) => {
    // TEMP IME diagnostic — remove once Telex/PTY reordering is understood.
    // Logs each onData event so we can see what bytes xterm actually emits
    // for a given IME keystroke sequence.
    // eslint-disable-next-line no-console
    console.log(
      '[ProcessTerminal] onData',
      JSON.stringify(data),
      'codes=',
      [...data].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '),
      'pty=',
      isPty.value,
    );

    // PTY processes already go through the OS tty driver (echo + cooked-mode
    // line editing), so forward keystrokes raw. Non-PTY processes have no
    // tty driver; we emulate cooked mode locally so that backspace-and-
    // compose sequences from IMEs (e.g. Vietnamese Telex) don't end up as
    // literal \x7f bytes inside the text the program reads.
    let sendData: string;
    if (isPty.value) {
      sendData = data;
    } else {
      sendData = handleNonPtyInput(data);
      if (!sendData) return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stdin', data: sendData }));
    }
  });

  try {
    ws = openProcessSocket(settings.agentUrl, settings.authToken, props.pid);
  } catch (err) {
    // openProcessSocket / new WebSocket can synchronously throw (e.g. an
    // invalid subprotocol token).  Surface that as a disconnected state
    // instead of leaving the UI stuck on "connecting".
    status.value = 'disconnected';
    ElMessage.error(
      'Failed to open process stream: ' +
      (err instanceof Error ? err.message : String(err)),
    );
    return;
  }
  ws.onopen = () => {
    status.value = 'running';
    // Push the initial size to the backend after the handshake.
    sendResize();
  };
  ws.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const t = msg.type as string;
    if (t === 'snapshot') {
      const chunks = (msg.chunks as Array<{ type: string; data: string }>) || [];
      for (const c of chunks) writeChunk(c.type, c.data);
    } else if (t === 'stdout' || t === 'stderr') {
      writeChunk(t, (msg.data as string) || '');
    } else if (t === 'status') {
      const data = (msg.data as Record<string, unknown>) || {};
      command.value = (data.command as string) || '';
      workingDir.value = (data.working_dir as string) || '';
      isPty.value = Boolean(data.is_pty);
      status.value = (data.status as ProcessStatus) || 'running';
      exitCode.value = (data.exit_code as number | null) ?? null;
    } else if (t === 'overflow') {
      ElMessage.warning('Output buffer overflowed — some chunks were dropped.');
    }
  };
  ws.onclose = () => {
    status.value = status.value === 'exited' ? 'exited' : 'disconnected';
  };
  ws.onerror = () => {
    status.value = 'disconnected';
  };

  resizeObserver = new ResizeObserver(() => {
    try {
      fitAddon?.fit();
      sendResize();
    } catch {
      /* fit() can throw if element isn't measurable yet */
    }
  });
  resizeObserver.observe(termEl.value);
});

onBeforeUnmount(() => {
  try { resizeObserver?.disconnect(); } catch { /* noop */ }
  resizeObserver = null;
  try { ws?.close(); } catch { /* noop */ }
  ws = null;
  try { term?.dispose(); } catch { /* noop */ }
  term = null;
  fitAddon = null;
});

async function confirmStop() {
  await stopProcess(settings.agentUrl, settings.authToken, props.pid);
  status.value = 'exited';
}

function goBack() {
  router.push({ name: 'process-list', params: { profile: props.profile } });
}

type TagType = 'success' | 'info' | 'warning' | 'danger' | 'primary';

function statusColor(s: string): TagType {
  if (s === 'running') return 'success';
  if (s === 'exited') return 'info';
  if (s === 'disconnected') return 'warning';
  return 'primary';
}
</script>

<template>
  <div class="terminal-page">
    <div class="terminal-header">
      <button class="back-btn" @click="goBack">
        <Icon icon="mdi:arrow-left" />
        Process list
      </button>
      <div class="header-meta">
        <h1 class="title">Process {{ pid }}</h1>
        <ElTag :type="statusColor(status)" size="small" effect="light">
          {{ status }}{{ exitCode !== null ? ` (${exitCode})` : '' }}
        </ElTag>
        <span v-if="isPty" class="pty-pill">pty</span>
        <code class="cmd" :title="command">{{ command || '…' }}</code>
        <span class="cwd" :title="workingDir">
          <Icon icon="mdi:folder-outline" />
          <span class="cwd-text">{{ workingDir || '—' }}</span>
        </span>
      </div>
      <ElButton type="danger" plain :disabled="status !== 'running'" @click="confirmStop">
        <Icon icon="mdi:stop" /> &nbsp;Stop
      </ElButton>
    </div>

    <div v-if="status === 'exited'" class="exited-banner">
      This process has exited. Stdin is no longer accepted; the agent's next
      <code>exec_shell_output</code> call will reflect the exit.
    </div>

    <div ref="termEl" class="terminal-host" />
  </div>
</template>

<style scoped>
.terminal-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #111;
  color: #e5e7eb;
}
.terminal-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #1f2937;
  background: #0f172a;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.875rem;
}
.back-btn:hover {
  color: #e2e8f0;
}
.header-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #f8fafc;
  white-space: nowrap;
  flex-shrink: 0;
}
.pty-pill {
  background: #1e293b;
  color: #94a3b8;
  border-radius: 4px;
  padding: 0 6px;
  font-size: 0.7rem;
  flex-shrink: 0;
}
.cmd {
  font-family: Consolas, Monaco, monospace;
  font-size: 0.8rem;
  color: #cbd5f5;
  background: transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}
.cwd {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: Consolas, Monaco, monospace;
  font-size: 0.8rem;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  flex: 0 1 auto;
  min-width: 0;
}
.cwd-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.exited-banner {
  padding: 10px 16px;
  background: #78350f;
  color: #fde68a;
  font-size: 0.85rem;
}
.terminal-host {
  flex: 1;
  min-height: 0;
  padding: 8px;
  background: #1e1e1e;
}
</style>
