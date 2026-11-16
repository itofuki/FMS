/* src/pages/HomePage.tsx */

import { useCallback } from "react";
import { loadSlim } from "tsparticles-slim";
import type { Container, Engine } from "tsparticles-engine";
import Particles from "react-tsparticles";
import { Link } from "react-router-dom";
import { useComputedColorScheme } from "@mantine/core";

// 粒子の色（テーマごと）。index.css のトークン値と揃えた控えめな色
const PARTICLE_COLORS = {
  light: { particles: ["#06b6d4", "#34d399", "#94a3b8"], links: "#cbd5e1" },
  // ダークは配色変更前の元の色
  dark: { particles: ["#00c6ff", "#92fe9d", "#ff0077"], links: "#4d4d4d" },
} as const;

export default function HomePage() {
  const scheme = useComputedColorScheme("light");
  const colors = PARTICLE_COLORS[scheme];

  const particlesInit = useCallback(async (engine: Engine) => {
    await loadSlim(engine);
  }, []);

  const particlesLoaded = useCallback(async (container: Container | undefined) => {
    void container; // 処理が必要な場合はここに記述
  }, []);

  return (
    <div className="relative min-h-screen text-fg flex flex-col items-center justify-center p-4">
      {/* 背景パーティクル */}
      <Particles
        id="tsparticles-homepage"
        key={scheme} // テーマが変わったら色を反映するため再初期化
        init={particlesInit}
        loaded={particlesLoaded}
        options={{
          background: {
            color: { value: "transparent" },
          },
          fpsLimit: 60,
          interactivity: {
            events: {
              onClick: { enable: true, mode: "push" },
              onHover: { enable: true, mode: "repulse" },
              resize: true,
            },
            modes: {
              push: { quantity: 4 },
              repulse: { distance: 100, duration: 0.4 },
            },
          },
          particles: {
            color: { value: [...colors.particles] },
            links: {
              color: colors.links,
              distance: 150,
              enable: true,
              opacity: 0.5,
              width: 1,
            },
            collisions: { enable: false },
            move: {
              direction: "none",
              enable: true,
              outModes: { default: "bounce" },
              random: false,
              speed: 0.8,
              straight: false,
            },
            number: {
              density: { enable: true, area: 800 },
              value: 50,
            },
            opacity: { value: 0.35 },
            shape: { type: "circle" },
            size: { value: { min: 1, max: 3 } },
          },
          detectRetina: true,
        }}
        className="absolute inset-0 z-0"
      />

      {/* メインコンテンツ */}
      <div className="relative z-10 text-center max-w-4xl mx-auto space-y-6">
        <h1 className="text-6xl md:text-8xl font-extrabold tracking-tight text-accent">
          FMS
        </h1>
        <p className="text-xl md:text-2xl text-fg font-light leading-relaxed max-w-3xl mx-auto opacity-90">
          - IPUT生向け学習プラットフォーム -
        </p>
        <hr className="my-4 border-line" />
        <p className="text-xl md:text-2xl text-fg font-light leading-relaxed max-w-3xl mx-auto opacity-90">
          データを集約し、ひとりひとりに最適化された学習環境を提供します。
        </p>
        
        <div className="mt-8 flex justify-center space-x-4">
          <Link 
            to="/login" 
            className="px-8 py-3 bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-semibold rounded-full transition-colors duration-200"
          >
            ログイン
          </Link>
          <Link 
            to="/register"
            className="px-8 py-3 border border-accent text-accent font-semibold rounded-full hover:bg-accent-solid-hover hover:text-on-accent transition-colors duration-200"
          >
            新規登録
          </Link>
        </div>
      </div>
    </div>
  );
}