// supabase/functions/notify-scheduler/index.ts
// pg_cron から毎分呼ばれ、課題の締切リマインダーと授業開始前の通知を送る。
// 認証: Supabase の JWT ではなく、共有シークレット（x-scheduler-secret）で検証する。
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendToUser } from "../_shared/push.ts";
import {
  classUrl, formatRemaining, isDeadlineReminderDue, upcomingPeriod,
} from "../_shared/reminders.ts";

const schedulerSecret = Deno.env.get("NOTIFY_SCHEDULER_SECRET");

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** notification_log に記録できた（＝初回）ものだけ true。先に記録してから送ることで二重送信を防ぐ */
async function claim(supabase: SupabaseClient, userId: string, kind: string, ref: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_log")
    .upsert({ user_id: userId, kind, ref }, { onConflict: "user_id,kind,ref", ignoreDuplicates: true })
    .select("user_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function runDeadlineReminders(supabase: SupabaseClient, now: Date) {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id, deadline_reminder_hours")
    .not("deadline_reminder_hours", "is", null);
  if (error) throw error;
  if (!profiles?.length) return 0;

  const hoursByUser = new Map(profiles.map((p) => [p.user_id as string, p.deadline_reminder_hours as number]));
  const maxHours = Math.max(...hoursByUser.values());

  const { data: deadlines, error: dlError } = await supabase
    .from("user_deadlines")
    .select("user_id, uid, title, deadline, url")
    .in("user_id", [...hoursByUser.keys()])
    .gt("deadline", now.toISOString())
    .lte("deadline", new Date(now.getTime() + maxHours * 3600_000).toISOString());
  if (dlError) throw dlError;

  let sent = 0;
  for (const d of deadlines ?? []) {
    const hours = hoursByUser.get(d.user_id)!;
    const deadlineMs = new Date(d.deadline).getTime();
    if (!isDeadlineReminderDue(deadlineMs, now.getTime(), hours)) continue;
    // 設定時間を ref に含める（設定を変えたら新しい設定で1回通知される）
    if (!(await claim(supabase, d.user_id, "deadline", `${d.uid}:${d.deadline}:${hours}`))) continue;

    await sendToUser(supabase, d.user_id, {
      title: `締切まで${formatRemaining(deadlineMs - now.getTime())}`,
      body: `「${d.title}」が未完了です。提出済みの場合はFMSを開くと更新されます。`,
      url: d.url || "/mypage?tab=assignments",
      tag: `deadline:${d.uid}`,
      actions: [{ action: "open", title: "開く" }, { action: "dismiss", title: "閉じる" }],
    });
    sent++;
  }
  return sent;
}

type TimetableRow = {
  id: number; name: string; wday: string; period: number; classroom: string | null; attendance_id?: number | null;
};

async function runClassReminders(supabase: SupabaseClient, now: Date) {
  const upcoming = upcomingPeriod(now);
  if (!upcoming) return 0;

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("class_start_action", "notify");
  if (error) throw error;

  let sent = 0;
  for (const { user_id } of profiles ?? []) {
    const { data: timetable, error: ttError } = await supabase.rpc("get_user_timetable", { p_user_id: user_id });
    if (ttError) {
      console.error(`時間割の取得に失敗 (${user_id}):`, ttError);
      continue;
    }
    const subject = (timetable as TimetableRow[] | null)?.find(
      (s) => s.wday === upcoming.wday && s.period === upcoming.period,
    );
    if (!subject) continue;
    if (!(await claim(supabase, user_id, "class", `${upcoming.date}:${upcoming.period}`))) continue;

    await sendToUser(supabase, user_id, {
      title: `まもなく${upcoming.period}限「${subject.name}」`,
      body: `${upcoming.startLabel} 開始${subject.classroom ? `（${subject.classroom}）` : ""}。出席ページを開きますか？`,
      url: classUrl(subject.id, subject.attendance_id),
      tag: `class:${upcoming.date}:${upcoming.period}`,
      actions: [{ action: "open", title: "出席ページを開く" }, { action: "dismiss", title: "閉じる" }],
    });
    sent++;
  }
  return sent;
}

Deno.serve(async (req) => {
  if (!schedulerSecret) {
    console.error("🚨 NOTIFY_SCHEDULER_SECRET が設定されていません");
    return new Response("Not configured", { status: 500 });
  }
  if (!timingSafeEqual(req.headers.get("x-scheduler-secret") ?? "", schedulerSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();

  // 片方が失敗してももう片方は実行する
  const [deadline, klass] = await Promise.allSettled([
    runDeadlineReminders(supabase, now),
    runClassReminders(supabase, now),
  ]);
  for (const r of [deadline, klass]) if (r.status === "rejected") console.error("🚨", r.reason);

  return Response.json({
    deadline: deadline.status === "fulfilled" ? deadline.value : "error",
    class: klass.status === "fulfilled" ? klass.value : "error",
  });
});
