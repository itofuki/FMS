import { useState, useEffect } from 'react';
import type { FC, ReactNode } from 'react';

type Props = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
};

const Collapsible: FC<Props> = ({ title, children, defaultOpen = false, open }) => {
  // 初期状態の設定
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // 外部（URLパラメータなど）から open が指定された場合に同期
  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open);
    }
  }, [open]);

  return (
    <details 
      className="group border-t border-line py-5"
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between outline-none">
        <h2 className="text-lg sm:text-xl font-semibold text-fg-muted">{title}</h2>
        <div className="text-accent text-lg sm:text-xl transition-transform duration-300 group-open:-rotate-90">
          ◀
        </div>
      </summary>

      <div className="mt-4">
        {children}
      </div>
    </details>
  );
};

export default Collapsible;