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
type PushData = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  actions?: { action: string; title: string }[];
};

self.addEventListener('push', (event) => {
  let data: PushData = { title: 'FMS', body: '新しいお知らせがあります' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  // actions は TS の lib 定義に無いブラウザがあるため型を広げて渡す
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: data.body,
    icon: '/pwa-192x192.png',
    badge: '/favicon.svg',
    tag: data.tag,
    data: { url: data.url || '/' },
    actions: data.actions,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ③ 通知をクリックした時の処理
//    「閉じる」ボタンなら何もしない。本文タップ・「開く」ボタンなら URL を開く。
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

// ④ autoUpdate モードの skipWaiting メッセージを処理する
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});