import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // This is a repository (project) Pages site, served from /Samparka/.
  // Keep this base in sync with the repository name and the Pages URL.
  base: '/Samparka/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Samparka — Keep close',
        short_name: 'Samparka',
        description: 'A thoughtful home for the people who matter.',
        theme_color: '#f6f7f2',
        background_color: '#f6f7f2',
        display: 'standalone',
        start_url: '/Samparka/',
        scope: '/Samparka/',
        icons: [
          { src: '/Samparka/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/Samparka/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/Samparka/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/Samparka/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        runtimeCaching: [],
      },
      devOptions: { enabled: true },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
