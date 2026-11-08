import { useState, FormEvent } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { fetchDashboard, AdminApiError } from '@/lib/admin/adminApi';
import type { AdminCredentials, AdminDashboardData } from '@/lib/admin/adminApi';

interface AdminLoginProps {
  onSuccess: (creds: AdminCredentials, data: AdminDashboardData) => void;
  onClose: () => void;
}

export default function AdminLogin({ onSuccess, onClose }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const creds = { username: username.trim(), password };
    setSubmitting(true);
    setError('');
    try {
      const data = await fetchDashboard(creds);
      onSuccess(creds, data);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#020503] text-neon-400 font-mono flex items-center justify-center p-4">
      <div className="panel w-full max-w-sm border border-neon/30 bg-[#020503]/95 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 border border-neon bg-neon/10 text-neon">
            <Lock size={20} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-neon-600">Autonomous Moderation Intelligence</p>
            <h1 className="text-base font-display font-bold tracking-wider text-neon-300">ZORD OS // ADMIN ACCESS</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Operator ID</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              autoFocus
              required
              disabled={submitting}
              className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 focus:outline-none focus:border-neon disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-[11px] text-neon-500 uppercase">Access Key</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              disabled={submitting}
              className="w-full mt-1 bg-black/60 border border-neon/30 p-2 text-xs text-neon-300 focus:outline-none focus:border-neon disabled:opacity-50"
            />
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-red-400 border-l-2 border-red-500/50 pl-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 flex items-center justify-center gap-2 bg-neon/20 hover:bg-neon/30 border border-neon text-xs uppercase tracking-wider font-bold transition disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Verifying...' : 'Authenticate'}
          </button>
        </form>

        <button
          onClick={onClose}
          className="w-full text-center text-[10px] uppercase tracking-wider text-neon-600 hover:text-neon-400 transition"
        >
          Return to App
        </button>
      </div>
    </div>
  );
}
