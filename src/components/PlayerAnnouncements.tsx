import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Announcement {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

export default function PlayerAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const now = new Date().toISOString();
    void supabase
      .from('zord_announcements')
      .select('id, title, message, created_at')
      .eq('in_app_enabled', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          // The announcement table is added by the Admin operations Preview migration.
          // Fail silently on older deployments while the schema rolls out.
          return;
        }
        setAnnouncements((data ?? []) as Announcement[]);
      });
    return () => { active = false; };
  }, []);

  const visible = announcements.filter((item) => !dismissed.includes(item.id));
  if (!visible.length) return null;

  return (
    <section aria-label="ZORD announcements" className="mx-4 mt-3 space-y-2">
      {visible.map((item) => (
        <article key={item.id} className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <Bell size={15} className="mt-0.5 shrink-0 text-emerald-300" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="break-words text-xs font-bold text-emerald-100">{item.title}</h2>
                <button type="button" onClick={() => setDismissed((current) => [...current, item.id])} aria-label={`Dismiss announcement: ${item.title}`} className="shrink-0 rounded-md p-1 text-emerald-200/70 hover:bg-white/10 hover:text-white"><X size={13} /></button>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-200">{item.message}</p>
              <p className="mt-2 text-[9px] text-emerald-200/60">{new Date(item.created_at).toLocaleString()}</p>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
