import { defineConfig, defaultClientConditions, defaultServerConditions } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * MapLibre runs its renderer worker from a separate file. Vite's dev server injects its
 * client (which needs `document`) into every module it serves, which breaks the worker,
 * so the self-contained worker is copied to public/ and served as a static file.
 */
function maplibreWorker(): Plugin {
  return {
    name: 'agmeo:maplibre-worker',
    // `config` runs before the dev server indexes public/.
    config() {
      const pkg = createRequire(import.meta.url).resolve('maplibre-gl/package.json')
      mkdirSync('public', { recursive: true })
      copyFileSync(join(dirname(pkg), 'dist/maplibre-gl-worker.mjs'), 'public/maplibre-gl-worker.mjs')
    },
  }
}

// Resolve @agmeo/contracts from its TypeScript sources (no build step in development).
const sourceCondition = '@agmeo/source'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    conditions: [sourceCondition, ...defaultClientConditions],
  },
  ssr: { resolve: { conditions: [sourceCondition, ...defaultServerConditions] } },
  server: {
    port: 3000,
    proxy: {
      // The browser talks to the API same-origin; in production an ingress routes /api.
      '/api': {
        target: process.env.AGMEO_API_URL ?? 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [maplibreWorker(), devtools(), tailwindcss(), tanstackStart(), viteReact()],
})
