# FMS (Facility & Learning Management System)

## 📖 概要 (Overview)
FMSは、学内の施設開放スケジュール（自習室・談話室）、個人の時間割、およびLMS（Moodle）の課題を一元管理し、学生のキャンパスライフを効率化するためのWebアプリケーションです。

管理者がSlackに投稿した時間割PDFをAIが自動解析してデータベースに登録する「施設管理機能」に加え、LMSのカレンダーフィードと同期した「課題タスク管理機能」や「自動出席機能」を備えており、学生に必要な情報へのアクセスとタスク管理をシームレスに提供します。

## ✨ 主な機能 (Features)

### 👤 ユーザー（学生）向け機能
* **📅 スケジュール＆時間割確認機能**
  * 自習室・談話室の開放時間をカレンダー形式で一目で確認できます。
  * 自身の時間割を登録・確認できるビューを備えています。
* **📝 LMS連携 ＆ 課題タスク管理（キャッシュによる超高速UI）**
  * LMS（Moodle）のWebCal/iCalカレンダーフィードURLを登録することで、直近2週間の課題を自動的に同期・集約します。
  * 登録された公式課題だけでなく、自分だけの「個人課題」を手動で追加・編集・削除することも可能です。
  * **⚡ 高いUXを実現するステータス管理**: 完了した課題のチェックボックスを操作した際、**楽観的アップデート（Optimistic Updates）**技術を導入しているため、サーバーの応答を待たずに画面上のチェック状態が瞬時に切り替わり、ストレスのない操作感を提供します。
* **⚡ 授業時間連動型・自動出席オープン機能**
  * 時間割と連動し、該当する授業の開始時間になると、ワンタップ（または自動）で出席登録画面や関連ページをスマートに開きます。

### ⚙️ 管理者・システム向け機能
* **🤖 SlackからのPDF時間割自動取り込みパイプライン**
  * 管理者が指定のSlackチャンネルに時間割PDFを投稿するだけで、裏側でAI（Gemini 3.1 Pro）が自動で複雑な表組みを読み取り、時限ごとのスケジュールデータとしてデータベースに反映します。
  * ※AIの視覚的錯覚（ハルシネーション）を防ぐための高度なプロンプトエンジニアリングが組み込まれています。

## 🛠 技術スタック (Tech Stack)

### Frontend
* **Framework / Library**: React (Vite / React Router)
* **State Management & Caching**: `@tanstack/react-query` (React Query)
* **UI Components**: Mantine UI (`@mantine/core`, `@mantine/dates`), `react-icons`
* **Date Utility**: `date-fns`, `dayjs`
* **Styling**: Tailwind CSS
* **Hosting**: Vercel

### Backend & Infrastructure (BaaS)
* **Database & Auth**: Supabase (PostgreSQL / Row Level Security)
* **Storage**: Supabase Storage (PDF原本のバックアップ保存)
* **Serverless Functions**: Supabase Edge Functions (Deno)

### AI & Integrations / APIs
* **AI Model**: Google Generative AI (`gemini-3.1-pro-preview`)
* **LMS Integration**: Moodle iCal Calendar Feed 同期
* **External API**: Slack API (Events API, Web API)

## 🏗 アーキテクチャ概略 (Architecture)

### 1. 施設スケジュール同期（自動取り込み）
`SlackでPDF投稿` -> `Edge Function検知` -> `GeminiによるPDF解析(JSON化)` -> `Supabase DB保存`

### 2. LMS課題同期 ＆ クライアントキャッシュ
1. **データ同期**: ユーザーが登録したLMSのiCal URLを使い、Supabase Edge Function (`get-lms-calendar`) が定期的にカレンダーデータをパースして取得。
2. **重複排除と統合**: 取得したLMSの公式課題データと、Supabase内の `assignment` テーブルに保存された「個人課題」データをフロントエンド側で動的に統合。
3. **キャッシュ・状態管理**: `React Query` がデータをクライアント側にキャッシュし、不要なAPI通信を削減。
4. **楽観的アップデート**: 課題のチェック（完了/未完了のトグル）時は、DB（`assignment_status` / `lms_assignment_status`）への非同期書き込みと同時に、画面上のキャッシュを即座に書き換えて先行反映します。

### 3. 時間割＆出席連動
`時間割データを判定` -> `授業開始時にトリガー` -> `出席ページ自動オープン処理`

---

## 🚀 自習室時間割の自動取り込みシステム (Slack -> Supabase)

### 処理の詳細
1. **イベント検知**: Slack上で時間割PDFのリンクが共有されると、Edge FunctionがWebhookを受け取ります。
2. **PDF取得**: Slackの `conversations.history` APIを用いて該当メッセージの添付ファイル情報を取得し、PDFをダウンロードします。
3. **AI解析 (VLM)**:
   * 取得したPDFをBase64エンコードし、Geminiモデルに渡します。
   * 指定した厳格なプロンプトに従い、PDFの表を読み取って時限ごとの配列データ（JSON）に変換します。
   * ※サーバー混雑時（503/429エラー）は、Exponential Backoffによる自動リトライを行います。
4. **データ保存**:
   * **Storage**: 元のPDFファイルを `studyroom/` バケットにバックアップ保存。
   * **Database**: `schedule_metadata`（期間情報）および `room_schedules`（日別の詳細スケジュール）に `upsert` で保存。

### 🧠 AI解析における工夫（ハルシネーション対策）
PDFの表組み（特に結合セルや点線を含む複雑なレイアウト）をAIに正確に認識させるため、プロンプトに以下の高度な制御を組み込んでいます。
* **Micro Chain-of-Thought (`layout` の事前出力)**
  AIが「空白」や「結合セル」を誤認して配列の要素数がズレる（ハルシネーション）のを防ぐため、各部屋の配列を生成する直前に、一時的な思考プロセスとして `layout: "1-2, 3-5, 6"` のような「列の区切り位置のメモ」を出力させています。これにより、配列の要素数を厳密に「6（1〜6限）」に保ちます。
* **Few-Shot Prompting（具体例の提示）**
  「3〜5限が結合されている場合の非対称なレイアウト」や「横線が点線であることの解釈」など、AIが視覚的な錯覚を起こしやすいパターンの正解例（入力と出力のペア）をプロンプト内に直接記述し、決定論的な動作を強制しています。
* **温度パラメータの固定**
  解析のブレをなくすため、Gemini APIの `temperature` は `0` に設定しています。

---

## 💻 ローカル環境の構築 (Getting Started)

### 前提条件 (Prerequisites)
* Node.js (v18以上推奨)
* パッケージマネージャー (npm / yarn / pnpm)
* Supabase CLI
* Docker Desktop (Supabaseローカル起動用)

### インストールと起動 (Installation & Running)

#### 1. リポジトリのクローンとパッケージのインストール
```bash
git clone [https://github.com/your-org/fms.git](https://github.com/your-org/fms.git)
cd fms
npm install  # または yarn install / pnpm install
```

## 📁 主要なデータベーススキーマ (Database Schema)
### 施設管理関連
- schedule_metadata
    - filename (PK): PDFのファイル名
    - start_date: 時間割の開始日
    - end_date: 時間割の終了日
- room_schedules
    - target_date (PK): 対象日
    - talk_rooms: 談話室のスケジュール（要素数6のtext配列）
    - study_rooms: 自習室のスケジュール（要素数6のtext配列）

### 課題管理関連
- assignment: 手動で登録された個人課題・公式課題を格納
- assignment_status: 手動課題のユーザーごとの完了（done）ステータスを管理
- lms_assignment_status: LMSから同期された課題のユーザーごとの完了（done）ステータスを管理