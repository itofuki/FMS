/* supabase/functions/slack-schedule-receiver/index.ts */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { encode } from "https://deno.land/std@0.200.0/encoding/base64.ts";

const slackUserToken = Deno.env.get("SLACK_USER_TOKEN")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 実行環境の強制終了を避けるため、1回の待機を短くして回数で粘る
async function generateContentWithRetry(model: any, requestData: any, maxRetries = 8) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await model.generateContent(requestData);
    } catch (error: any) {
      const isRetryable = error.status === 503 || error.status === 429;

      if (isRetryable && i < maxRetries - 1) {
        const exponentialWait = Math.pow(2, i) * 3000; 
        const delayCap = 30000; 
        const jitter = Math.floor(Math.random() * 5000); 
        const waitTime = Math.min(exponentialWait, delayCap) + jitter;

        console.log(`⚠️ サーバー混雑中(${error.status}): ${(waitTime / 1000).toFixed(1)}秒待機して再試行します... (試行 ${i + 1}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
}

serve(async (req) => {
  try {
    if (req.method === "GET") return new Response("API is running!", { status: 200 });

    const retryNum = req.headers.get("x-slack-retry-num");
    if (retryNum) return new Response("OK", { status: 200 });

    const bodyText = await req.text();
    const body = JSON.parse(bodyText);

    if (body.type === "url_verification") return new Response(body.challenge, { status: 200 });

    if (body.event && body.event.type === "message" && body.event.text) {
      const text = body.event.text;
      const match = text.match(/\/archives\/(C[A-Z0-9]+)\/p(\d+)/);
      if (!match) return new Response("No link", { status: 200 });

      const origChannel = match[1];
      const origTsStr = match[2];
      const origTs = origTsStr.slice(0, -6) + '.' + origTsStr.slice(-6);

      const historyRes = await fetch(`https://slack.com/api/conversations.history?channel=${origChannel}&latest=${origTs}&limit=1&inclusive=true`, {
        headers: { Authorization: `Bearer ${slackUserToken}` }
      });
      const historyData = await historyRes.json();
      const originalMessage = historyData.messages?.[0];

      if (!originalMessage?.files?.[0]) return new Response("No files", { status: 200 });
      const file = originalMessage.files[0];
      if (file.filetype !== "pdf" || !file.name?.includes("自習室")) return new Response("Skip", { status: 200 });

      const yearMatch = file.name.match(/(\d{2})年度/);
      const targetYear = yearMatch ? 2000 + parseInt(yearMatch[1], 10) : new Date().getFullYear();

      const pdfRes = await fetch(file.url_private_download, { headers: { Authorization: `Bearer ${slackUserToken}` } });
      const pdfUint8Array = new Uint8Array(await pdfRes.arrayBuffer());

      console.log("🧠 gemini-3.1-pro-preview による解析を開始します...");
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3.1-pro-preview",
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0
        }
      });
      
      const pdfBase64 = encode(pdfUint8Array);

      // プロンプトの内容は一切変更せず維持
      const prompt = `あなたは視覚的ドキュメント解析の専門家です。提供されたPDF（自習室開放時間割）を以下の【思考プロセス】に従って厳密に解析し、JSONデータを作成してください。

      【★最重要：錯覚防止と超短縮・言語化プロセス】
      AIは「空白」と「文字の始まり」の境界に、存在しない「縦の罫線」を幻覚する致命的な弱点があります。
      これを防ぐため、JSONの最初のキー \`grid_analysis\` で、実際に引かれている「黒い実線」の位置を超短縮記号でメモしてください。※出力時間を削るため、基本レイアウトから外れた「例外的な日」のみを抽出し、それ以外は記述しないでください。

      【思考プロセス：物理的グリッドと対称性のスキャン】
      1. **メタデータの抽出**:
        - PDF全体から「開始日 (start_date)」と「終了日 (end_date)」を特定してください。
        - **必ず「${targetYear}年」として処理してください。**（例: 日付が 4/24 なら ${targetYear}-04-24）。

      2. **縦線の厳密なスキャン（★「点線トラップ」の排除）**:
        - **【重大な警告】「談話室」と「自習室」を隔てる横線は「点線（......）」です。**
        - このため、下の自習室にある「黒い実線の縦線」が、弱い点線を突き抜けて上の談話室まで続いていると錯覚（視覚の貫通モレ）を起こしやすくなっています。
        - 縦線を探すときは、その行の空間に「明確な黒い実線」が存在するかだけを見てください。自習室の縦線は点線で確実に止まっており、談話室には絶対に影響しません。

      3. **【絶対法則】重心と対称性による結合の推論**:
        - 表計算ソフトの仕様上、結合されたセル内の文字は**「中央（重心）」**に配置されます。
        - **例**: 縦線がない3限〜6限の広いブロックにおいて、文字が「4限と5限の間」に配置されている場合、それは右に寄っているのではなく「ブロック全体の中央」に配置されているだけです。
        - したがって、文字がない「3限」や「6限」を勝手に空白（-）として切り捨てるなど、**非対称な解釈（例：3限だけハイフンで、4〜6限に部屋を割り当てる等）は絶対にやめてください。** 必ずブロック全体（3,4,5,6限すべて）に同じ文字列を適用してください。

      4. **空白と記号のルール（★NULL禁止）**:
        - **JSONの値に null を使用することは絶対厳禁です。**
        - ブロック内に本当に文字がない場合や「-」「ー」のみの場合は、文字列の "-" を出力してください。
        - 「・」などの記号も正確に抽出してください。

      【具体例（Few-Shot）】
      画像から配列を生成する際の絶対的な基準です。これを真似してください。
      ・談話室に縦線がなく中央に「353」とある場合
        -> layout: "1-6", array: ["353", "353", "353", "353", "353", "353"]
      ・自習室で2限と3限の間に縦線があり、左に「361・374」、右に「341・345」とある場合
        -> layout: "1-2, 3-6", array: ["361・374", "361・374", "341・345", "341・345", "341・345", "341・345"]
      ・談話室で1〜2限、3〜5限が結合され、6限が独立している場合（例：左に「353」、中央に「342・353」、右端に「341・342・353」）
        -> layout: "1-2, 3-5, 6", array: ["353", "353", "342・353", "342・353", "342・353", "341・342・353"]
      ・談話室で2限と3限、4限と5限、5限と6限の間に縦線があり、3〜4限の枠に「ー」がある場合
        -> layout: "1-2, 3-4, 5, 6", array: ["351・352", "351・352", "-", "-", "341・342", "311・341・342"]

      【出力JSONフォーマット】
      ハルシネーションを防ぐため、各部屋の配列を出力する直前に \`layout\` キーでその行の結合状態（ブロックの区切り）を超短縮記号でメモしてから、要素数6の配列を出力してください。
      {
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD",
        "schedules": [
          { 
            "target_date": "YYYY-MM-DD",
            "talk_room_layout": "例: 1-6",
            "talk_rooms": ["1限", "2限", "3限", "4限", "5限", "6限〜"], 
            "study_room_layout": "例: 1-2, 3-6",
            "study_rooms": ["1限", "2限", "3限", "4限", "5限", "6限〜"] 
          }
        ]
      }
      `;

      // ... 前半は変更なし ...
      const result = await generateContentWithRetry(model, [
        { inlineData: { data: pdfBase64, mimeType: "application/pdf" } },
        prompt
      ]);
      
      const parsed = JSON.parse(result.response.text());

      // 修正1: grid_analysis のログを削除し、代わりに全体の件数などをログ出しする
      console.log(`🧠 AI解析完了: ${parsed.schedules.length}日分のデータを取得しました。`);

      if (!parsed.start_date || !parsed.end_date) {
        throw new Error(`AIが期間の読み取りに失敗しました。`);
      }
      
      const fileName = `timetable_${parsed.start_date}_${parsed.end_date}.pdf`;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // 1. Storageへのアップロード
      const { error: uploadError } = await supabase.storage.from('images').upload(`studyroom/${fileName}`, pdfUint8Array, { 
        upsert: true,
        contentType: 'application/pdf'
      });
      if (uploadError) throw new Error(`ストレージ保存エラー: ${uploadError.message}`);

      // 2. schedule_metadata への保存
      const { error: metaError } = await supabase.from('schedule_metadata').upsert({
        filename: fileName,
        start_date: parsed.start_date,
        end_date: parsed.end_date
      }, { onConflict: 'filename' });
      if (metaError) throw new Error(`メタデータ保存エラー: ${metaError.message}`);

      // 修正2: DB保存用に、layoutキーを取り除いた新しい配列を作成する
      const schedulesForDb = parsed.schedules.map((s: any) => ({
        target_date: s.target_date,
        talk_rooms: s.talk_rooms,
        study_rooms: s.study_rooms
      }));

      // 3. room_schedules への保存
      const { error: dbError } = await supabase.from('room_schedules').upsert(schedulesForDb, { 
        onConflict: 'target_date' 
      });
      if (dbError) throw new Error(`スケジュール保存エラー: ${dbError.message}`);

      console.log(`✅ 完了！ ${fileName} の情報を解析し、${schedulesForDb.length}件のスケジュールを保存しました。`);
      return new Response("Success", { status: 200 });
    }
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("🚨 エラー:", error);
    return new Response("Error", { status: 500 });
  }
});