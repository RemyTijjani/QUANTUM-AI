import { useCallback, useEffect, useState } from 'react';
import { Download, MessageSquare, Pickaxe, RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  AdminApiError,
  exportAdminPlayerData,
  flushAdminApiCache,
  getAdminGlobalMiningSettings,
  sendAdminBroadcast,
  setAdminGlobalMiningSettings,
} from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminGlobalMiningSettings } from '@/lib/admin/adminApi';

const errorText = (error: unknown) => error instanceof AdminApiError ? error.message : 'Something went wrong. Please try again.';

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) throw new Error('There is no data to export yet.');
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => {
    const raw = value === null || value === undefined ? '' : String(value);
    return '"' + raw.replace(/"/g, '""') + '"';
  };
  const csv = [headers.map(quote).join(','), ...rows.map((row) => headers.map((key) => quote(row[key])).join(','))].join('\r\n');
  const blob = new Blob(['\\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AdminOperations({ creds }: { creds: AdminCredentials }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [inApp, setInApp] = useState(true);
  const [telegram, setTelegram] = useState(true);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastNotice, setBroadcastNotice] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  const [mining, setMining] = useState<AdminGlobalMiningSettings | null>(null);
  const [miningEnabled, setMiningEnabled] = useState(true);
  const [rate, setRate] = useState('1.00');
  const [miningBusy, setMiningBusy] = useState(false);
  const [miningError, setMiningError] = useState<string | null>(null);
  const [miningNotice, setMiningNotice] = useState<string | null>(null);

  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadMining = useCallback(async () => {
    setMiningError(null);
    try {
      const settings = await getAdminGlobalMiningSettings(creds);
      setMining(settings);
      setMiningEnabled(settings.fragmentMiningEnabled);
      setRate(settings.fragmentMiningRateMultiplier.toFixed(2));
    } catch (error) {
      setMiningError(errorText(error));
    }
  }, [creds]);

  useEffect(() => { void loadMining(); }, [loadMining]);

  const submitBroadcast = async () => {
    const channels = [ ...(inApp ? ['in_app' as const] : []), ...(telegram ? ['telegram' as const] : []) ];
    const cleanTitle = title.trim();
    const cleanMessage = message.trim();
    if (!cleanTitle || !cleanMessage || channels.length === 0 || broadcastBusy) return;
    const destinations = [inApp ? 'in-app announcements' : '', telegram ? 'Telegram messages' : ''].filter(Boolean).join(' and ');
    if (!window.confirm(`Send this announcement through ${destinations} to all eligible players? Telegram recipients who have not started the ZORD bot may not receive it.`)) return;
    setBroadcastBusy(true);
    setBroadcastError(null);
    setBroadcastNotice(null);
    try {
      const result = await sendAdminBroadcast(creds, { title: cleanTitle, message: cleanMessage, channels });
      setBroadcastNotice(`Announcement published. Telegram: ${result.telegramSent} sent, ${result.telegramFailed} failed, ${result.telegramSkipped} skipped.`);
      setTitle('');
      setMessage('');
    } catch (error) {
      setBroadcastError(errorText(error));
    } finally {
      setBroadcastBusy(false);
    }
  };

  const saveMining = async () => {
    const parsedRate = Number(rate);
    if (!Number.isFinite(parsedRate) || parsedRate < 0.1 || parsedRate > 5 || Math.round(parsedRate * 100) !== parsedRate * 100) {
      setMiningError('Enter a mining rate multiplier from 0.10 to 5.00, with up to two decimal places.');
      return;
    }
    const changed = !mining || mining.fragmentMiningEnabled !== miningEnabled || mining.fragmentMiningRateMultiplier !== parsedRate;
    if (!changed || miningBusy) return;
    const action = miningEnabled ? 'resume mining and/or update the rate' : 'pause mining and/or update the rate';
    if (!window.confirm(`Confirm: ${action}? The server will settle earned mining up to the change time. A pause will not count toward players' four-hour mining windows.`)) return;
    setMiningBusy(true);
    setMiningError(null);
    setMiningNotice(null);
    try {
      const saved = await setAdminGlobalMiningSettings(creds, { enabled: miningEnabled, rateMultiplier: parsedRate });
      setMining(saved);
      setMiningNotice(`Saved. Fragment mining is ${saved.fragmentMiningEnabled ? 'running' : 'paused'} at ${saved.fragmentMiningRateMultiplier.toFixed(2)}× base rate.`);
    } catch (error) {
      setMiningError(errorText(error));
    } finally {
      setMiningBusy(false);
    }
  };

  const handleFlushCache = async () => {
    if (cacheBusy || !window.confirm('Refresh the Supabase PostgREST API schema cache? This does not delete player data or clear browser/CDN caches.')) return;
    setCacheBusy(true);
    setCacheError(null);
    setCacheNotice(null);
    try {
      const result = await flushAdminApiCache(creds);
      setCacheNotice(`Confirmed at ${new Date(result.flushedAt).toLocaleString()}. Scope: ${result.scope}.`);
    } catch (error) {
      setCacheError(errorText(error));
    } finally {
      setCacheBusy(false);
    }
  };

  const handleExport = async () => {
    if (exportBusy || !window.confirm('Export player profile and ZP economy summary to CSV? Telegram IDs, wallet addresses, authentication data and transaction secrets are excluded.')) return;
    setExportBusy(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const rows = await exportAdminPlayerData(creds);
      downloadCsv(`zord-player-summary-${new Date().toISOString().slice(0, 10)}.csv`, rows as unknown as Array<Record<string, unknown>>);
      setExportNotice(`Export ready: ${rows.length.toLocaleString()} player record(s). Sensitive Telegram and wallet fields were excluded.`);
    } catch (error) {
      setExportError(errorText(error));
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111a14] p-4">
        <h3 className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-xs font-bold uppercase tracking-widest text-slate-200"><MessageSquare size={15} /> Broadcast messages</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">Publish an in-app announcement, send a Telegram message, or do both. Telegram delivery uses the existing server-side ZORD bot. Sending requires confirmation.</p>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400" htmlFor="admin-broadcast-title">Announcement title</label>
        <input id="admin-broadcast-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="e.g. Scheduled maintenance" className="mb-3 w-full rounded-lg border border-white/10 bg-[#080e0a] px-3 py-2 text-xs text-white outline-none focus:border-emerald-400/50" />
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400" htmlFor="admin-broadcast-message">Message</label>
        <textarea id="admin-broadcast-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} rows={4} placeholder="Write your announcement…" className="w-full resize-y rounded-lg border border-white/10 bg-[#080e0a] px-3 py-2 text-xs text-white outline-none focus:border-emerald-400/50" />
        <div className="my-3 flex flex-wrap gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={inApp} onChange={(event) => setInApp(event.target.checked)} /> In-app</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={telegram} onChange={(event) => setTelegram(event.target.checked)} /> Telegram</label>
        </div>
        {(title.trim() || message.trim()) && (
          <div className="mb-3 rounded-xl border border-emerald-400/20 bg-[#0b120e] p-3" aria-live="polite">
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-emerald-300">Message preview</p>
            <p className="break-words text-xs font-semibold text-white">{title.trim() || 'Announcement title'}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">{message.trim() || 'Your message will appear here.'}</p>
            <p className="mt-2 text-[9px] text-emerald-200/70">Delivery: {[inApp ? 'In-app' : '', telegram ? 'Telegram' : ''].filter(Boolean).join(' + ') || 'No channel selected'}</p>
          </div>
        )}
        {broadcastError && <p role="alert" className="mb-2 text-[11px] text-red-300">{broadcastError}</p>}
        {broadcastNotice && <p role="status" className="mb-2 text-[11px] text-emerald-300">{broadcastNotice}</p>}
        <button type="button" onClick={() => void submitBroadcast()} disabled={broadcastBusy || !title.trim() || !message.trim() || (!inApp && !telegram)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-2.5 text-xs font-bold text-[#07110b] disabled:cursor-not-allowed disabled:opacity-50"><Send size={14} />{broadcastBusy ? 'Sending…' : 'Preview & send broadcast'}</button>
      </div>

      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111a14] p-4">
        <h3 className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-xs font-bold uppercase tracking-widest text-slate-200"><Pickaxe size={15} /> Global mining controls</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">Controls are enforced by PostgreSQL, not the browser. Changes settle earned ZP first. Pausing suspends active mining windows; paused time is excluded when mining resumes.</p>
        {miningError && <p role="alert" className="mb-2 text-[11px] text-red-300">{miningError}</p>}
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b120e] p-3">
          <div><p className="text-xs font-semibold text-white">Fragment mining</p><p className="mt-1 text-[10px] text-slate-400">{mining ? `Currently ${mining.fragmentMiningEnabled ? 'running' : 'paused'} · ${mining.fragmentMiningRateMultiplier.toFixed(2)}× base` : 'Loading settings…'}</p></div>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={miningEnabled} onChange={(event) => setMiningEnabled(event.target.checked)} disabled={!mining || miningBusy} /> Enabled</label>
        </div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400" htmlFor="admin-mining-rate">Base rate multiplier (0.10–5.00×)</label>
        <input id="admin-mining-rate" type="number" min="0.10" max="5.00" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} disabled={!mining || miningBusy} className="mb-3 w-full rounded-lg border border-white/10 bg-[#080e0a] px-3 py-2 text-xs text-white outline-none focus:border-emerald-400/50 disabled:opacity-50" />
        {miningNotice && <p role="status" className="mb-2 text-[11px] text-emerald-300">{miningNotice}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveMining()} disabled={!mining || miningBusy || (mining.fragmentMiningEnabled === miningEnabled && mining.fragmentMiningRateMultiplier === Number(rate))} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-2.5 text-xs font-bold text-[#07110b] disabled:opacity-50"><RefreshCw size={13} className={miningBusy ? 'animate-spin' : ''} />{miningBusy ? 'Saving…' : 'Save mining settings'}</button>
          <button type="button" onClick={() => void loadMining()} disabled={miningBusy} className="rounded-xl border border-white/10 px-3 py-2.5 text-xs text-slate-300 disabled:opacity-50">Reload</button>
        </div>
      </div>

      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111a14] p-4">
        <h3 className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-xs font-bold uppercase tracking-widest text-slate-200"><Trash2 size={15} /> Flush Cache</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">Refreshes the Supabase PostgREST API schema cache so database API metadata is reloaded. It does not clear Vercel CDN, browser storage or player data.</p>
        {cacheError && <p role="alert" className="mb-2 text-[11px] text-red-300">{cacheError}</p>}
        {cacheNotice && <p role="status" className="mb-2 text-[11px] text-emerald-300">{cacheNotice}</p>}
        <button type="button" onClick={() => void handleFlushCache()} disabled={cacheBusy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-950/20 px-3 py-2.5 text-xs font-semibold text-red-200 disabled:opacity-50"><Trash2 size={14} />{cacheBusy ? 'Refreshing…' : 'Refresh API schema cache'}</button>
      </div>

      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111a14] p-4">
        <h3 className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-xs font-bold uppercase tracking-widest text-slate-200"><Download size={15} /> Export Data</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">Downloads a CSV of player profile and ZP economy summaries. Telegram IDs, wallet addresses, authentication credentials and secrets are excluded.</p>
        {exportError && <p role="alert" className="mb-2 text-[11px] text-red-300">{exportError}</p>}
        {exportNotice && <p role="status" className="mb-2 text-[11px] text-emerald-300">{exportNotice}</p>}
        <button type="button" onClick={() => void handleExport()} disabled={exportBusy} className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5 text-xs font-semibold text-emerald-200 disabled:opacity-50"><Download size={14} />{exportBusy ? 'Preparing CSV…' : 'Export player summary CSV'}</button>
      </div>
    </section>
  );
}
