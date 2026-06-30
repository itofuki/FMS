// vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest', // 🌟 自作の src/sw.ts を使う
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      
      // 🌟 workbox ではなく injectManifest オプションに変更
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,pdf}'],
      },
      
      // 🌟 超重要：これがないと npm run dev (localhost) で動かない
      devOptions: {
        enabled: true,
        type: 'module',
      },

      manifest: {
        name: 'FMS',
        short_name: 'FMS',
        description: 'FMSアプリケーション',
        theme_color: '#182438',
        background_color: '#182438',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});