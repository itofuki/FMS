// supabase/functions/fetch-lms-assignments/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LMS_BASE = "https://lms-tokyo.iput.ac.jp";
const REST = `${LMS_BASE}/webservice/rest/server.php`;

const jsonRes = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const moodleAPI = async (token: string, wsfunction: string, params: Record<string, string> = {}) => {
  const res = await fetch(REST, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: "json", ...params }),
  });
  return res.json();
};

const isTokenError = (data: any) =>
  data?.exception != null && (
    data.errorcode === "invalidtoken" ||
    data.errorcode === "accessdenied" ||
    data.errorcode === "userdeleted"
  );

const reAuthenticate = async (username: string, password: string, token: { value: string }, userId: { value: number }) => {
  const tokenRes = await fetch(`${LMS_BASE}/login/token.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, service: "moodle_mobile_app" }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.token) return false;
  token.value = tokenData.token;
  const siteInfo = await moodleAPI(token.value, "core_webservice_get_site_info");
  userId.value = siteInfo.userid;
  return true;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { username, password, cachedToken, cachedUserId, cachedStatuses = {} } = await req.json();
    // cachedStatuses: { [uid: string]: string } — フロントのキャッシュから渡される提出状況
    // 例: { "assign_123": "submitted", "assign_456": "draft" }

    if (!username || !password) {
      return jsonRes({ error: "username と password が必要です", code: "BAD_REQUEST" });
    }

    const token = { value: (cachedToken as string) ?? "" };
    const userId = { value: (cachedUserId as number) ?? 0 };

    // ── Step 1 & 2: 認証（キャッシュがあればスキップ）
    if (!token.value || !userId.value) {
      const ok = await reAuthenticate(username, password, token, userId);
      if (!ok) return jsonRes({ error: "IDまたはパスワードが正しくありません", code: "AUTH_FAILED" });
    }

    // ── Step 3: 課題一覧取得
    let assignData = await moodleAPI(token.value, "mod_assign_get_assignments");

    if (isTokenError(assignData)) {
      const ok = await reAuthenticate(username, password, token, userId);
      if (!ok) return jsonRes({ error: "IDまたはパスワードが正しくありません", code: "AUTH_FAILED" });
      assignData = await moodleAPI(token.value, "mod_assign_get_assignments");
    }

    if (assignData.exception) {
      return jsonRes({ error: "課題一覧の取得に失敗しました", code: "API_ERROR", detail: assignData.message });
    }

    const now = Math.floor(Date.now() / 1000);
    const oneMonthAgo = now - 30 * 24 * 60 * 60;

    type RawAttachment = { filename: string; fileurl: string };
    type RawAssign = {
      id: number; cmid: number; name: string; intro: string;
      duedate: number; allowsubmissionsfromdate: number;
      courseShortname: string; attachments: RawAttachment[];
    };

    const targets: RawAssign[] = (assignData.courses ?? []).flatMap((course: any) =>
      (course.assignments ?? []).map((a: any) => ({
        id: a.id,
        cmid: a.cmid,
        name: a.name,
        intro: a.intro ?? "",
        duedate: a.duedate ?? 0,
        allowsubmissionsfromdate: a.allowsubmissionsfromdate ?? 0,
        courseShortname: course.shortname,
        attachments: [...(a.introattachments ?? []), ...(a.activityattachments ?? [])]
          .filter((f: any) => f.filename && f.fileurl)
          .map((f: any) => ({ filename: f.filename, fileurl: f.fileurl })),
      }))
    ).filter((a: RawAssign) => a.duedate > 0 && a.duedate > oneMonthAgo);

    // ── Step 3b: カレンダーの「アクションイベント」を取得
    // mod_assign_get_assignments は「課題」モジュールしか返さないため、
    // アンケート（mod_questionnaire 等、モジュール種別不明のもの含む）を含む
    // 他モジュールの締切イベントは、Moodleカレンダー自体が使う汎用APIで拾う。
    const calTimesortFrom = oneMonthAgo;
    const calTimesortTo = now + 60 * 24 * 60 * 60;

    const calData = await moodleAPI(token.value, "core_calendar_get_action_events_by_timesort", {
      timesortfrom: String(calTimesortFrom),
      timesortto: String(calTimesortTo),
      limitnum: "50",
    });

    // 課題(assign)由来のイベントは Step 3 側で既に扱っているため重複除外。
    // "open" は活動の受付開始通知であり締切ではないため除外。
    const excludedEventTypes = new Set(["due", "gradingduedate", "open"]);

    type RawCalEvent = {
      id: number; name: string; description: string;
      timesort: number; courseShortname: string; url: string;
    };

    const calTargets: RawCalEvent[] = !calData?.exception
      ? (calData.events ?? [])
          .filter((e: any) => !excludedEventTypes.has(e.eventtype) && e.timesort)
          .map((e: any) => ({
            id: e.id,
            name: e.name,
            description: e.description ?? "",
            timesort: e.timesort,
            courseShortname: e.course?.shortname ?? "",
            url: e.url || e.action?.url || `${LMS_BASE}/calendar/view.php?view=day&time=${e.timesort}`,
          }))
      : [];

    const calendarEvents = calTargets.map((e) => ({
      uid: `cal_${e.id}`,
      summary: e.name,
      description: e.description,
      start: new Date(e.timesort * 1000),
      end: new Date(e.timesort * 1000),
      categoryCode: e.courseShortname,
      submissionStatus: null as string | null,
      url: e.url,
      attachments: [] as { filename: string; url: string }[],
    }));

    // ── Step 4: 差分取得 — 提出済みキャッシュがある課題はスキップ
    const toFetch = targets.filter(a => cachedStatuses[`assign_${a.id}`] !== "submitted");
    const useCache = targets.filter(a => cachedStatuses[`assign_${a.id}`] === "submitted");

    const freshResults = await Promise.allSettled(
      toFetch.map((a) =>
        moodleAPI(token.value, "mod_assign_get_submission_status", {
          assignid: String(a.id),
          userid: String(userId.value),
        })
      )
    );

    // ── Step 5: 結合・整形
    const freshEvents = toFetch.map((assignment, i) => {
      let submissionStatus: string | null = null;
      const result = freshResults[i];
      if (result.status === "fulfilled" && !result.value.exception) {
        const attempt = result.value.lastattempt;
        submissionStatus = attempt?.submission?.status ?? attempt?.teamsubmission?.status ?? null;
      }
      return buildEvent(assignment, submissionStatus, token.value);
    });

    const cachedEvents = useCache.map(assignment =>
      buildEvent(assignment, "submitted", token.value)
    );

    const events = [...freshEvents, ...cachedEvents, ...calendarEvents]
      .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());

    return jsonRes({
      events,
      token: token.value,
      userId: userId.value,
      skippedCount: useCache.length,
      fetchedCount: toFetch.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonRes({ error: msg, code: "EXCEPTION" });
  }
});

function buildEvent(
  a: { id: number; cmid: number; name: string; intro: string; duedate: number; allowsubmissionsfromdate: number; courseShortname: string; attachments: { filename: string; fileurl: string }[] },
  submissionStatus: string | null,
  token: string
) {
  return {
    uid: `assign_${a.id}`,
    summary: a.name,
    description: a.intro,
    start: new Date((a.allowsubmissionsfromdate || a.duedate) * 1000),
    end: new Date(a.duedate * 1000),
    categoryCode: a.courseShortname,
    submissionStatus,
    url: `${LMS_BASE}/mod/assign/view.php?id=${a.cmid}`,
    attachments: a.attachments.map((f) => ({
      filename: f.filename,
      url: `${f.fileurl}${f.fileurl.includes("?") ? "&" : "?"}token=${token}`,
    })),
  };
}
