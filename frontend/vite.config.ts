import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Only generate stats.html when BUNDLE_STATS=1 env var is set.
    // Run: $env:BUNDLE_STATS=1; npm run build
    ...(process.env['BUNDLE_STATS']
      ? [visualizer({ open: false, gzipSize: true, filename: 'dist/stats.html' })]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing vendor deps out of the shared
        // `index` chunk so they cache independently of app code. Lazy route
        // chunks (App.tsx `lazy()`) are unaffected — these only carve the
        // eagerly-imported vendors out of the entry bundle. Function form
        // (vs the record form) sidesteps a Rolldown-Vite typing quirk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id))
            return 'vendor-react'
          if (/[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/.test(id))
            return 'vendor-query'
          if (/[\\/]node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector)[\\/]/.test(id))
            return 'vendor-i18n'
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id))
            return 'vendor-radix'
          return undefined
        },
      },
    },
  },
})
