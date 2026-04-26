import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Disable the module-preload polyfill inline script.
    // Vite injects a small inline <script> for module preloading that violates
    // our CSP (script-src 'self' blocks all inline scripts). All modern browsers
    // support <link rel="modulepreload"> natively, so the polyfill is unnecessary.
    modulePreload: { polyfill: false },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:1852',
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: 'http://localhost:1852',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
