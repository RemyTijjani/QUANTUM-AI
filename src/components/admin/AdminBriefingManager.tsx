import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import type { AdminCredentials } from '@/lib/admin/adminApi';
import { AdminApiError, listAdminBriefings, publishAdminBriefing, saveAdminBriefing } from '@/lib/admin/adminApi';
import type { AdminBriefingInput, AdminBriefingRecord, AdminBriefingQuestionInput } from '@/lib/admin/adminApi';

const blankQuestion = (): AdminBriefingQuestionInput => ({
  prompt: '', options: ['', '', '', ''], correctOptionIndex: 0, explanation: '',
});

export default function AdminBriefingManager({ creds }: { creds: AdminCredentials }) {
  const [rows, setRows] = useState<AdminBriefingRecord[]>([]);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState('getting_started');
  const [body, setBody] = useState('');
  const [accessMode, setAccessMode] = useState<'open' | 'progressive'>('open');
  const [prerequisiteId, setPrerequisiteId] = useState('');
  const [passingScore, setPassingScore] = useState(70);
  const [rewardType, setRewardType] = useState<'none' | 'zp' | 'zap'>('none');
  const [rewardAmount, setRewardAmount] = useState(0);
  const [questions, setQuestions] = useState<AdminBriefingQuestionInput[]>([blankQuestion(), blankQuestion(), blankQuestion()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAdminBriefings(creds));
      setError('');
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not load Briefings.');
    } finally { setLoading(false); }
  }, [creds]);

  useEffect(() => { void refresh(); }, [refresh]);

  const reset = () => {
    setEditingId(undefined); setTitle(''); setSummary(''); setCategory('getting_started');
    setBody(''); setAccessMode('open'); setPrerequisiteId(''); setPassingScore(70);
    setRewardType('none'); setRewardAmount(0); setQuestions([blankQuestion(), blankQuestion(), blankQuestion()]);
    setNotice(''); setError('');
  };

  const edit = (row: AdminBriefingRecord) => {
    setEditingId(row.id); setTitle(row.title); setSummary(row.summary); setCategory(row.category);
    setBody(row.content?.map((block) => block.body || '').join('\n\n') ?? '');
    setAccessMode(row.access_mode); setPrerequisiteId(row.prerequisite_briefing_id ?? '');
    setPassingScore(row.passing_score); setRewardType(row.reward_type); setRewardAmount(Number(row.reward_amount));
    setQuestions(row.questions.map((q: any) => ({
      prompt: q.prompt, options: q.options, correctOptionIndex: q.correctOptionIndex, explanation: q.explanation ?? '',
    })));
    setNotice('Editing draft: ' + row.title); setError('');
  };

  const updateQuestion = (index: number, patch: Partial<AdminBriefingQuestionInput>) => {
    setQuestions((current) => current.map((q, i) => i === index ? { ...q, ...patch } : q));
  };
  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    setQuestions((current) => current.map((q, i) => i === questionIndex
      ? { ...q, options: q.options.map((option, j) => j === optionIndex ? value : option) } : q));
  };

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    const input: AdminBriefingInput = {
      id: editingId, title, summary, category,
      content: [{ type: 'text', title, body }],
      accessMode, prerequisiteBriefingId: accessMode === 'progressive' ? prerequisiteId || null : null,
      passingScore, rewardType, rewardAmount: rewardType === 'none' ? 0 : rewardAmount, questions,
    };
    try {
      const saved = await saveAdminBriefing(creds, input);
      setEditingId(saved.id);
      setNotice('Draft saved. It is not visible to players until you publish it.');
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not save this briefing.');
    } finally { setSaving(false); }
  };

  const publish = async (id: string) => {
    if (!window.confirm('Publish this briefing? Players who meet its unlock requirements will be able to read it and take the quiz.')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await publishAdminBriefing(creds, id);
      setNotice('Briefing published and available to eligible players.');
      reset();
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Could not publish this briefing.');
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="label">Stage 6 · Learning centre</p><h2 className="mt-1 font-display text-sm uppercase text-neon-200">Intelligence Briefings</h2><p className="mt-1 font-mono text-[9px] text-neon-600">Write learning content, create a quiz, set unlocking and configure rewards.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 border border-neon/30 px-3 py-2 text-[9px] text-neon-300"><RefreshCw size={12} /> Refresh</button>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between"><h3 className="font-display text-xs uppercase text-neon-300">{editingId ? 'Edit briefing draft' : 'Create briefing'}</h3><button type="button" onClick={reset} className="text-[9px] text-neon-600">Clear form</button></div>
        <label className="block space-y-1"><span className="label">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="w-full rounded border border-neon/20 bg-black/40 p-2 text-xs text-neon-200" placeholder="Introduction to ZORD" /></label>
        <label className="block space-y-1"><span className="label">Short summary</span><textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} rows={2} className="w-full rounded border border-neon/20 bg-black/40 p-2 text-xs text-neon-200" placeholder="What will players learn?" /></label>
        <label className="block space-y-1"><span className="label">Briefing content</span><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={6000} className="w-full rounded border border-neon/20 bg-black/40 p-3 text-xs leading-relaxed text-neon-200" placeholder="Write the lesson here. Use paragraphs to make it easy to read." /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="label">Category</span><select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded border border-neon/20 bg-black/50 p-2 text-xs"><option value="getting_started">Getting started</option><option value="economy">ZP & ZAP</option><option value="ecosystem">ZORD ecosystem</option><option value="security">Security</option><option value="missions">Missions</option></select></label>
          <label className="space-y-1"><span className="label">Passing score (%)</span><input type="number" min={1} max={100} value={passingScore} onChange={(e) => setPassingScore(Number(e.target.value))} className="w-full rounded border border-neon/20 bg-black/50 p-2 text-xs" /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="label">Unlocking</span><select value={accessMode} onChange={(e) => setAccessMode(e.target.value as 'open' | 'progressive')} className="w-full rounded border border-neon/20 bg-black/50 p-2 text-xs"><option value="open">Open</option><option value="progressive">After another briefing</option></select></label>
          {accessMode === 'progressive' && <label className="space-y-1"><span className="label">Prerequisite</span><select value={prerequisiteId} onChange={(e) => setPrerequisiteId(e.target.value)} className="w-full rounded border border-neon/20 bg-black/50 p-2 text-xs"><option value="">Choose briefing</option>{rows.filter((r) => r.status === 'published' && r.id !== editingId).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="label">Reward</span><select value={rewardType} onChange={(e) => setRewardType(e.target.value as 'none' | 'zp' | 'zap')} className="w-full rounded border border-neon/20 bg-black/50 p-2 text-xs"><option value="none">No reward</option><option value="zp">ZP</option><option value="zap">ZAP</option></select></label>
          {rewardType !== 'none' && <label className="space-y-1"><span className="label">Reward amount</span><input type="number" min={1} step={1} value={rewardAmount} onChange={(e) => setRewardAmount(Number(e.target.value))} className="w-full rounded border border-neon/20 bg-black/50 p-2 text-xs" /></label>}
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between"><h3 className="font-display text-xs uppercase text-neon-300">Knowledge check</h3><button type="button" onClick={() => setQuestions((q) => q.length < 10 ? [...q, blankQuestion()] : q)} disabled={questions.length >= 10} className="flex items-center gap-1 text-[9px] text-neon-300 disabled:opacity-40"><Plus size={12} /> Add question</button></div>
        {questions.map((question, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-neon/15 bg-black/20 p-3">
            <div className="flex items-center justify-between"><span className="label">Question {index + 1}</span><button type="button" onClick={() => setQuestions((q) => q.length > 3 ? q.filter((_, i) => i !== index) : q)} disabled={questions.length <= 3} className="text-neon-700 disabled:opacity-30"><Trash2 size={13} /></button></div>
            <textarea value={question.prompt} onChange={(e) => updateQuestion(index, { prompt: e.target.value })} rows={2} maxLength={1000} className="w-full rounded border border-neon/20 bg-black/40 p-2 text-xs" placeholder="Enter the question" />
            {question.options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2">
                <input type="radio" name={'correct-' + index} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuestion(index, { correctOptionIndex: optionIndex })} aria-label="Mark as correct answer" />
                <input value={option} onChange={(e) => updateOption(index, optionIndex, e.target.value)} maxLength={300} className="min-w-0 flex-1 rounded border border-neon/15 bg-black/40 p-2 text-[10px]" placeholder={'Option ' + (optionIndex + 1)} />
              </div>
            ))}
            <input value={question.explanation} onChange={(e) => updateQuestion(index, { explanation: e.target.value })} maxLength={1000} className="w-full rounded border border-neon/10 bg-black/30 p-2 text-[10px]" placeholder="Optional explanation shown after grading" />
          </div>
        ))}
      </div>

      {error && <p role="alert" className="rounded border border-red-500/30 bg-red-500/5 p-3 text-[10px] text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded border border-neon/20 bg-neon/5 p-3 text-[10px] text-neon-300">{notice}</p>}
      <button type="button" onClick={() => void save()} disabled={saving || !title.trim() || !body.trim()} className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-[10px] disabled:opacity-40"><Save size={14} /> {saving ? 'Saving…' : 'Save briefing draft'}</button>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-xs uppercase text-neon-300">Saved briefings</h3>
        {loading && <p className="text-[9px] text-neon-600">Loading…</p>}
        {!loading && rows.length === 0 && <p className="font-mono text-[9px] text-neon-700">No briefings have been created.</p>}
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 border-b border-neon/10 pb-3">
            <BookOpen size={15} className="text-neon-500" />
            <div className="min-w-0 flex-1"><p className="truncate text-[10px] text-neon-200">{row.title}</p><p className="text-[8px] uppercase text-neon-700">{row.status} · {row.questions.length} questions</p></div>
            {row.status === 'draft' && <><button type="button" onClick={() => edit(row)} className="border border-neon/20 px-2 py-1 text-[8px] text-neon-300">Edit</button><button type="button" disabled={saving} onClick={() => void publish(row.id)} className="flex items-center gap-1 border border-emerald-400/30 px-2 py-1 text-[8px] text-emerald-300 disabled:opacity-40"><Send size={10} /> Publish</button></>}
          </div>
        ))}
      </div>
      <p className="font-mono text-[8px] leading-relaxed text-neon-700">A passed quiz creates a pending reward record only. This editor does not issue ZP or ZAP or change player balances.</p>
    </section>
  );
}
