/* src/components/Loading.tsx */

type LoadingProps = {
  label?: string;
  fullScreen?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap = {
  sm: { box: 'w-6 h-6', dot: 'w-1.5 h-1.5', text: 'text-xs' },
  md: { box: 'w-12 h-12', dot: 'w-2.5 h-2.5', text: 'text-sm md:text-base' },
  lg: { box: 'w-16 h-16', dot: 'w-3 h-3', text: 'text-base md:text-lg' },
};

export default function Loading({ label = '読み込み中...', fullScreen = false, size = 'md' }: LoadingProps) {
  const s = sizeMap[size];

  const spinner = (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`relative ${s.box}`}>
        <div className="absolute inset-0 rounded-full border-2 border-cyan-400/15" />
        <div className="absolute inset-0 rounded-full border-t-2 border-cyan-400 animate-spin [animation-duration:1.1s]" />
        <div className="absolute inset-1 rounded-full border-b-2 border-blue-500/80 animate-spin [animation-duration:0.75s] [animation-direction:reverse]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={`${s.dot} rounded-full bg-cyan-300 fms-loader-core`} />
        </div>
      </div>
      {label && (
        <p className={`font-orbitron text-cyan-300/90 ${s.text} tracking-wide animate-pulse`}>{label}</p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-900">
        {spinner}
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-center py-16">
      {spinner}
    </div>
  );
}
