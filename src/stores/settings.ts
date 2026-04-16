import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { fetchMe } from '../services/agentApi';

export type ProfileValue = string | boolean | number | Record<string, unknown>;

// ── Per-profile token helpers ──

function _getLoggedInProfiles(): string[] {
  try {
    const raw = localStorage.getItem('logged_in_profiles');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _saveLoggedInProfiles(profiles: string[]) {
  localStorage.setItem('logged_in_profiles', JSON.stringify(profiles));
}

function _migrateOldToken() {
  // Migrate from old single-token format to per-profile format
  const oldToken = localStorage.getItem('agent_auth_token');
  const oldProfileId = localStorage.getItem('profile_id');
  if (oldToken && oldProfileId) {
    const key = `agent_token_${oldProfileId}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, oldToken);
      const profiles = _getLoggedInProfiles();
      if (!profiles.includes(oldProfileId)) {
        profiles.push(oldProfileId);
        _saveLoggedInProfiles(profiles);
      }
    }
    localStorage.removeItem('agent_auth_token');
  }
}

// Run migration on module load
_migrateOldToken();

export const useSettingsStore = defineStore('settings', () => {
  // Auto-connect to agent on app load
  const autoConnect = ref(localStorage.getItem('auto_connect') === 'true');

  // Agent URL (for direct connection, mainly used in Electron mode)
  const agentUrl = ref(localStorage.getItem('agent_url') || 'http://localhost:10000');

  // UI theme
  const theme = ref<'light' | 'dark'>(
    (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
  );

  // Active profile ID (the currently-used profile for this tab session)
  const profileId = ref(localStorage.getItem('profile_id') || '');

  // Active authentication token (for the current profile session)
  const authToken = ref('');

  // Working directory from backend (for resolving absolute file paths to API URLs)
  const workingDir = ref('');

  // Reasoning toggle (per-profile, default: enabled)
  const reasoningEnabled = ref(true);

  // Detect if running in Electron
  const isElectron = computed(() => {
    return typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__;
  });

  // ── Per-profile token management ──

  function getTokenForProfile(profileName: string): string {
    return localStorage.getItem(`agent_token_${profileName}`) || '';
  }

  function setTokenForProfile(profileName: string, token: string) {
    localStorage.setItem(`agent_token_${profileName}`, token);
    const profiles = _getLoggedInProfiles();
    if (!profiles.includes(profileName)) {
      profiles.push(profileName);
      _saveLoggedInProfiles(profiles);
    }
  }

  function getReasoningEnabled(profileName: string): boolean {
    const val = localStorage.getItem(`reasoning_enabled_${profileName}`);
    return val !== 'false'; // default: true
  }

  function setReasoningEnabled(profileName: string, enabled: boolean) {
    reasoningEnabled.value = enabled;
    localStorage.setItem(`reasoning_enabled_${profileName}`, String(enabled));
  }

  function removeTokenForProfile(profileName: string) {
    localStorage.removeItem(`agent_token_${profileName}`);
    const profiles = _getLoggedInProfiles().filter(p => p !== profileName);
    _saveLoggedInProfiles(profiles);
  }

  function getLoggedInProfiles(): string[] {
    return _getLoggedInProfiles();
  }

  /**
   * Activate a profile for the current session.
   * Loads the stored token for this profile and sets it as active.
   * Returns true if the profile has a stored token.
   */
  function activateProfile(profileName: string): boolean {
    const token = getTokenForProfile(profileName);
    if (!token) return false;

    authToken.value = token;
    profileId.value = profileName;
    reasoningEnabled.value = getReasoningEnabled(profileName);

    fetchMe(agentUrl.value, token)
      .then((me) => {
        if (me.working_dir) {
          workingDir.value = me.working_dir;
        }
      })
      .catch(() => {});
    return true;
  }

  // ── Legacy methods ──

  function setAutoConnect(value: boolean) {
    autoConnect.value = value;
    localStorage.setItem('auto_connect', String(value));
  }

  function setAgentUrl(url: string) {
    const trimmedUrl = url.trim();
    if (trimmedUrl && (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://'))) {
      agentUrl.value = trimmedUrl;
      localStorage.setItem('agent_url', trimmedUrl);
    } else if (trimmedUrl === '') {
      const defaultUrl = 'http://localhost:10000';
      agentUrl.value = defaultUrl;
      localStorage.setItem('agent_url', defaultUrl);
    } else {
      console.warn('Invalid agent URL format. Must start with http:// or https://');
    }
  }

  function setTheme(newTheme: 'light' | 'dark') {
    theme.value = newTheme;
    localStorage.setItem('theme', newTheme);
  }

  function setProfileId(id: string) {
    profileId.value = id;
  }

  function setAuthToken(token: string) {
    authToken.value = token;
    if (token) {
      // Fetch profile from backend and update profileId + per-profile storage
      fetchMe(agentUrl.value, token)
        .then((me) => {
          if (me.profile) {
            setProfileId(me.profile);
            setTokenForProfile(me.profile, token);
          }
          if (me.working_dir) {
            workingDir.value = me.working_dir;
          }
        })
        .catch(() => {
          // Token may be invalid or server unreachable — ignore silently
        });
    } else {
      setProfileId('');
    }
  }

  function exportSettings(): string {
    return JSON.stringify({
      autoConnect: autoConnect.value,
      agentUrl: agentUrl.value,
      theme: theme.value,
      profileId: profileId.value,
    }, null, 2);
  }

  function importSettings(json: string) {
    const data = JSON.parse(json);
    if (data.autoConnect !== undefined) setAutoConnect(data.autoConnect);
    if (data.agentUrl !== undefined) setAgentUrl(data.agentUrl);
    if (data.theme !== undefined) setTheme(data.theme);
  }

  return {
    autoConnect,
    agentUrl,
    theme,
    profileId,
    authToken,
    workingDir,
    isElectron,
    setAutoConnect,
    setAgentUrl,
    setTheme,
    setProfileId,
    setAuthToken,
    exportSettings,
    importSettings,
    // Per-profile token management
    getTokenForProfile,
    setTokenForProfile,
    removeTokenForProfile,
    getLoggedInProfiles,
    activateProfile,
    // Reasoning toggle
    reasoningEnabled,
    getReasoningEnabled,
    setReasoningEnabled,
  };
});
