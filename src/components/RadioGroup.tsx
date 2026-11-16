/* src/components/RadioGroup.tsx */

import { useId } from 'react';

type Option = {
  value: string | number;
  label: string;
};

type RadioGroupProps = {
  options: Option[];
  selectedValue: string | number | null;
  onChange: (value: string | number) => void;
  legend: string;
};

export default function RadioGroup({
  options,
  selectedValue,
  onChange,
  legend,
}: RadioGroupProps) {
  // コンポーネントごとに一意なIDを生成し、IDの衝突を防ぐ
  const baseId = useId();

  return (
    <fieldset className="w-full">
      {/* 🌟 変更: スマホ時は文字サイズ text-base, 余白 mb-2 に縮小 */}
      <legend className="block text-left text-gray-300 mb-2 sm:mb-3 text-base sm:text-lg">
        {legend}
      </legend>
      {/* 🌟 変更: スマホ時は要素同士の隙間を gap-2 に縮小 */}
      <div className="flex flex-row flex-wrap gap-3 sm:gap-4">
        {options.map((option) => {
          // 各オプションに一意なIDを割り当てる
          const uniqueId = `${baseId}-${option.value}`;

          return (
            <div key={uniqueId}>
              <input
                type="radio"
                id={uniqueId} // 生成した一意なIDを使用
                // name属性はグループ内で共通にする
                name={baseId} 
                // HTMLのvalue属性は文字列であるべきなので明示的に変換
                value={String(option.value)}
                checked={selectedValue === option.value}
                onChange={() => onChange(option.value)}
                className="peer hidden"
              />
              <label
                htmlFor={uniqueId} // inputのidと対応させる
                className={`
                  flex items-center justify-center p-4 rounded-lg cursor-pointer
                  border border-cyan-500/30 bg-black/30 text-gray-300
                  transition-all duration-300 ease-in-out
                  hover:border-cyan-400 hover:bg-cyan-900/40
                  
                  peer-checked:border-cyan-400
                  peer-checked:bg-cyan-900/50
                  peer-checked:text-white
                  peer-checked:shadow-[0_0_15px_rgba(0,255,255,0.4)]

                  peer-focus-visible:ring-2 
                  peer-focus-visible:ring-cyan-400 
                  peer-focus-visible:ring-offset-2 
                  peer-focus-visible:ring-offset-gray-800
                `}
              >
                {/* 🌟 変更: スマホ時は文字サイズ text-base, 余白 px-2 に縮小 */}
                <span className="text-base sm:text-lg font-semibold px-2 sm:px-3">{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}