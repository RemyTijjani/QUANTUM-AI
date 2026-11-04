import { useEffect, useState } from 'react';
import { Check, X, ExternalLink, Clock, ShieldCheck, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { CreatorOpsSubmission } from '@/lib/supabase';
import { MISSIONS } from '@/lib/game/config';
import { formatZp } from '@/lib/format';
import Modal from '@/components/Modal';

interface AdminReviewModalProps {
  onClose: () => void;
  onApprove: (rewardZp: number) => void;
}

export default function AdminReviewModal({ onClose, onApprove }: AdminReviewModalProps) {
  const [submissions, setSubmissions] = useState<CreatorOpsSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchPending = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('creator_ops_submissions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      setSubmissions([]);
    } else {
      setSubmissions(data as CreatorOpsSubmission[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const review = async (submission: CreatorOpsSubmission, decision: 'approved' | 'rejected') => {
    setProcessing(submission.id);
    const { error } = await supabase
      .from('creator_ops_submissions')
      .update({ status: decision, reviewed_at: new Date().toISOString() })
      .eq('id', submission.id);
    setProcessing(null);
    if (error) return;
    if (decision === 'approved') {
      onApprove(submission.reward_zp);
    }
    setSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
  };

  const missionTitle = (id: string) => MISSIONS.find((m) => m.id === id)?.title ?? id;

  return (
    <Modal title="Admin Review Queue" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] text-neon-500">
            {submissions.length} pending submission{submissions.length !== 1 ? 's' : ''}
          </p>
          <button
            type="button"
            onClick={fetchPending}
            disabled={loading}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neon-500 transition hover:text-neon-300"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 font-mono text-[11px] text-neon-600">
            <Clock size={14} className="mr-2 animate-spin" /> Loading queue...
          </div>
        ) : submissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldCheck size={32} className="mb-3 text-neon-500" />
            <p className="font-mono text-[11px] text-neon-500">No pending submissions. Queue is clear.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {submissions.map((sub) => (
              <li
                key={sub.id}
                className="panel space-y-3 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-xs font-bold uppercase tracking-wide text-neon-300">
                      {missionTitle(sub.mission_id)}
                    </h3>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-neon-600">
                      Operative: {sub.player_referral_code} // {sub.platform}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[10px] tabular-nums text-neon-400">
                    +{formatZp(sub.reward_zp)} ZP
                  </span>
                </div>

                <a
                  href={sub.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-neon/20 bg-black/50 px-3 py-2 font-mono text-[11px] text-cyan-300 transition hover:border-cyan-400/40"
                >
                  <ExternalLink size={13} className="shrink-0" />
                  <span className="truncate">{sub.link_url}</span>
                </a>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => review(sub, 'approved')}
                    disabled={processing === sub.id}
                    className="btn flex-1 border-neon/70 bg-neon/15 text-neon-300 hover:bg-neon/25"
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => review(sub, 'rejected')}
                    disabled={processing === sub.id}
                    className="btn flex-1 border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                  >
                    <X size={14} /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
