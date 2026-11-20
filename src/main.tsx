// src/main.tsx

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import { MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core';

import { registerSW } from 'virtual:pwa-register';
// 新しい版を出した（デプロイした）ときの反映:
//   iPhone のホーム画面のアプリは、閉じても裏に残っていて、次に開いても「続きから」になることが多い。
//   そのままだと新しい版を確かめないので、アプリが前に出てくる（開く・切り替えて戻る）たびに確かめる。
//   新しい版があれば autoUpdate（vite.config.ts）により入れ替わり、画面が読み込み直されて反映される。
//   使っている途中で急に読み込み直さないよう、確かめるのは前に出てきた時だけ（最短 1 分おき）にする。
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      registration.update().catch(() => { /* 通信できないときは次の機会に */ });
    });
  },
});

// アクセント（シアン）。Tailwind の cyan-50〜900。index.css の --accent-solid と揃える
const brand: MantineColorsTuple = [
  '#ecfeff', '#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee',
  '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63',
];

// ダークモードの中間色。index.css のダーク用トークン（--bg / --surface など）と揃える
const dark: MantineColorsTuple = [
  '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569',
  '#334155', '#1e293b', '#0f172a', '#020617', '#01040f',
];

const theme = createTheme({
  fontFamily: '"Noto Sans JP", sans-serif',
  primaryColor: 'brand',
  primaryShade: { light: 7, dark: 6 },
  colors: { brand, dark },
  defaultRadius: 'md',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* テーマは端末ごとに localStorage（mantine-color-scheme-value）へ保存される */}
    <MantineProvider defaultColorScheme="auto" theme={theme}>
      <App />
    </MantineProvider>
  </React.StrictMode>,
)
