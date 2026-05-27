/* src/sw.ts */
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// ① VitePWAがビルド時に生成するキャッシュリストを読み込む（オフライン対応に必須）
precacheAndRoute(self.__WB_MANIFEST);

// ② プッシュ通知を「受け取った」時の処理
self.addEventListener('push', (event) => {
  let data = { title: 'FMS', body: '新しいお知らせがあります' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // 通知の見た目の設定
  const options = {
    body: data.body,
    icon: '/pwa-192x192.png', // スマホに表示されるアプリアイコン
    badge: '/favicon.svg',    // Androidのステータスバーに出る小さなアイコン
    data: {
      url: '/' // 通知をタップした時に開くURL
    }
  };

  // スマホの画面にポップアップを出す
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ③ 通知が「タップされた」時の処理
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // タップされたら通知を消す
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 既にFMSが開いているタブがあれば、そこをアクティブにする
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // 開いていなければ新しくアプリを開く
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});