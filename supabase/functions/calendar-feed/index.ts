// supabase/functions/calendar-feed/index.ts
// カレンダー購読用の .ics を返す。GET /functions/v1/calendar-feed?token=<ユーザーごとのトークン>
// カレンダーアプリはログイン情報を送れないため JWT 検証は無効にし、推測できないトークンで本人を特定する。
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCalendar, type CalendarClass, type CalendarDeadline } from "../_shared/calendar.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return text("Method Not Allowed", 405);

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{48}$/.test(token)) return text("Not Found", 404);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: feed, error: feedError } = await supabase
    .from("calendar_feeds")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (feedError) {
    console.error("購読の確認に失敗:", feedError);
    return text("Internal Server Error", 500);
  }
  // 作り直し・停止された古い URL は 404（カレンダーアプリ側で更新が止まる）
  if (!feed) return text("Not Found", 404);

  const now = new Date();
  const [timetable, deadlines] = await Promise.all([
    supabase.rpc("get_effective_timetable", { p_user_id: feed.user_id }),
    supabase
      .from("user_deadlines")
      .select("uid, title, deadline, url")
      .eq("user_id", feed.user_id)
      // 1 週間前までの締切も残す（直前に提出して一覧から消えたものは、次に FMS を開いたときに消える）
      .gte("deadline", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("deadline"),
  ]);
  if (timetable.error || deadlines.error) {
    console.error("カレンダーの材料の取得に失敗:", timetable.error ?? deadlines.error);
    return text("Internal Server Error", 500);
  }

  const ics = buildCalendar({
    now,
    classes: (timetable.data ?? []) as CalendarClass[],
    deadlines: (deadlines.data ?? []) as CalendarDeadline[],
  });

  return new Response(req.method === "HEAD" ? null : ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="fms.ics"',
      // 個人の予定なので共有キャッシュには載せない
      "Cache-Control": "private, max-age=900",
    },
  });
});
