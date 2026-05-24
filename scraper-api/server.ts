// server.ts
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';

const app = express();
app.use(cors());
app.use(express.json());

// server.ts の該当部分を修正
app.post('/api/lms/sync', async (req, res) => {
  const { attendancePassword } = req.body; // 変更: パスワードのみ受け取る

  if (!attendancePassword) {
    return res.status(400).json({ error: '出席パスワードが必要です' });
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. テスト用のモック画面へアクセス
    await page.goto('http://localhost:5173/mock-login.html'); 

    // 2. 出席パスワードを自動入力
    await page.fill('#attendance-password-input', attendancePassword);
    
    // 3. 送信ボタンをクリック
    await page.click('#attendance-submit-btn');

    await page.waitForNavigation();

    res.json({ success: true, message: '出席登録が完了しました' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: '自動入力に失敗しました' });
  } finally {
    await browser.close();
  }
});

app.listen(3001, () => console.log('Scraper API running on port 3001'));