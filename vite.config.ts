import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const productionCsp = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client https://apis.google.com https://cdn.jsdelivr.net",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://openrouter.ai",
  "frame-src https://accounts.google.com https://docs.google.com https://drive.google.com",
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ')

function securityMetaPlugin(): Plugin {
  return {
    name: 'o-wallet-security-meta',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        // Vite dev needs websocket/HMR permissions. Production receives the strict CSP.
        if (context.server) return html.replace('<!-- OWALLET_SECURITY_META -->', '')
        const meta = `<meta http-equiv="Content-Security-Policy" content="${productionCsp.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" />`
        return html.replace('<!-- OWALLET_SECURITY_META -->', meta)
      },
    },
  }
}

export default defineConfig({
  // Relative assets work on localhost, GitHub project pages and custom domains.
  base: './',
  build: {
    sourcemap: false,
  },
  plugins: [
    securityMetaPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'O-Wallet',
        short_name: 'O-Wallet',
        description: 'Private, local-first expense tracker with encrypted Google Drive sync.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // Do not persist third-party executable OCR assets in O-Wallet's service-worker
        // cache. They remain constrained by CSP and the browser's ordinary HTTP cache.
        runtimeCaching: [],
      },
    }),
  ],
})
