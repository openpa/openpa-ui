import { defineStore } from 'pinia';
import { ref } from 'vue';
import { listProcesses, type ProcessRow } from '../services/processApi';
import { useSettingsStore } from './settings';

/**
 * Process Manager list state.
 *
 * Holds only the summary list.  Per-pid xterm.js instances and WebSocket
 * connections live in the terminal view component so DOM-bound objects
 * aren't trapped in the store.
 */
export const useProcessManagerStore = defineStore('processManager', () => {
  const processes = ref<ProcessRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    const settings = useSettingsStore();
    if (!settings.agentUrl || !settings.authToken) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await listProcesses(settings.agentUrl, settings.authToken);
      processes.value = res.processes || [];
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function pollStart(intervalMs = 5000) {
    pollStop();
    void refresh();
    pollTimer = setInterval(() => {
      void refresh();
    }, intervalMs);
  }

  function pollStop() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    processes,
    loading,
    error,
    refresh,
    pollStart,
    pollStop,
  };
});
