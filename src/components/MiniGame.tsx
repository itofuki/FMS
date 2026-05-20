import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

// フルーツの進化段階（サイズと色）の定義
const FRUIT_LEVELS = [
  { radius: 15, color: '#ff0000', name: '0' },  // 赤（小）
  { radius: 25, color: '#ffaaaa', name: '1' },  // 薄ピンク
  { radius: 35, color: '#aa00ff', name: '2' },  // 紫
  { radius: 45, color: '#ffcc00', name: '3' },  // 黄
  { radius: 55, color: '#ffa500', name: '4' },  // オレンジ
  { radius: 70, color: '#ff4444', name: '5' },  // 朱色
  { radius: 85, color: '#ffddaa', name: '6' },  // ペールオレンジ
  { radius: 100, color: '#ff99cc', name: '7' }, // ピンク
  { radius: 115, color: '#ffff00', name: '8' }, // レモン色
  { radius: 130, color: '#00ff00', name: '9' }, // 黄緑
  { radius: 150, color: '#006600', name: '10' } // 深緑（スイカサイズ）
];

const MiniGame: React.FC = () => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef(Matter.Engine.create());

  // ★ 追加: 「次」のフルーツを管理するStateとRef
  const [nextFruitLevel, setNextFruitLevel] = useState<number>(() => Math.floor(Math.random() * 3));
  const nextFruitRef = useRef<number>(nextFruitLevel);

  useEffect(() => {
    if (!sceneRef.current) return;

    const engine = engineRef.current;
    
    // レンダラーのセットアップ
    const render = Matter.Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width: 400,
        height: 600,
        wireframes: false,
        background: '#1f2937'
      }
    });

    // 枠（壁と床）
    const ground = Matter.Bodies.rectangle(200, 600, 400, 40, { isStatic: true, render: { fillStyle: '#374151' }, label: 'wall' });
    const leftWall = Matter.Bodies.rectangle(0, 300, 40, 600, { isStatic: true, render: { fillStyle: '#374151' }, label: 'wall' });
    const rightWall = Matter.Bodies.rectangle(400, 300, 40, 600, { isStatic: true, render: { fillStyle: '#374151' }, label: 'wall' });

    Matter.Composite.add(engine.world, [ground, leftWall, rightWall]);

    // 物理演算と描画の開始
    Matter.Render.run(render);
    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);

    // ==========================================
    // 衝突検知とマージ（進化）処理
    // ==========================================
    Matter.Events.on(engine, 'collisionStart', (event) => {
      const pairs = event.pairs;

      pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;

        // どちらかが壁の場合は無視
        if (bodyA.label === 'wall' || bodyB.label === 'wall') return;

        // 両方が同じレベル（ラベルが同じ）のフルーツか判定
        if (bodyA.label === bodyB.label && !isNaN(Number(bodyA.label))) {
          
          if ((bodyA as any).isMerging || (bodyB as any).isMerging) return;
          (bodyA as any).isMerging = true;
          (bodyB as any).isMerging = true;

          const currentLevel = Number(bodyA.label);

          if (currentLevel < FRUIT_LEVELS.length - 1) {
            const nextLevel = currentLevel + 1;
            const nextFruitConfig = FRUIT_LEVELS[nextLevel];

            const midX = (bodyA.position.x + bodyB.position.x) / 2;
            const midY = (bodyA.position.y + bodyB.position.y) / 2;

            Matter.Composite.remove(engine.world, [bodyA, bodyB]);

            const newFruit = Matter.Bodies.circle(midX, midY, nextFruitConfig.radius, {
              restitution: 0.2,
              friction: 0.5,
              label: nextFruitConfig.name,
              render: { fillStyle: nextFruitConfig.color }
            });

            Matter.Composite.add(engine.world, newFruit);
          }
        }
      });
    });

    // ==========================================
    // クリックでフルーツを落とす
    // ==========================================
    const handleMouseClick = (event: MouseEvent) => {
      if (!render.canvas) return;
      
      const rect = render.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;

      // ★ 変更: ランダムではなく、Refに保存された「次」のフルーツを落とす
      const currentLevelToDrop = nextFruitRef.current;
      const fruitConfig = FRUIT_LEVELS[currentLevelToDrop];

      // 壁にめり込まないように座標制限
      const safeX = Math.max(20 + fruitConfig.radius, Math.min(x, 380 - fruitConfig.radius));

      const newFruit = Matter.Bodies.circle(safeX, 50, fruitConfig.radius, {
        restitution: 0.2,
        friction: 0.5,
        label: fruitConfig.name,
        render: { fillStyle: fruitConfig.color }
      });

      Matter.Composite.add(engine.world, newFruit);

      // ★ 追加: 落とした直後に、新しい「次」のフルーツを抽選してStateとRefを更新する
      const nextRandomLevel = Math.floor(Math.random() * 3);
      nextFruitRef.current = nextRandomLevel;
      setNextFruitLevel(nextRandomLevel);
    };

    render.canvas.addEventListener('mousedown', handleMouseClick);

    return () => {
      if (render.canvas) {
        render.canvas.removeEventListener('mousedown', handleMouseClick);
      }
      Matter.Events.off(engine, 'collisionStart', () => {});
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      if (render.canvas) render.canvas.remove();
    };
  }, []);

  // ★ 追加: 「NEXT」を表示するための設定
  const nextConfig = FRUIT_LEVELS[nextFruitLevel];
  // ...（上部のコードはそのまま）...

  return (
    <div className="w-full flex flex-col items-center justify-center bg-slate-800 rounded-lg p-6 mt-4">
      <h2 className="text-xl font-bold text-white mb-2">ミニゲーム</h2>
      
      <div className="w-[400px] flex justify-end mb-2 pr-2">
        <div className="bg-slate-700 w-[76px] h-[76px] rounded-full border-4 border-slate-600 flex flex-col items-center justify-center shadow-lg relative">
          <span className="text-slate-300 font-black text-[10px] tracking-widest absolute top-[10px]">
            NEXT
          </span>
          {/* ★ 変更: widthとheightを固定値(40px)にし、scaleを削除しました */}
          <div 
            className="rounded-full shadow-inner mt-[14px]"
            style={{
              width: '40px',
              height: '40px',
              backgroundColor: nextConfig.color,
            }}
          />
        </div>
      </div>

      <div ref={sceneRef} className="rounded overflow-hidden shadow-lg border-2 border-slate-600 cursor-pointer" />
      <p className="text-slate-400 mt-4 text-sm">画面をクリックしてフルーツを落としてみましょう</p>
    </div>
  );
};

export default MiniGame;