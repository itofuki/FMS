/* src/lib/push.ts
 * Web Push の購読管理（この端末を通知先として登録 / 解除）
 */
import { supabase } from './supabaseClient';

export type PushState =
  | 'unsupported'      // ブラウザが非対応
  | 'needs-install'    // iOS: ホーム画面に追加したPWAでのみ利用可能
  | 'denied'           // ユーザーが通知をブロックしている
  | 'disabled'         // 未登録
  | 'enabled';         // この端末は登録済み

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const urlB64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const getRegistration = () => navigator.serviceWorker.ready;

// Service Worker が未登録だと serviceWorker.ready は永遠に解決しないため、状態確認には期限を付ける
const getRegistrationWithTimeout = (ms = 5000) =>
  Promise.race([
    getRegistration(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const registration = await getRegistrationWithTimeout();
  if (!registration) return 'unsupported';
  const sub = await registration.pushManager.getSubscription();
  return sub ? 'enabled' : 'disabled';
}

/** 通知の許可を求め、この端末を購読してサーバーに登録する */
export async function enablePush(): Promise<PushState> {
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublicKey) throw new Error('VITE_VAPID_PUBLIC_KEY が設定されていません');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'disabled';

  const registration = await getRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(vapidPublicKey),
    }));

  const { error } = await supabase.rpc('register_push_subscription', {
    p_subscription: subscription.toJSON(),
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
  return 'enabled';
}

/** この端末の購読を解除し、サーバーからも削除する */
export async function disablePush(): Promise<PushState> {
  const subscription = await (await getRegistration()).pushManager.getSubscription();
  if (subscription) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    if (error) throw error;
    await subscription.unsubscribe();
  }
  return 'disabled';
}

/** 自分あてにテスト通知を送る */
export async function sendTestPush(userId: string) {
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: { user_id: userId, title: 'テスト通知', body: 'FMSからの通知は正常に届いています。', url: '/mypage?tab=setting' },
  });
  if (error) throw error;
  return data as { sent: number; failed: number };
}
