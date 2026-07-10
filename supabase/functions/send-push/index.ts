// supabase/functions/send-push/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from "https://esm.sh/web-push@3.6.6"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});