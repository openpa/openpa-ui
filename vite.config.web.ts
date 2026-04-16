import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

// Web-only Vite config (no Electron)
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const agentUrl = env.VITE_AGENT_URL || 'http://localhost:10000'

  return {
    base: './',
    define: {
      __IS_ELECTRON__: false,
    },
    build: {
      outDir: 'dist-web',
    },
    server: {
      host: env.HOST || '0.0.0.0',
      port: parseInt(env.PORT) || 8000,
    },
    plugins: [
      vue(),
      Components({
        resolvers: [
          IconsResolver(),
        ],
      }),
      Icons({
        autoInstall: true,
      }),
    ],
  }
})
