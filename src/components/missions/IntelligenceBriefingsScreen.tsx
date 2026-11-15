import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BookOpen, CheckCircle2, ChevronDown, ChevronUp, Lock, Radio, RefreshCw, Trophy } from 'lucide-react';

type BriefingContentBlock = {
  type?: 'text' | 'image' | 'video';
  title?: string;
  body?: string;
  url?: string;
  caption?: string;
};
type BriefingQuestion = { id: string; prompt: string; options: string[]; explanation?: string; order: number };
type Briefing = {
  id: string; slug: string; title: string; summary: string; category: string;
  content: BriefingContentBlock[]; passingScore: number; reward: { type: string; amount: number };
  questions: BriefingQuestion[]; progress: { status: string; attempts: number; bestScore: number; completedAt: string | null } | null;
  isUnlocked: boolean; lockedReason: string | null; publishedAt: string | null;
};

export default function IntelligenceBriefingsScreen() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ score: number; passed: boolean; passingScore: number; rewardPending?: boolean } | null>(null);

  const refresh = useCallback(async (keepSelection = true) => {
    setLoading(true);
    const { data, error: requestError } = await supabase.functions.invoke('intelligence-briefings');
    if (requestError || !data?.briefings) {
      setError(data?.error || requestError?.message || 'Could not load briefings.');
      setLoading(false);
      return;
    }
    const rows = data.briefings as Briefing[];
    setBriefings(rows);
    setSelectedId((current) => keepSelection && current && rows.some((row) => row.id === current)
      ? current : rows.find((row) => row.isUnlocked && row.progress?.status !== 'completed')?.id ?? rows[0]?.id ?? null);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(false); }, [refresh]);

  const selected = useMemo(() => briefings.find((item) => item.id === selectedId) ?? null, [briefings, selectedId]);
  const completedCount = briefings.filter((item) => item.progress?.status === 'completed').length;
  const unlockedCount = briefings.filter((item) => item.isUnlocked).length;

  const choose = (id: string) => {
    setSelectedId(id);
    setAnswers({});
    setResult(null);
  };

  const submit = async () => {
    if (!selected || Object.keys(answers).length !== selected.questions.length) return;
    setSubmitting(true);
    const { data, error: requestError } = await supabase.functions.invoke('intelligence-briefings', {
      body: { action: 'submit_attempt', briefingId: selected.id, answers },
    });
    setSubmitting(false);
    if (requestError || !data?.success) {
      setError(data?.error || requestError?.message || 'Quiz submission failed.');
      return;
    }
    setError('');
    setResult({
      score: Number(data.score ?? 0),
      passed: Boolean(data.passed),
      passingScore: Number(data.passingScore ?? selected.passingScore),
      rewardPending: Boolean(data.rewardPending),
    });
    await refresh(true);
  };

  return (
    <section className="space-y-3">
      <div className="panel space-y-3 border border-neon/25 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/30 bg-neon/10 text-neon-300"><Radio size={18} /></span>
          <div><p className="label">Operations intelligence</p><h2 className="title mt-1">Intelligence Briefings</h2></div>
          <button type="button" onClick={() => void refresh()} className="ml-auto rounded-lg border border-neon/20 p-2 text-neon-400" aria-label="Refresh briefings"><RefreshCw size={14} /></button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-neon-500">Read official ZORD intelligence, learn how the ecosystem works, and pass each knowledge check to unlock the next briefing.</p>
        <div className="flex gap-4 border-t border-neon/10 pt-3 font-mono text-[9px] uppercase text-neon-600">
          <span>{completedCount} completed</span><span>{unlockedCount} unlocked</span><span>{briefings.length} total</span>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 font-mono text-[10px] text-amber-200">{error}</div>}
      {loading && <div className="panel p-6 text-center font-mono text-[10px] text-neon-500">Loading intelligence feed…</div>}
      {!loading && briefings.length === 0 && (
        <div className="panel py-10 text-center">
          <Radio size={26} className="mx-auto text-neon-700" />
          <h3 className="mt-3 font-display text-xs font-bold uppercase tracking-wider text-neon-300">No published briefings yet</h3>
          <p className="mx-auto mt-2 max-w-xs font-mono text-[9px] leading-relaxed text-neon-700">Operations will publish the first intelligence transmission here.</p>
        </div>
      )}

      {!loading && briefings.length > 0 && (
        <div className="grid gap-3">
          <div className="panel space-y-2 p-3">
            <p className="label">Briefing sequence</p>
            {briefings.map((item, index) => (
              <button key={item.id} type="button" disabled={!item.isUnlocked} onClick={() => choose(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${selectedId === item.id ? 'border-neon/50 bg-neon/10' : 'border-neon/10 bg-black/20'} ${!item.isUnlocked ? 'opacity-50' : ''}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon/20 font-mono text-[9px] text-neon-400">
                  {item.progress?.status === 'completed' ? <CheckCircle2 size={14} /> : !item.isUnlocked ? <Lock size={13} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate font-display text-[10px] uppercase text-neon-200">{item.title}</span><span className="mt-1 block truncate font-mono text-[8px] text-neon-700">{item.summary}</span></span>
                <span className="shrink-0 font-mono text-[8px] uppercase text-neon-600">{item.progress?.status === 'completed' ? 'Done' : item.isUnlocked ? 'Open' : 'Locked'}</span>
              </button>
            ))}
          </div>

          {selected && (
            <article className="panel space-y-4 p-4">
              <div>
                <p className="label">{selected.category.replace(/_/g, ' ')} · Briefing</p>
                <h3 className="mt-1 font-display text-base font-bold uppercase tracking-wide text-neon-200">{selected.title}</h3>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-neon-500">{selected.summary}</p>
              </div>

              <div className="space-y-3">
                {selected.content.map((block, index) => (
                  <div key={index} className="space-y-2">
                    {block.title && <h4 className="font-display text-[11px] font-bold uppercase text-cyan-200">{block.title}</h4>}
                    {block.type === 'image' && block.url && <img src={block.url} alt={block.caption || block.title || 'Briefing illustration'} loading="lazy" className="w-full rounded-lg border border-neon/15" />}
                    {block.type === 'video' && block.url && <a href={block.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-neon/20 px-3 py-2 font-mono text-[9px] text-cyan-200">Watch briefing video ↗</a>}
                    {block.body && <p className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-neon-300">{block.body}</p>}
                    {block.caption && <p className="font-mono text-[8px] text-neon-700">{block.caption}</p>}
                  </div>
                ))}
              </div>

              {selected.progress?.status === 'completed' ? (
                <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3">
                  <div className="flex items-center gap-2 text-emerald-300"><Trophy size={15} /><span className="font-display text-[10px] uppercase">Briefing completed</span></div>
                  <p className="mt-1 font-mono text-[9px] text-emerald-200/70">Best score: {selected.progress.bestScore}% · Attempts: {selected.progress.attempts}</p>
                </div>
              ) : (
                <div className="space-y-3 border-t border-neon/15 pt-4">
                  <div><p className="label">Knowledge check</p><p className="mt-1 font-mono text-[9px] text-neon-600">Pass mark: {selected.passingScore}% · {selected.questions.length} questions</p></div>
                  {selected.questions.map((question, index) => (
                    <fieldset key={question.id} className="space-y-2 rounded-lg border border-neon/15 bg-black/20 p-3">
                      <legend className="px-1 font-mono text-[9px] text-neon-300">QUESTION {index + 1}</legend>
                      <p className="font-mono text-[10px] leading-relaxed text-neon-200">{question.prompt}</p>
                      <div className="space-y-2">
                        {question.options.map((option, optionIndex) => (
                          <label key={optionIndex} className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 font-mono text-[9px] ${answers[question.id] === optionIndex ? 'border-neon/50 bg-neon/10 text-neon-200' : 'border-neon/10 text-neon-500'}`}>
                            <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} className="mt-0.5 accent-cyan-400" />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <button type="button" onClick={() => void submit()} disabled={submitting || selected.questions.length === 0 || Object.keys(answers).length !== selected.questions.length}
                    className="btn-primary w-full py-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-40">
                    {submitting ? 'Checking answers securely…' : 'Submit knowledge check'}
                  </button>
                  {result && (
                    <div className={`rounded-lg border p-3 ${result.passed ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-400/25 bg-amber-400/5'}`}>
                      <p className={`font-display text-sm uppercase ${result.passed ? 'text-emerald-300' : 'text-amber-200'}`}>{result.passed ? 'Knowledge check passed' : 'Not quite — try again'}</p>
                      <p className="mt-1 font-mono text-[10px] text-neon-300">Score: {result.score}% · Required: {result.passingScore}%</p>
                      {result.rewardPending && <p className="mt-1 font-mono text-[8px] text-neon-600">Reward recorded as pending. No balance was changed.</p>}
                    </div>
                  )}
                </div>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
}
