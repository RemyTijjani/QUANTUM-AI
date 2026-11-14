import FaIcon from '@/components/FaIcon';

export type TabId = 'missions' | 'agents' | 'core' | 'network' | 'vault' | 'events';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'core', label: 'Core', icon: 'fa-microchip' },
  { id: 'missions', label: 'Missions', icon: 'fa-bullseye' },
  { id: 'agents', label: 'ZORD Agents', icon: 'fa-robot' },
  { id: 'network', label: 'Network', icon: 'fa-network-wired' },
  { id: 'vault', label: 'Vault', icon: 'fa-vault' },
];

interface BottomNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export default function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav
      aria-label="Main navigation"
      className="relative z-20 grid grid-cols-5 border-t border-neon/20 bg-obsidian/95 px-1 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur"
    >
      {TABS.map(({ id, label, icon }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`group relative flex min-w-0 flex-col items-center gap-1 rounded-lg py-1.5 transition duration-200 ${
              isActive ? 'text-neon-400' : 'text-neon-600 hover:text-neon-500'
            }`}
          >
            <span
              className={`absolute -top-2 h-0.5 w-7 rounded-full bg-neon transition duration-300 ${
                isActive ? 'opacity-100 shadow-glow' : 'opacity-0'
              }`}
            />
            <span
              className={`flex h-8 w-9 items-center justify-center rounded-lg border transition duration-200 ${
                isActive ? 'border-neon/60 bg-neon/15 shadow-glow' : 'border-transparent group-hover:bg-neon/5'
              }`}
            >
              <FaIcon name={icon} size={17} />
            </span>
            <span className="max-w-full truncate font-mono text-[9px] uppercase tracking-wide">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
