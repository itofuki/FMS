// src/sw.ts
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
// 🌟 これを追加：分割ダウンロード（Rangeリクエスト）対応プラグイン
import { RangeRequestsPlugin } from 'workbox-range-requests';

declare let self: ServiceWorkerGlobalScope;

// ① VitePWAがビルド時に生成するキャッシュリストを読み込む
precacheAndRoute(self.__WB_MANIFEST);

// 1. ページ遷移（ナビゲーション）をキャッシュする設定
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'pages-cache',
  })
);

// 2. 画像などの静的アセットをキャッシュする設定
registerRoute(
  ({ request, url }) => request.destination === 'image' || /\.(?:png|jpg|jpeg|svg|webp)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'images-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30日間
      }),
    ],
  })
);

// 3. PDFファイルをキャッシュする設定（Supabase & react-pdf 完璧対応版）
registerRoute(
  // 🌟 条件：URLに .pdf が含まれるか、Supabaseのstorageドメイン宛てのリクエストならキャッシュ
  ({ url }) => url.href.toLowerCase().includes('.pdf') || url.href.includes('supabase.co/storage'),
  new CacheFirst({
    cacheName: 'pdf-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200], // 別ドメインからの取得(0)と成功(200)を許可
      }),
      new RangeRequestsPlugin(), // 🌟 追加：react-pdfの分割リクエストを処理可能にする
      new ExpirationPlugin({
        maxEntries: 5,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30日間
      }),
    ],
  })
);

// ... (以下、プッシュ通知の処理はそのまま) ...

// ==========================================
// 🌟 以下は既存のプッシュ通知の処理
// ==========================================

// ② プッシュ通知を「受け取った」時の処理
self.addEventListener('push', (event) => {
  // 🌟 修正ポイント：型を明示的に指定し、url?: string (省略可能) を追加する
  let data: { title: string; body: string; url?: string } = { 
    title: 'FMS', 
    body: '新しいお知らせがあります' 
  };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/pwa-192x192.png',
    badge: '/favicon.svg',
    data: {
      url: data.url || '/' // 👈 これでエラーが消えます！
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});