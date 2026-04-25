import { defineStore } from 'pinia';
import type { TerminalAttachment } from './chat';

const WIDTH_STORAGE_KEY = 'terminalPanelWidth';
const MIN_PANEL_WIDTH = 280;
const MIN_CHAT_WIDTH = 320;
const DEFAULT_PANEL_WIDTH = 480;

function loadInitialWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  return Number.isFinite(raw) && raw >= MIN_PANEL_WIDTH ? raw : DEFAULT_PANEL_WIDTH;
}

interface State {
  openTerminals: TerminalAttachment[];
  activePid: string | null;
  minimized: boolean;
  panelWidth: number;
}

export const useTerminalPanelStore = defineStore('terminalPanel', {
  state: (): State => ({
    openTerminals: [],
    activePid: null,
    minimized: true,
    panelWidth: loadInitialWidth(),
  }),

  getters: {
    visible(state): boolean {
      return !state.minimized && state.openTerminals.length > 0;
    },
  },

  actions: {
    openTerminal(attachment: TerminalAttachment) {
      const existing = this.openTerminals.find(t => t.processId === attachment.processId);
      if (!existing) {
        this.openTerminals.push({ ...attachment });
      }
      this.activePid = attachment.processId;
      this.minimized = false;
    },

    setActive(pid: string) {
      if (this.openTerminals.some(t => t.processId === pid)) {
        this.activePid = pid;
        this.minimized = false;
      }
    },

    closeTab(pid: string) {
      const idx = this.openTerminals.findIndex(t => t.processId === pid);
      if (idx === -1) return;
      this.openTerminals.splice(idx, 1);
      if (this.activePid === pid) {
        const next = this.openTerminals[idx] || this.openTerminals[idx - 1] || null;
        this.activePid = next ? next.processId : null;
      }
      if (this.openTerminals.length === 0) {
        this.minimized = true;
      }
    },

    minimize() {
      this.minimized = true;
    },

    restore() {
      if (this.openTerminals.length > 0) {
        this.minimized = false;
      }
    },

    setWidth(px: number) {
      const maxWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - MIN_CHAT_WIDTH);
      const clamped = Math.min(Math.max(px, MIN_PANEL_WIDTH), maxWidth);
      this.panelWidth = clamped;
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
      } catch {
        // localStorage may be unavailable (private mode); ignore.
      }
    },
  },
});
