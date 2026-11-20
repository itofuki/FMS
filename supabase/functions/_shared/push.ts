// supabase/functions/_shared/push.ts
// Web Push の送信（ユーザーの全端末へ。失効した購読は削除する）
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

let configured = false;
const ensureConfigured = () => {
  if (configured) return;
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  configured = true;
};

export type PushPayload = {
  title: string;
  body: string;
  /** 通知タップ時に開くURL（相対URLならアプリ内） */
  url?: string;
  /** 同じ tag の通知は端末上で置き換わる */
  tag?: string;
  /** 通知に表示するボタン（対応ブラウザのみ） */
  actions?: { action: string; title: string }[];
  /** ボタンごとに開く URL（action → URL）。ないボタンは url を開く */
  actionUrls?: Record<string, string>;
};

export async function sendToUser(supabase: SupabaseClient, userId: string, payload: PushPayload) {
  ensureConfigured();

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("user_id", userId);
  if (error) throw error;
  if (!subs || subs.length === 0) return { sent: 0, failed: 0, total: 0 };

  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 60 * 60 })),
  );

  // 404 / 410 は購読が失効しているので削除する
  const expiredIds: number[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const status = (r.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) expiredIds.push(subs[i].id);
      else console.error("push送信エラー:", r.reason);
    }
  });
  if (expiredIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expiredIds);
  }

  const failed = results.filter((r) => r.status === "rejected").length;
  return { sent: results.length - failed, failed, total: results.length };
}
