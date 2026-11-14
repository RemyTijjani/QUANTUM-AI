import { ArrowLeftRight, Coins, History, Image, Landmark, Wallet } from 'lucide-react';
import { formatZp } from '@/lib/format';
import type { VerifiedLedgerEntry } from '@/lib/economy/verifiedEconomy';

export default function VaultTab({
  verifiedZpBalance,
  transactions,
}: {
  verifiedZpBalance: number | null;
  transactions: VerifiedLedgerEntry[];
}) {
  return (
    <div className="space-y-5 pb-3">
      <header className="panel space-y-2 border border-neon/30 bg-neon/5 p-4">
        <div className="flex items-center gap-2 text-neon-400"><Wallet size={18} /><p className="label">ZORD asset vault</p></div>
        <h1 className="title">Wallet & assets</h1>
        <p className="font-mono text-[10px] leading-relaxed text-neon-500">Wallet connection, ZP/ZAP operations, transaction records and future collectibles will be managed here.</p>
      </header>

      <section className="panel space-y-3 p-4">
        <div className="flex items-center gap-2"><Landmark size={16} className="text-neon-400" /><p className="label">Wallet connection</p></div>
        <div className="flex items-center justify-between border border-amber-500/25 bg-amber-500/5 p-3">
          <div><p className="font-display text-xs text-amber-200">TON Connect</p><p className="mt-1 font-mono text-[9px] text-amber-300">Not connected</p></div>
          <span className="border border-amber-500/30 px-2 py-1 font-mono text-[9px] uppercase text-amber-300">Integration pending</span>
        </div>
        <p className="font-mono text-[9px] leading-relaxed text-neon-600">The previous faucet and wallet-link controls were simulations. They have been removed from the active wallet flow; no real funds were moved.</p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="panel p-4"><div className="flex items-center gap-2 text-neon-500"><Coins size={14} /><p className="label">Verified ZP</p></div><p className="mt-3 font-display text-xl text-neon-300">{verifiedZpBalance === null ? 'Unavailable' : formatZp(verifiedZpBalance)}</p></div>
        <div className="panel p-4"><div className="flex items-center gap-2 text-cyan-400"><ArrowLeftRight size={14} /><p className="label">ZAP balance</p></div><p className="mt-3 font-display text-xl text-cyan-300">Not enabled</p></div>
      </section>

      <section className="panel space-y-2 p-4">
        <h2 className="title">Conversion & transfers</h2>
        <div className="flex justify-between gap-2 font-mono text-[10px] text-neon-400"><span>1,000 ZP</span><span>1 ZAP</span></div>
        <div className="flex justify-between gap-2 font-mono text-[10px] text-neon-400"><span>Minimum ZAP transfer</span><span>100 ZAP</span></div>
        <p className="font-mono text-[9px] leading-relaxed text-amber-300">Conversion and transfers are not active. ZAP is not currently held in the verified economy ledger.</p>
      </section>

      <section className="panel space-y-3 p-4">
        <div className="flex items-center gap-2"><History size={15} className="text-neon-400" /><h2 className="title">Verified ZP history</h2></div>
        <p className="font-mono text-[10px] text-neon-600">Latest 50 entries from your server-side economy ledger. This history is read-only.</p>
        {transactions.length === 0 ? (
          <div className="border border-neon/15 px-3 py-4 text-center font-mono text-[9px] uppercase tracking-wider text-neon-700">No verified ZP transactions yet</div>
        ) : (
          <div className="space-y-2">
            {transactions.map((entry) => {
              const positive = entry.amount >= 0;
              const dateLabel = entry.createdAt && Number.isFinite(Date.parse(entry.createdAt))
                ? new Date(entry.createdAt).toLocaleString()
                : 'Date unavailable';
              const typeLabel = entry.transactionType.replace(/_/g, ' ');
              return (
                <article key={entry.id} className="border border-neon/15 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase text-neon-300">{typeLabel}</p>
                      {entry.description && <p className="mt-1 break-words font-mono text-[9px] text-neon-600">{entry.description}</p>}
                    </div>
                    <p className={`shrink-0 font-display text-sm ${positive ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {positive ? '+' : ''}{formatZp(entry.amount)} ZP
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] text-neon-700">
                    <span>{dateLabel}</span>
                    <span>Balance: {formatZp(entry.balanceAfter)} ZP</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel space-y-2 p-4">
        <div className="flex items-center gap-2"><Image size={15} className="text-neon-400" /><h2 className="title">Collectibles & NFTs</h2></div>
        <p className="font-mono text-[10px] text-neon-600">Collectibles and early-adopter NFT features are planned. No NFT reward or ownership is being represented as active.</p>
      </section>
    </div>
  );
}
