// supabase/functions/lms-login/index.ts
// LMS（Moodle）の ID とパスワードで FMS にログインする（Open LMS アプリと同じ login/token.php で本人確認）。
//
//   1. ID とパスワードを LMS の login/token.php に送り、LMS のトークンを受け取る（パスワードは保存しない）
//   2. LMS のユーザー ID ごとに FMS のアカウント（lms-<id>@users.fms.invalid）を用意する（なければ作る）
//   3. そのアカウントのセッションを発行し、LMS のトークンと一緒に返す（ログイン直後から LMS 連携が使える）
//
// ログイン前に呼ばれるため JWT 検証は無効（config.toml）。
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ログインに使える LMS のサイト。ここにないサイトは受け付けない（どの Moodle でも通すと、
// IPUT 以外のアカウントでも FMS のアカウントを作れてしまうため）。時間割などは東京キャンパス向けなので、今は東京だけ
const ALLOWED_SITES = ["lms-tokyo.iput.ac.jp"];

/** 「https://lms-tokyo.iput.ac.jp/」のような入力を「lms-tokyo.iput.ac.jp」にそろえる */
const normalizeSite = (raw: string) => raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** LMS のユーザー ID から、FMS のアカウントのメールアドレス（実在しない .invalid ドメイン。ログインの識別だけに使う） */
const accountEmail = (lmsUserId: number) => `lms-${lmsUserId}@users.fms.invalid`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  let username = "";
  let password = "";
  let site = ALLOWED_SITES[0];
  try {
    const body = await req.json();
    username = typeof body?.username === "string" ? body.username.trim() : "";
    password = typeof body?.password === "string" ? body.password : "";
    if (typeof body?.site === "string" && body.site.trim()) site = normalizeSite(body.site);
  } catch {
    /* 下でまとめて弾く */
  }
  if (!username || !password || username.length > 100 || password.length > 200) {
    return json({ error: "ID とパスワードを入力してください", code: "BAD_REQUEST" }, 400);
  }
  if (!ALLOWED_SITES.includes(site)) {
    return json({ error: `このサイト（${site}）にはまだ対応していません。${ALLOWED_SITES.join("、")} を入力してください`, code: "UNSUPPORTED_SITE" }, 400);
  }
  const LMS_BASE = `https://${site}`;

  // 1. LMS で本人確認（Open LMS アプリと同じサービス）
  let lmsToken: string;
  let lmsUserId: number;
  let fullName = "";
  try {
    const tokenRes = await fetch(`${LMS_BASE}/login/token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, service: "moodle_mobile_app" }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData?.token) {
      return json({ error: "ID またはパスワードが正しくありません", code: "AUTH_FAILED" }, 401);
    }
    lmsToken = tokenData.token;

    const infoRes = await fetch(`${LMS_BASE}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ wstoken: lmsToken, wsfunction: "core_webservice_get_site_info", moodlewsrestformat: "json" }),
    });
    const info = await infoRes.json();
    if (!info?.userid) throw new Error(info?.message ?? "site info");
    lmsUserId = Number(info.userid);
    fullName = typeof info.fullname === "string" ? info.fullname : "";
  } catch (e) {
    console.error("LMS への接続に失敗:", e);
    return json({ error: "LMS に接続できませんでした。時間をおいてもう一度お試しください", code: "LMS_UNAVAILABLE" }, 502);
  }

  // 2. FMS のアカウントを用意する（なければ作る）
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const email = accountEmail(lmsUserId);
  const metadata = { lms_user_id: lmsUserId, lms_username: username, full_name: fullName };
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: metadata });
  if (created.error && !/already|exists|registered/i.test(created.error.message)) {
    console.error("アカウントの作成に失敗:", created.error);
    return json({ error: "ログインに失敗しました", code: "INTERNAL" }, 500);
  }

  // 3. セッションを発行する（管理者権限でワンタイムのリンクを作り、その場で使う。メールは送られない）
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    console.error("ログインリンクの作成に失敗:", link.error);
    return json({ error: "ログインに失敗しました", code: "INTERNAL" }, 500);
  }
  const userId = link.data.user?.id;
  if (userId && !created.data?.user) {
    // 2 回目以降は、LMS 側で変わったかもしれない名前などを更新しておく（アイコンなど FMS で設定した値は残す）
    await admin.auth.admin.updateUserById(userId, { user_metadata: { ...(link.data.user?.user_metadata ?? {}), ...metadata } });
  }

  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const verified = await anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  const session = verified.data?.session;
  if (verified.error || !session) {
    console.error("セッションの発行に失敗:", verified.error);
    return json({ error: "ログインに失敗しました", code: "INTERNAL" }, 500);
  }

  // 通知の設定などを置くプロフィールの行を用意しておく（あれば何もしない）
  const profile = await admin.from("profiles").upsert({ user_id: session.user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (profile.error) console.warn("プロフィールの用意に失敗（続行）:", profile.error.message);

  return json({
    session: { access_token: session.access_token, refresh_token: session.refresh_token },
    lms: { token: lmsToken, userId: lmsUserId, username },
  });
});
