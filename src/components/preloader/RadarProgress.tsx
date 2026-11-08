export function RadarProgress({ percent }: { percent: number }) {
  return (
    <div className="relative h-44 w-44">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(34,197,94,0.12)" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="#22c55e"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${percent} 100`}
          style={{ filter: 'drop-shadow(0 0 4px rgba(34,197,94,0.8))', transition: 'stroke-dasharray 120ms linear' }}
        />
      </svg>

      <div className="absolute inset-4 overflow-hidden rounded-full border border-neon/25 bg-black/60">
        <div className="zord-radar-sweep absolute inset-0 rounded-full" />
        <div className="zord-pulse-ring absolute inset-[18%] rounded-full border border-neon/30" />
        <div className="absolute inset-[36%] rounded-full border border-neon/20" />
        <div className="absolute left-1/2 top-0 h-full w-px bg-neon/15" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-neon/15" />
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="rounded-full bg-[#020503]/80 px-2 font-display text-2xl font-bold tabular-nums text-neon-300"
          style={{ textShadow: '0 0 10px rgba(34,197,94,0.5)' }}
        >
          {percent}%
        </span>
      </div>
    </div>
  );
}
