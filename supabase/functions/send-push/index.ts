// supabase/functions/send-push/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendToUser } from "../_shared/push.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// JWTのpayloadを読む（署名検証は verify_jwt=true によりゲートウェイ側で済んでいる前提）
const decodeJwtRole = (jwt: string): string | null => {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user_id, title, body, url, tag, actions, actionUrls } = await req.json();
    if (!user_id || !title) return json({ error: "user_id と title が必要です" }, 400);

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);

    // ── 認可: サーバー（service_role）からの呼び出し、本人あて、または管理者のみ許可する
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const isServiceRole = jwt === serviceRoleKey || decodeJwtRole(jwt) === 'service_role';
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
      if (authError || !user) return json({ error: "Unauthorized" }, 401);

      if (user.id !== user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();
        if (profile?.role !== 'admin') return json({ error: "Forbidden" }, 403);
      }
    }

    // 通知のボタン（授業前の通知を試すときなど）。形がおかしいものは付けない
    const validActions = Array.isArray(actions)
      ? actions.filter((a) => a && typeof a.action === 'string' && typeof a.title === 'string').slice(0, 2)
      : undefined;
    const validActionUrls = actionUrls && typeof actionUrls === 'object'
      ? Object.fromEntries(Object.entries(actionUrls).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : undefined;

    const result = await sendToUser(supabase, user_id, {
      title, body: body ?? '', url,
      tag: typeof tag === 'string' ? tag : undefined,
      actions: validActions,
      actionUrls: validActionUrls,
    });
    if (result.total === 0) return json({ error: "Subscription not found in DB" }, 404);
    return json({ success: result.sent > 0, sent: result.sent, failed: result.failed });

  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});