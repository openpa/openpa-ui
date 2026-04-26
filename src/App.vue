<script setup lang="ts">
import { computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from './stores/chat';
import { useSettingsStore } from './stores/settings';
import { useConfigStore } from './stores/config';
import { checkSetupStatus } from './services/configApi';
import Sidebar from './components/Sidebar.vue';
import { ElMessage } from 'element-plus';

const route = useRoute();
const router = useRouter();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const configStore = useConfigStore();

// Detect if running in Electron
const isElectron = computed(() => {
  return typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__;
});

// Get current profile from route
const currentProfile = computed(() => {
  return (route.params.profile as string) || '';
});

// Check if we should show the sidebar (only on chat page with a profile)
const showSidebar = computed(() => {
  return (route.name === 'chat' || route.name === 'conversation') && !!currentProfile.value;
});

// Routes that are profile-scoped and require auth
const PROFILE_ROUTES = new Set(['chat', 'conversation', 'settings', 'llm-settings', 'tools-skills-settings', 'profile-settings', 'process-list', 'process-terminal', 'skill-events']);

// Apply theme to document
const applyTheme = () => {
  document.documentElement.setAttribute('data-theme', settingsStore.theme);
};

watch(() => settingsStore.theme, applyTheme);

// Auth gate: check profile validity and token on route changes
async function checkProfileAuth(profileName: string) {
  if (!profileName) return;

  // Check if we already have a token for this profile
  const token = settingsStore.getTokenForProfile(profileName);
  if (!token) {
    router.replace(`/login/${profileName}`);
    return;
  }

  // Verify profile exists on server
  try {
    const status = await checkSetupStatus(settingsStore.agentUrl, profileName);
    if (status.profile_exists === false) {
      // Redirect to login page which shows persistent "profile does not exist" error
      router.replace(`/login/${profileName}`);
      return;
    }
  } catch {
    // Server unreachable — proceed with cached token
  }

  // Track previous profile to detect switches
  const previousProfile = settingsStore.profileId;

  // Activate the profile for this session
  settingsStore.activateProfile(profileName);

  // Reset chat state when switching to a different profile
  if (previousProfile && previousProfile !== profileName) {
    await chatStore.resetForProfileSwitch();
  } else if (!chatStore.isConnected) {
    // Same profile or initial load — just connect if needed
    try {
      await chatStore.connect();
    } catch (e) {
      // Connection failure handled by chat store
    }
  }
}

// Watch route changes to enforce auth gate
watch(
  () => [route.name, route.params.profile],
  ([routeName, profile]) => {
    if (routeName && PROFILE_ROUTES.has(routeName as string) && profile) {
      checkProfileAuth(profile as string);
    }
  },
);

onMounted(async () => {
  applyTheme();

  // Handle OAuth callback redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get('agents') === 'open') {
    params.delete('agents');
    const clean = params.toString();
    const newUrl = window.location.pathname + (clean ? '?' + clean : '');
    window.history.replaceState({}, '', newUrl);

    if (window.opener) {
      window.opener.postMessage({ type: 'a2a-auth-complete' }, window.location.origin);
      window.close();
      return;
    }
  }

  // Initial auth gate check for current route
  const routeName = route.name as string;
  const profile = route.params.profile as string;
  if (routeName && PROFILE_ROUTES.has(routeName) && profile) {
    await checkProfileAuth(profile);
  }
});

const handleNewChat = () => {
  chatStore.clearConversation();
  if (currentProfile.value) {
    router.push({ name: 'chat', params: { profile: currentProfile.value } });
  }
};

const handleOpenSettings = () => {
  if (currentProfile.value) {
    router.push(`/${currentProfile.value}/settings`);
  }
};

const handleLogout = () => {
  const profile = currentProfile.value;
  if (profile) {
    settingsStore.removeTokenForProfile(profile);
  }
  // Disconnect chat if connected
  if (chatStore.isConnected) {
    chatStore.disconnect();
  }
  // Clear active session
  settingsStore.authToken = '';
  settingsStore.profileId = '';
  router.push('/');
};
</script>

<template>
  <!-- Titlebar for dragging (Electron only) -->
  <div v-if="isElectron" class="titlebar"></div>

  <!-- Main App Layout -->
  <div class="app-layout" :class="{ 'has-titlebar': isElectron }">
    <!-- Sidebar -->
    <Sidebar
      v-if="showSidebar"
      @newChat="handleNewChat"
      @openSettings="handleOpenSettings"
      @logout="handleLogout"
    />

    <!-- Main Content Area -->
    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>

</template>

<style>
.titlebar {
  height: 32px;
  width: 100%;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1999;
  -webkit-app-region: drag;
  pointer-events: auto;
  background: var(--surface-color);
  border-bottom: 1px solid var(--border-color);
}

.app-layout {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.app-layout.has-titlebar {
  padding-top: 32px;
  box-sizing: border-box;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}
</style>
