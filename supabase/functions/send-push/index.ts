// supabase/functions/send-push/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from "npm:web-push@3.6.7"

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
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );

    const { user_id, title, body } = await req.json();
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

    // 🌟 変更点: .single() を外し、複数件取得できるようにした
    const { data: subDataList, error: dbError } = await supabase
      .from('user_subscriptions')
      .select('subscription')
      .eq('user_id', user_id);

    if (dbError) {
      return new Response(JSON.stringify({ error: "DB Error", details: dbError }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // データが0件だった場合
    if (!subDataList || subDataList.length === 0) {
      return new Response(JSON.stringify({ error: "Subscription not found in DB" }), { 
        status: 404, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const results = await Promise.allSettled(
      subDataList.map((subData) =>
        webpush.sendNotification(subData.subscription, JSON.stringify({ title, body }))
      )
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      failed.forEach((r) => console.error("個別の送信エラー:", (r as PromiseRejectedResult).reason));
    }

    const succeeded = results.length - failed.length;
    return new Response(
      JSON.stringify({ success: succeeded > 0, sent: succeeded, failed: failed.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});