import { createRouter, createWebHashHistory } from 'vue-router';
import ChatView from '../views/ChatView.vue';

const routes = [
  // Root: profile selector (or redirect to setup if first time)
  {
    path: '/',
    name: 'home',
    component: () => import('../views/ProfileSelector.vue'),
  },
  // Setup routes
  {
    path: '/setup',
    name: 'setup',
    component: () => import('../views/SetupWizard.vue'),
  },
  {
    path: '/setup/:profile',
    name: 'setup-profile',
    component: () => import('../views/SetupWizard.vue'),
    props: true,
  },
  // Login route for a specific profile
  {
    path: '/login/:profile',
    name: 'login',
    component: () => import('../views/LoginPage.vue'),
    props: true,
  },
  // Profile-scoped routes
  {
    path: '/:profile',
    name: 'chat',
    component: ChatView,
    props: true,
  },
  {
    path: '/:profile/c/:conversationId',
    name: 'conversation',
    component: ChatView,
    props: true,
  },
  {
    path: '/:profile/settings',
    name: 'settings',
    component: () => import('../views/SettingsPage.vue'),
    props: true,
  },
  {
    path: '/:profile/settings/llm',
    name: 'llm-settings',
    component: () => import('../views/LLMSettings.vue'),
    props: true,
  },
  {
    path: '/:profile/settings/tools-skills',
    name: 'tools-skills-settings',
    component: () => import('../views/AgentsToolsSettings.vue'),
    props: true,
  },
  {
    path: '/:profile/settings/profiles',
    name: 'profile-settings',
    component: () => import('../views/ProfileSettings.vue'),
    props: true,
  },
  // Process Manager — long-running exec_shell processes
  {
    path: '/:profile/processes',
    name: 'process-list',
    component: () => import('../views/ProcessList.vue'),
    props: true,
  },
  {
    path: '/:profile/processes/:pid',
    name: 'process-terminal',
    component: () => import('../views/ProcessTerminal.vue'),
    props: true,
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
