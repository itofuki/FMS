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

/**
 * この端末がすでに通知の購読をしていれば、今ログインしているアカウントの通知先としてサーバーに登録し直す。
 * アカウントを作り直した（古いアカウントを消した）ときや、同じ端末で別のアカウントに切り替えたときに、
 * 端末では通知がオンなのにサーバーに登録がなく、通知が届かない（テスト通知も失敗する）のを防ぐ。
 * 何度呼んでも同じ（同じ端末の登録は上書きされる）。失敗しても画面は止めない
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
    const registration = await getRegistrationWithTimeout();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await supabase.rpc('register_push_subscription', {
      p_subscription: subscription.toJSON(),
      p_user_agent: navigator.userAgent.slice(0, 300),
    });
  } catch {
    // 通知の登録し直しに失敗しても、ほかの機能には関係ない
  }
}

/**
 * 通知を送る関数（send-push）のエラーを、画面に出せる文にする。
 * サーバーに通知先の登録がないとき（404）は、どうすればよいかを伝える
 */
export async function pushErrorText(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json() as { error?: string };
      if (ctx.status === 404) return 'この端末の通知先が登録されていません。「この端末で受け取る」を一度オフにしてからオンにしてください。';
      if (body?.error) return body.error;
    } catch { /* 本文が JSON でないときは下へ */ }
  }
  return error instanceof Error ? error.message : String(error);
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

/**
 * 授業の 5 分前の通知を、今すぐ試しに送る（本物と同じ見た目・ボタン・開く場所）。
 * 自分の時間割から、出席ページのある授業（なければ最初の授業）を選んで使う。
 */
export async function sendClassTestPush(userId: string) {
  const { data: rows } = await supabase.rpc('get_effective_timetable', { p_user_id: userId });
  const list = (rows ?? []) as { id: number; name: string; period: number; classroom: string | null; attendance_id: number | null }[];
  const s = list.find((r) => r.attendance_id) ?? list[0];
  const lms = 'https://lms-tokyo.iput.ac.jp';
  const attendUrl = s
    ? (s.attendance_id ? `${lms}/mod/attendance/view.php?id=${s.attendance_id}` : `${lms}/course/view.php?id=${s.id}`)
    : `${lms}/my/`;
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: {
      user_id: userId,
      title: `（テスト）まもなく${s?.period ?? 1}限「${s?.name ?? '授業'}」`,
      body: `5 分後に開始${s?.classroom ? `（${s.classroom}）` : ''}。押すと FMS の時間割が開き、パスワードか QR コードで出席できます。`,
      // 本文を押したとき（iPhone はこちら）: FMS の時間割を開き、その授業の行（パスワード欄）へ移る
      url: '/mypage?' + new URLSearchParams({
        tab: 'timetable', attend: '1', name: s?.name ?? '授業', period: String(s?.period ?? 1),
        start: '', room: s?.classroom ?? '', link: attendUrl,
      }).toString(),
      tag: 'class:test',
      actions: [{ action: 'attend', title: '出席ページ' }, { action: 'qr', title: 'QR を読み取る' }],
      actionUrls: { attend: attendUrl, qr: '/mypage?tab=timetable&scan=1' },
    },
  });
  if (error) throw error;
  return data as { sent: number; failed: number };
}
