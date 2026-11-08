export function NeonSpinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-4 py-12 font-mono">
      <div className="relative h-12 w-12 text-neon-300 drop-shadow-[0_0_8px_currentColor]">
        <span className="absolute inset-0 rounded-full border-2 border-neon/20" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-current" />
      </div>
      <p className="text-[11px] uppercase tracking-widest text-neon-500 animate-pulse">{label}</p>
    </div>
  );
}
