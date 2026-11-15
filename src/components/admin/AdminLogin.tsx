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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070d09] p-4 font-sans text-slate-100">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-[#111a14] p-6 shadow-2xl sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
            <Lock size={20} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Secure administration</p>
            <h1 className="text-base font-display font-bold tracking-wider text-emerald-300">Admin sign in</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Admin username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              autoFocus
              required
              disabled={submitting}
              className="mt-2 w-full rounded-xl border border-white/10 bg-[#080e0a] px-3 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400/50 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 uppercase">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              disabled={submitting}
              className="w-full mt-1 bg-[#080e0a] border border-white/10 p-2 text-xs text-emerald-300 focus:outline-none focus:border-emerald-400/40 disabled:opacity-50"
            />
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-red-400 border-l-2 border-red-500/50 pl-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-[#07110b] transition hover:bg-emerald-300 disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Verifying...' : 'Sign in'}
          </button>
        </form>

        <button
          onClick={onClose}
          className="w-full text-center text-xs font-medium text-slate-400 transition hover:text-white"
        >
          Return to App
        </button>
      </div>
    </div>
  );
}
