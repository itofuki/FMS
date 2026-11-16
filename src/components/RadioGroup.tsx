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
      <legend className="block text-left text-fg font-semibold mb-2 text-sm sm:text-[15px]">
        {legend}
      </legend>
      <div className="flex flex-row flex-wrap gap-2">
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
                  flex items-center justify-center min-w-11 px-3 py-2 rounded-md cursor-pointer
                  border border-line bg-surface-2 text-fg-muted
                  transition-all duration-300 ease-in-out
                  hover:border-accent hover:bg-accent-soft
                  
                  peer-checked:border-accent
                  peer-checked:bg-accent-soft
                  peer-checked:text-accent
                  peer-checked:font-semibold

                  peer-focus-visible:ring-2 
                  peer-focus-visible:ring-accent 
                  peer-focus-visible:ring-offset-2 
                  peer-focus-visible:ring-offset-surface
                `}
              >
                <span className="text-sm sm:text-[15px] font-medium">{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}