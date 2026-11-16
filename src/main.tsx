// src/main.tsx

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import { MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core';

import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

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
