/* src/components/ui/SettingControls.tsx
 * 設定画面の部品。iPhone や X の設定と同じく、1 つの設定を「左に名前と短い説明・右に操作」の 1 行で並べる。
 *   - SettingRows / SettingRow : 区切り線で並べる行
 *   - Switch                   : オン・オフ
 *   - Segmented                : 少数の選択肢から 1 つを選ぶ（テーマと同じ見た目）
 */
import React from 'react';

export function SettingRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-line -my-3">{children}</div>;
}

/** stack: スマホでは操作を説明の下に置く（横に広い操作のとき） */
export function SettingRow({ label, hint, hintTone = 'muted', stack = false, htmlFor, children }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: 'muted' | 'warn';
  stack?: boolean;
  htmlFor?: string;
  children?: React.ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'p';
  return (
    <div className={`py-3 flex gap-x-4 gap-y-2.5 ${stack ? 'flex-col sm:flex-row sm:items-center sm:justify-between' : 'items-center justify-between'}`}>
      <div className="min-w-0">
        <Label {...(htmlFor ? { htmlFor } : {})} className="block text-[15px] font-medium text-fg">{label}</Label>
        {hint && <p className={`mt-0.5 text-[13px] leading-snug ${hintTone === 'warn' ? 'text-warn' : 'text-fg-muted'}`}>{hint}</p>}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled = false }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative flex-shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent-solid' : 'bg-surface-3 border border-line-strong'}`}
    >
      <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label, disabled = false }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full sm:w-auto rounded-lg border border-line bg-surface-2 p-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => { if (!selected) onChange(o.value); }}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-md whitespace-nowrap transition-colors disabled:opacity-60 ${
              selected ? 'bg-surface text-fg font-semibold shadow-sm' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <span className="text-sm">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
