/* src/components/ParticlesBackground.tsx
 * ログイン画面の背景（元のトップページと同じ、点と線がゆっくり動くアニメーション）。
 * ログイン画面からだけ React.lazy で読み込むので、マイページなどの読み込みには含まれない。
 */
import { useCallback } from "react";
import { loadSlim } from "tsparticles-slim";
import type { Engine } from "tsparticles-engine";
import Particles from "react-tsparticles";
import { useComputedColorScheme } from "@mantine/core";

// 粒子の色（テーマごと）。index.css のトークン値と揃えた控えめな色
const PARTICLE_COLORS = {
  light: { particles: ["#06b6d4", "#34d399", "#94a3b8"], links: "#cbd5e1" },
  // ダークは配色変更前の元の色
  dark: { particles: ["#00c6ff", "#92fe9d", "#ff0077"], links: "#4d4d4d" },
} as const;

export default function ParticlesBackground() {
  const scheme = useComputedColorScheme("light");
  const colors = PARTICLE_COLORS[scheme];

  const particlesInit = useCallback(async (engine: Engine) => {
    await loadSlim(engine);
  }, []);

  return (
    <Particles
      id="tsparticles-login"
      key={scheme} // テーマが変わったら色を反映するため再初期化
      init={particlesInit}
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
  );
}
