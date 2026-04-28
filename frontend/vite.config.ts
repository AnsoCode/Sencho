import { defineConfig, type PluginOption } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import { readFileSync } from 'fs'

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ANALYZE=true npm run build emits dist/stats.html for ad-hoc bundle
    // inspection. Off by default so CI / production builds skip the work.
    process.env.ANALYZE === 'true' && (visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }) as PluginOption),
  ].filter(Boolean) as PluginOption[],
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
    // The monaco chunk is intentionally large (~3 MB minified). Bumping the
    // warning ceiling so the always-firing 500 KB limit does not drown out a
    // genuine future regression.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Group heavyweight vendor libraries into stable chunks so a small
        // app-code change does not bust their cache key. Each chunk is
        // independently large enough to justify its own HTTP/2 stream.
        // Function form (rather than the object form) because Vite 8's
        // OutputOptions overload narrows manualChunks to the function shape.
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor/react')) return 'monaco';
          if (id.includes('node_modules/@xterm/')) return 'xterm';
          if (id.includes('node_modules/recharts')) return 'charts';
          if (id.includes('node_modules/@xyflow/react') || id.includes('node_modules/@dagrejs/dagre')) return 'flow';
          if (id.includes('node_modules/motion/')) return 'motion';
        },
      },
    },
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
