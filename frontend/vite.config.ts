import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The Spring Boot backend sets no CORS headers, so in dev we proxy same-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_URL || 'http://localhost:8080'
  // No sign-in screen: the proxy authenticates to the backend. Not VITE_-prefixed, so it never reaches the bundle.
  const auth = env.BACKEND_USER && env.BACKEND_PASSWORD ? `${env.BACKEND_USER}:${env.BACKEND_PASSWORD}` : undefined
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    define: { global: 'globalThis' }, // sockjs-client expects a Node-style global
    server: {
      port: 5173,
      proxy: {
        '/api': { target: backend, changeOrigin: true, auth },
        '/ws': { target: backend, changeOrigin: true, ws: true, auth },
      },
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
