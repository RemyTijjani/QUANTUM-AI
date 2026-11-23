import { useCallback, useEffect, useState } from 'react';
import { Database, Download, MessageSquare, Pickaxe, RefreshCw, Send, Trash2 } from 'lucide-react';
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
    // Neutralize spreadsheet formulas after leading control/whitespace characters.
    let firstSignificant = 0;
    while (firstSignificant < raw.length) {
      const code = raw.charCodeAt(firstSignificant);
      if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) firstSignificant += 1;
      else break;
    }
    const first = raw[firstSignificant];
    const safe = first === '=' || first === '+' || first === '-' || first === '@' ? `'${raw}` : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const csv = [headers.map(quote).join(','), ...rows.map((row) => headers.map((key) => quote(row[key])).join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveCursor, setArchiveCursor] = useState<{ highWater: { id: string; created_at: string }; after: { id: string; created_at: string } } | null>(() => {
    try {
      const saved = localStorage.getItem('zord-zp-ledger-archive-progress-v1');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      return parsed?.cursor ?? null;
    } catch { return null; }
  });
  const [archiveCopied, setArchiveCopied] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('zord-zp-ledger-archive-progress-v1');
      return Math.max(0, Number(JSON.parse(saved ?? '{}')?.copied) || 0);
    } catch { return 0; }
  });
  const [archiveDone, setArchiveDone] = useState(false);

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

  const handleArchiveBatch = async (startFresh = false) => {
    if (archiveBusy) return;
    if (startFresh && !window.confirm('Start a new copy-only ZP ledger archive from the newest record? This resets only the saved browser cursor; existing R2 objects and all Supabase records remain untouched.')) return;
    if (!startFresh && !archiveCursor && archiveCopied === 0 &&
        !window.confirm('Start copying the ZP economy ledger to the private R2 archive in verified batches of up to 200 records? No Supabase records will be changed or deleted.')) return;
    setArchiveBusy(true);
    setArchiveError(null);
    setArchiveNotice(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/history-archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'copy-batch',
          batchSize: 200,
          cursor: startFresh ? null : archiveCursor,
          adminUsername: creds.username,
          adminPassword: creds.password,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success || !result?.verified) {
        throw new AdminApiError(typeof result?.error === 'string' ? result.error : `Archive batch failed (${response.status}).`);
      }
      const nextCopied = (startFresh ? 0 : archiveCopied) + Number(result.copied || 0);
      const nextCursor = result.cursor ?? null;
      setArchiveCursor(nextCursor);
      setArchiveCopied(nextCopied);
      setArchiveDone(result.done === true);
      localStorage.setItem('zord-zp-ledger-archive-progress-v1', JSON.stringify({ cursor: nextCursor, copied: nextCopied, updatedAt: new Date().toISOString() }));
      setArchiveNotice(result.copied === 0
        ? 'Archive boundary reached. No more ledger records remain in this run.'
        : `Copied and read-back verified ${result.copied} records in this batch. ${nextCopied.toLocaleString()} records copied in this run. SHA-256: ${result.checksum}. R2 object: ${result.objectKey}. ${result.done ? 'Archive run complete.' : 'Resume cursor saved on this device.'}`);
    } catch (error) {
      setArchiveError(errorText(error));
    } finally {
      setArchiveBusy(false);
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
        <h3 className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-xs font-bold uppercase tracking-widest text-slate-200"><Pickaxe size={15} /> Global Fragment mining controls</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">Fragment mining controls are enforced by PostgreSQL, not the browser. Changes settle earned ZP first. Pausing suspends active mining windows; paused time is excluded when mining resumes.</p>
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
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111a14] p-4">
        <h3 className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-xs font-bold uppercase tracking-widest text-slate-200"><Database size={15} /> ZP Ledger R2 Archive</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">Copies the ZP economy ledger to the private Cloudflare R2 bucket in batches of up to 200. Every batch is downloaded again and verified by SHA-256 checksum and row count. The resume cursor is saved only in this browser so you can continue after reopening the admin panel. No Supabase history is changed or deleted.</p>
        <div className="mb-3 rounded-xl border border-white/10 bg-[#0b120e] p-3">
          <p className="text-xs font-semibold text-white">{archiveDone ? 'Archive run complete' : archiveCursor ? 'Archive can be resumed' : archiveCopied > 0 ? 'Last run reached its boundary' : 'Ready to start'}</p>
          <p className="mt-1 text-[10px] text-slate-400">Verified records copied in this browser run: {archiveCopied.toLocaleString()}</p>
          <p className="mt-1 text-[10px] text-slate-500">{archiveCursor ? `Resume after ${archiveCursor.after.created_at} · ${archiveCursor.after.id}` : 'No pending resume cursor saved.'}</p>
        </div>
        {archiveError && <p role="alert" className="mb-2 break-words text-[11px] text-red-300">{archiveError}</p>}
        {archiveNotice && <p role="status" className="mb-2 break-words text-[11px] text-emerald-300">{archiveNotice}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void handleArchiveBatch(false)} disabled={archiveBusy || archiveDone} className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5 text-xs font-semibold text-emerald-200 disabled:opacity-50"><Database size={14} />{archiveBusy ? 'Copying & verifying…' : archiveCursor ? 'Copy next 200 records' : 'Start 200-record archive'}</button>
          <button type="button" onClick={() => void handleArchiveBatch(true)} disabled={archiveBusy} className="rounded-xl border border-white/10 px-3 py-2.5 text-xs text-slate-300 disabled:opacity-50">Start new run</button>
        </div>
      </div>

    </section>
  );
}
