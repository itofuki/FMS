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
      strategies: 'injectManifest', // 🌟 追加（自作のファイルを使うモード）
      srcDir: 'src',                // 🌟 追加（ファイルがあるフォルダ）
      filename: 'sw.ts',            // 🌟 追加（ファイル名）
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        runtimeCaching: [
          {
            // ページ遷移（ナビゲーション）をキャッシュする設定
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst', // ネットワーク優先で取得し、失敗したらキャッシュを表示
            options: {
              cacheName: 'pages-cache',
            },
          },
          {
            // 画像などの静的アセットをキャッシュする設定
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/,
            handler: 'CacheFirst', // キャッシュ優先で取得
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30日間
              },
            },
          },
          {
            urlPattern: /\.(?:pdf)$/,
            handler: 'CacheFirst', // 一度開いたらキャッシュから表示
            options: {
              cacheName: 'pdf-cache',
              expiration: {
                maxEntries: 5, // 保持するPDFの数
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30日間
              },
            },
          },
        ],
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