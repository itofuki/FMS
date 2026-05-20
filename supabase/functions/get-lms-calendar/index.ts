/* supabase/functions/get-lms-calendar/index.ts */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import ical from "https://esm.sh/node-ical@0.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // CORSのプリフライトリクエスト（OPTIONS）への対応
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 🌟 フロントエンドから送信されたURLと、デバッグフラグを受け取る
    // 例: { "calendarUrl": "https://...", "debug": true }
    const { calendarUrl, debug } = await req.json();

    // URLが渡されなかった場合は環境変数から取得するフォールバック
    const targetUrl = calendarUrl || Deno.env.get('LMS_CALENDAR_URL');

    if (!targetUrl) {
      throw new Error("カレンダーのURLが設定されていません");
    }

    // 🌟 対象のURLをfetchする
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`LMSからのデータ取得に失敗しました: ${response.status} ${response.statusText}`);
    }

    const icsData = await response.text();
    const events = await ical.async.parseICS(icsData);
    
    // 必要な情報だけを抽出・整形
    const formattedEvents = Object.values(events)
      .filter((event: any) => event.type === 'VEVENT')
      .map((event: any) => {
        
        let descStr = '';
        if (event.description) {
          descStr = typeof event.description === 'string' 
            ? event.description 
            : (event.description.val || '');
        }

        // 科目コード(categoryCode)を抽出
        let categoryCodeStr = '';
        if (event.categories && Array.isArray(event.categories) && event.categories.length > 0) {
          categoryCodeStr = typeof event.categories[0] === 'string' 
            ? event.categories[0] 
            : (event.categories[0].val || '');
        }

        return {
          uid: event.uid,
          summary: event.summary || '無題の予定',
          description: descStr,
          start: event.start,
          end: event.end,
          categoryCode: categoryCodeStr, // 🌟 これがフロントに渡される
        };
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // 返却するレスポンスデータの構築
    const responseData: any = { events: formattedEvents };

    // 🌟 デバッグフラグが true の場合、LMSからの生データもレスポンスに含める
    if (debug) {
      responseData.debugInfo = {
        rawIcsText: icsData, // LMSから返ってきた生の文字列（iCalendar形式）
        parsedRawEvents: events, // node-icalがパースした直後の全オブジェクト
      };
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});