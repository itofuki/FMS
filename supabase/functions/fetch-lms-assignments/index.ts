// supabase/functions/fetch-lms-assignments/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LMS_BASE = "https://lms-tokyo.iput.ac.jp";
const REST = `${LMS_BASE}/webservice/rest/server.php`;

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
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

// deno-lint-ignore no-explicit-any
const isTokenError = (data: any) =>
  data?.exception != null && (
    data.errorcode === "invalidtoken" ||
    data.errorcode === "accessdenied" ||
    data.errorcode === "userdeleted"
  );

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // LMS のトークン（ログイン時に lms-login が発行したもの）だけで取得する。パスワードは受け取らない。
    // トークンが切れたら TOKEN_EXPIRED を返し、利用者はログイン画面で入れ直す。
    const { cachedToken, cachedUserId, cachedStatuses = {} } = await req.json();
    // cachedStatuses: { [uid: string]: string } — フロントのキャッシュから渡される提出状況
    // 例: { "assign_123": "submitted", "assign_456": "draft" }

    const token = { value: (cachedToken as string) ?? "" };
    const userId = { value: (cachedUserId as number) ?? 0 };

    if (!token.value || !userId.value) {
      return jsonRes({ error: "認証情報が不足しています", code: "BAD_REQUEST" }, 400);
    }

    const tokenExpired = () =>
      jsonRes({ error: "LMSのログイン有効期限が切れました。再度ログインしてください", code: "TOKEN_EXPIRED" }, 401);

    // ── Step 3: 課題一覧取得
    const assignData = await moodleAPI(token.value, "mod_assign_get_assignments");

    if (isTokenError(assignData)) {
      return tokenExpired();
    }

    if (assignData.exception) {
      return jsonRes({ error: "課題一覧の取得に失敗しました", code: "API_ERROR", detail: assignData.message }, 502);
    }

    const now = Math.floor(Date.now() / 1000);
    const oneMonthAgo = now - 30 * 24 * 60 * 60;

    type RawAttachment = { filename: string; fileurl: string };
    type RawAssign = {
      id: number; cmid: number; name: string; intro: string;
      duedate: number; allowsubmissionsfromdate: number;
      courseShortname: string; courseId: number | null; courseName: string; attachments: RawAttachment[];
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
        // コースの id（時間割の授業と結び付けて科目名を出すため）
        courseId: typeof course.id === "number" ? course.id : null,
        courseName: course.fullname ?? "",
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
      timesort: number; courseShortname: string; courseId: number | null; courseName: string; url: string;
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
            courseId: typeof e.course?.id === "number" ? e.course.id : null,
            courseName: e.course?.fullname ?? "",
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
      courseId: e.courseId,
      courseName: e.courseName,
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
      return buildEvent(assignment, submissionStatus);
    });

    const cachedEvents = useCache.map(assignment =>
      buildEvent(assignment, "submitted")
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
    return jsonRes({ error: msg, code: "EXCEPTION" }, 500);
  }
});

function buildEvent(
  a: { id: number; cmid: number; name: string; intro: string; duedate: number; allowsubmissionsfromdate: number; courseShortname: string; courseId?: number | null; courseName?: string; attachments: { filename: string; fileurl: string }[] },
  submissionStatus: string | null,
) {
  return {
    uid: `assign_${a.id}`,
    summary: a.name,
    description: a.intro,
    start: new Date((a.allowsubmissionsfromdate || a.duedate) * 1000),
    end: new Date(a.duedate * 1000),
    categoryCode: a.courseShortname,
    courseId: a.courseId ?? null,
    courseName: a.courseName ?? "",
    submissionStatus,
    url: `${LMS_BASE}/mod/assign/view.php?id=${a.cmid}`,
    // トークンはURLに埋め込まない（キャッシュ・共有・ログ経由の漏洩防止）。
    // フロント側で開く直前に付与する。
    attachments: a.attachments.map((f) => ({
      filename: f.filename,
      url: f.fileurl,
    })),
  };
}
