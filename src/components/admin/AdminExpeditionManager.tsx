import { useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, Plus, ChevronLeft, ChevronRight, Save, Users, BookOpen, Gamepad2, Globe, Trophy, CalendarDays, Sparkles, Layers, ShieldCheck, Clock3 } from 'lucide-react';
import { listAdminExpeditions, publishAdminExpedition, saveExpeditionDraft, listAdminExpeditionObjectiveReviews, reviewAdminExpeditionObjective, type AdminCredentials, type AdminEvent, type AdminExpeditionDraftInput, type AdminExpeditionRecord, type AdminExpeditionObjectiveReview } from '@/lib/admin/adminApi';

type ObjectiveKind = 'briefing' | 'quiz' | 'game' | 'community' | 'external' | 'milestone';
type Objective = { id: number; kind: ObjectiveKind; title: string; scope: 'individual' | 'team' | 'both' };
type LocalDraft = AdminExpeditionRecord;
const steps = ['Basics', 'Access', 'Objectives', 'Rewards', 'Schedule & rules', 'Preview'];
function toLocalDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

const kinds: { value: ObjectiveKind; label: string; icon: typeof BookOpen }[] = [
  { value: 'briefing', label: 'Briefing', icon: BookOpen }, { value: 'quiz', label: 'Knowledge challenge', icon: ShieldCheck },
  { value: 'game', label: 'Game mission', icon: Gamepad2 }, { value: 'community', label: 'Community activity', icon: Users },
  { value: 'external', label: 'External ecosystem', icon: Globe }, { value: 'milestone', label: 'Milestone', icon: Trophy },
];

export default function AdminExpeditionManager({ events, creds }: { events: AdminEvent[]; creds: AdminCredentials }) {
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Community');
  const [access, setAccess] = useState('open');
  const [participation, setParticipation] = useState('both');
  const [rewardType, setRewardType] = useState('ZP');
  const [rewardAmount, setRewardAmount] = useState('100');
  const [teamMin, setTeamMin] = useState('2');
  const [teamMax, setTeamMax] = useState('5');
  const [contribution, setContribution] = useState('1');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [objectiveTitle, setObjectiveTitle] = useState('');
  const [objectiveKind, setObjectiveKind] = useState<ObjectiveKind>('briefing');
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<{ individualSubmissions: AdminExpeditionObjectiveReview[]; teamSubmissions: AdminExpeditionObjectiveReview[] }>({ individualSubmissions: [], teamSubmissions: [] });
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [reviewMessage, setReviewMessage] = useState('');
  const counts = useMemo(() => ({ legacy: events.length, active: drafts.filter(e => e.status === 'registration_open' || e.status === 'active').length, drafts: drafts.filter(e => e.status === 'draft').length }), [events, drafts]);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try { setDrafts(await listAdminExpeditions(creds)); }
    catch (error) { setSavedMessage(error instanceof Error ? error.message : 'Could not load saved Expeditions.'); }
    finally { setLoadingDrafts(false); }
  }, [creds.username, creds.password]);
  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  const loadReviews = useCallback(async () => {
    setLoadingReviews(true);
    try { setReviewQueue(await listAdminExpeditionObjectiveReviews(creds)); setReviewMessage(''); }
    catch (error) { setReviewMessage(error instanceof Error ? error.message : 'Could not load objective reviews.'); }
    finally { setLoadingReviews(false); }
  }, [creds.username, creds.password]);
  useEffect(() => { void loadReviews(); }, [loadReviews]);

  const submitReview = async (item: AdminExpeditionObjectiveReview, scope: 'individual' | 'team', decision: 'verified' | 'rejected') => {
    const key = scope + ':' + item.id;
    const reason = (reviewReasons[key] ?? '').trim();
    if (decision === 'rejected' && !reason) { setReviewMessage('Add a reason before rejecting a submission.'); return; }
    if (reason.length > 500) { setReviewMessage('Review reasons must be 500 characters or fewer.'); return; }
    setReviewingId(key); setReviewMessage('');
    try {
      await reviewAdminExpeditionObjective(creds, { progressId: item.id, progressScope: scope, decision, reason });
      setReviewMessage(decision === 'verified' ? 'Submission verified.' : 'Submission rejected.');
      setReviewReasons(v => ({ ...v, [key]: '' }));
      await Promise.all([loadReviews(), loadDrafts()]);
    } catch (error) { setReviewMessage(error instanceof Error ? error.message : 'Could not review this submission.'); }
    finally { setReviewingId(null); }
  };

  const verificationSource = (kind: ObjectiveKind, scope: Objective['scope']) => {
    const source = ({
      game: 'server-verified Fragment fixes',
      milestone: 'successful Daily Uplink claims',
      community: 'admin-approved Creator Ops submissions',
    } as Partial<Record<ObjectiveKind, string>>)[kind];
    if (!source) return 'Manual review: admin/trusted-system verification required';
    if (scope === 'team') return 'Manual team review: trusted individual source does not verify shared team progress';
    if (scope === 'both') return 'Automatic for individual progress: ' + source + ' · team progress still needs manual review';
    return 'Automatic individual verification: ' + source;
  };

  const reset = () => {
    setStep(0); setTitle(''); setDescription(''); setCategory('Community'); setAccess('open'); setParticipation('both'); setEditingId(null);
    setRewardType('ZP'); setRewardAmount('100'); setTeamMin('2'); setTeamMax('5'); setContribution('1');
    setStartsAt(''); setEndsAt(''); setObjectives([]); setCreating(false); setSavedMessage('');
  };
  const addObjective = () => {
    if (!objectiveTitle.trim() || objectives.length >= 20) return;
    setObjectives(v => [...v, { id: Date.now(), kind: objectiveKind, title: objectiveTitle.trim(), scope: 'individual' }]);
    setObjectiveTitle('');
  };
  const validReward = rewardType === 'none' || (Number.isSafeInteger(Number(rewardAmount)) && Number(rewardAmount) > 0);
  const validDates = (!startsAt || Number.isFinite(new Date(startsAt).getTime())) && (!endsAt || Number.isFinite(new Date(endsAt).getTime())) && (!startsAt || !endsAt || new Date(startsAt).getTime() < new Date(endsAt).getTime());
  const canSave = !!title.trim() && validReward && validDates && objectives.length > 0;
  const saveDraft = async () => {
    if (!canSave || saving) return;
    const min = Number(teamMin);
    const max = Number(teamMax);
    const minContributions = Number(contribution);
    if (participation !== 'solo' && (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max > 100 || min > max || !Number.isInteger(minContributions) || minContributions < 0)) {
      setSavedMessage('Check the team size and individual contribution settings.');
      return;
    }
    setSaving(true);
    setSavedMessage('');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const saved = await saveExpeditionDraft(creds, {
        id: editingId ?? undefined,
        title: title.trim(),
        description: description.trim(),
        category: category as AdminExpeditionDraftInput['category'],
        accessMode: access as 'open' | 'progressive',
        participationMode: participation as 'solo' | 'team' | 'both',
        minTeamSize: participation === 'solo' ? 2 : min,
        maxTeamSize: participation === 'solo' ? 5 : max,
        minIndividualContributions: participation === 'solo' ? 0 : minContributions,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        timezone,
        rewardType: rewardType === 'none' ? 'none' : rewardType.toLowerCase() as 'zp' | 'zap',
        rewardAmount: rewardType === 'none' ? 0 : Number(rewardAmount),
        objectives: objectives.map(({ kind, title, scope }) => ({ kind, title, scope })), 
      });
      
      setSavedMessage(`Draft saved securely to Preview database (ID: ${saved.id}). It remains unpublished.`);
      setCreating(false);
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not save the Expedition draft.');
    } finally {
      setSaving(false);
    }
  };

  const editDraft = (draft: AdminExpeditionRecord) => {
    if (draft.status !== 'draft') return;
    setEditingId(draft.id); setTitle(draft.title); setDescription(draft.description);
    const categoryLabels: Record<string, string> = { open:'Open', progressive:'Progressive', seasonal:'Seasonal', community:'Community', competitive:'Competitive', team:'Team', special_limited_time:'Special limited-time' };
    setCategory(categoryLabels[draft.category] ?? 'Community'); setAccess(draft.access_mode); setParticipation(draft.participation_mode);
    setTeamMin(String(draft.min_team_size)); setTeamMax(String(draft.max_team_size)); setContribution(String(draft.min_individual_contributions));
    setStartsAt(toLocalDateTimeInput(draft.starts_at));
    setEndsAt(toLocalDateTimeInput(draft.ends_at));
    setRewardType(draft.reward?.reward_type === 'none' ? 'none' : (draft.reward?.reward_type ?? 'zp').toUpperCase());
    setRewardAmount(String(draft.reward?.amount ?? 0));
    setObjectives(draft.objectives.map((o,i) => ({ id: i+1, kind: o.objective_type, title: o.title, scope: o.completion_scope ?? 'individual' })));
    setStep(0); setCreating(true); setSavedMessage('');
  };
  const publishDraft = async (draft: AdminExpeditionRecord) => {
    if (draft.status !== 'draft' || publishingId) return;
    if (!window.confirm('Move this Expedition out of Draft? This updates its admin lifecycle status only. It will NOT appear to players yet, and no rewards will be issued.')) return;
    setPublishingId(draft.id); setSavedMessage('');
    try {
      const result = await publishAdminExpedition(creds, draft.id);
      setSavedMessage(`Expedition moved to ${result.status.replace('_',' ')}. Player visibility and reward issuance remain disabled.`);
      await loadDrafts();
    } catch (error) { setSavedMessage(error instanceof Error ? error.message : 'Could not publish Expedition.'); }
    finally { setPublishingId(null); }
  };

  const content = () => {
    if (step === 0) return <div className="grid gap-4 md:grid-cols-2">
      <label className="admin-field-label">Expedition name<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Sentinel Initiation" className="admin-field" /></label>
      <label className="admin-field-label">Category<select value={category} onChange={e => setCategory(e.target.value)} className="admin-field">{['Open','Progressive','Seasonal','Community','Competitive','Team','Special limited-time'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label className="admin-field-label md:col-span-2">Description<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={4} placeholder="Explain the mission and what players will achieve..." className="admin-field" /></label>
    </div>;
    if (step === 1) return <div className="grid gap-4 md:grid-cols-2">
      <fieldset className="space-y-2"><legend className="admin-field-label">Who can access it?</legend>{[['open','Open to eligible players'],['progressive','Unlock after prerequisites']].map(([v,l]) => <label key={v} className="flex gap-3 border border-neon/20 p-3 text-xs text-neon-300"><input type="radio" checked={access===v} onChange={() => setAccess(v)} />{l}</label>)}</fieldset>
      <fieldset className="space-y-2"><legend className="admin-field-label">Participation type</legend>{[['solo','Solo'],['team','Team'],['both','Solo or team']].map(([v,l]) => <label key={v} className="flex gap-3 border border-neon/20 p-3 text-xs text-neon-300"><input type="radio" checked={participation===v} onChange={() => setParticipation(v)} />{l}</label>)}</fieldset>
      {participation !== 'solo' && <div className="md:col-span-2 grid gap-3 rounded border border-neon/20 p-3 md:grid-cols-3">
        <label className="admin-field-label">Minimum team size<input type="number" min="2" max="50" value={teamMin} onChange={e => setTeamMin(e.target.value)} className="admin-field" /></label>
        <label className="admin-field-label">Maximum team size<input type="number" min="2" max="50" value={teamMax} onChange={e => setTeamMax(e.target.value)} className="admin-field" /></label>
        <label className="admin-field-label">Individual contribution minimum<input type="number" min="1" max="20" value={contribution} onChange={e => setContribution(e.target.value)} className="admin-field" /></label>
        <p className="text-[10px] leading-relaxed text-neon-700 md:col-span-3">Approved rule: team membership locks when an Expedition starts. Teams complete shared objectives and each member meets the individual contribution requirement.</p>
      </div>}
    </div>;
    if (step === 2) return <div className="space-y-4">
      <p className="text-[11px] text-neon-600">Combine different objective types. Add up to 20 objectives.</p>
      <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"><select value={objectiveKind} onChange={e => setObjectiveKind(e.target.value as ObjectiveKind)} className="admin-field">{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select><input value={objectiveTitle} onChange={e => setObjectiveTitle(e.target.value)} maxLength={160} placeholder="Objective instruction" className="admin-field" /><button type="button" onClick={addObjective} disabled={!objectiveTitle.trim() || objectives.length>=20} className="border border-neon/40 px-3 py-2 text-xs text-neon-300 disabled:opacity-40"><Plus size={14}/></button></div>
      {objectives.map((o,i) => { const k = kinds.find(x => x.value===o.kind)!; const Icon=k.icon; return <div key={o.id} className="grid gap-2 border border-neon/20 bg-black/30 p-3 md:grid-cols-[minmax(0,1fr)_150px_auto]"><div className="flex min-w-0 items-start gap-3"><span className="pt-1 text-[10px] text-neon-700">{i+1}</span><Icon size={15} className="mt-0.5 text-neon-400"/><div className="min-w-0"><p className="text-xs text-neon-200">{o.title}</p><p className="text-[9px] text-neon-700">{k.label} · Required</p><p className="mt-1 text-[9px] text-emerald-300">{verificationSource(o.kind, o.scope)}</p></div></div><label className="admin-field-label">Completion scope<select value={o.scope} onChange={e => setObjectives(v => v.map(x => x.id===o.id ? { ...x, scope: e.target.value as Objective['scope'] } : x))} className="admin-field"><option value="individual">Individual</option><option value="team">Team</option><option value="both">Both</option></select></label><button type="button" onClick={() => setObjectives(v => v.filter(x => x.id!==o.id))} className="text-left text-[10px] text-red-300">Remove</button></div>; })}
      {!objectives.length && <p className="border border-dashed border-neon/20 p-6 text-center text-xs text-neon-700">No objectives added yet.</p>}
      <p className="text-[10px] text-neon-700">Automatic source matching applies only to the source shown above. Other objective evidence remains in the manual review queue. Briefings are not automatically verified yet.</p>
    </div>;
    if (step === 3) return <div className="grid gap-4 md:grid-cols-2">
      <label className="admin-field-label">Reward type<select value={rewardType} onChange={e => setRewardType(e.target.value)} className="admin-field"><option value="ZP">ZP</option><option value="ZAP">ZAP</option><option value="none">No reward</option></select></label>
      <label className="admin-field-label">Reward amount<input type="number" min="1" step="1" disabled={rewardType==='none'} value={rewardAmount} onChange={e => setRewardAmount(e.target.value)} className="admin-field disabled:opacity-40"/></label>
      {participation!=='solo' && <p className="text-[11px] leading-relaxed text-neon-700 md:col-span-2">Each eligible team member receives the full configured amount, not a shared pool. Team eligibility and reward issuing are not yet connected to the backend.</p>}
      {rewardType==='ZAP' && <p className="text-[11px] text-amber-300 md:col-span-2">ZAP can be configured in this design, but the existing Events reward endpoint does not issue ZAP. Publishing is not enabled here.</p>}
    </div>;
    if (step === 4) return <div className="grid gap-4 md:grid-cols-2">
      <label className="admin-field-label">Starts (local time)<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="admin-field"/></label>
      <label className="admin-field-label">Ends (local time)<input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="admin-field"/></label>
      <div className="rounded border border-neon/20 p-3 text-[11px] leading-relaxed text-neon-600 md:col-span-2"><p className="mb-2 font-bold text-neon-300">Rules in the approved design</p><ul className="list-disc space-y-1 pl-4"><li>Team roster locks at start.</li><li>Shared objectives and individual contribution are checked.</li><li>Only eligible members receive rewards.</li><li>Pausing or cancelling preserves progress and issued rewards.</li></ul></div>
    </div>;
    return <div className="space-y-3 text-xs text-neon-300">
      <div className="rounded border border-neon/20 p-3"><p className="font-bold text-neon-100">{title || 'Untitled Expedition'}</p><p className="mt-1 text-neon-600">{description || 'No description added.'}</p></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[['Category',category],['Access',access],['Participation',participation],['Reward',rewardType==='none'?'None':rewardAmount+' '+rewardType]].map(([k,v]) => <div key={k} className="border border-neon/20 p-2"><p className="text-[9px] uppercase text-neon-700">{k}</p><p className="mt-1">{v}</p></div>)}</div>
      <p className="text-neon-600">{objectives.length} objectives · {startsAt ? new Date(startsAt).toLocaleString() : 'Start not set'} · {endsAt ? new Date(endsAt).toLocaleString() : 'End not set'}</p>
      {objectives.map((o,i) => <p key={o.id} className="border-l border-neon/40 pl-2">{i+1}. {o.title} <span className="text-neon-700">({o.kind} · {o.scope})</span><span className="block text-[9px] text-emerald-300">{verificationSource(o.kind, o.scope)}</span></p>)}
      <p className="border border-amber-500/30 bg-amber-950/10 p-3 text-[10px] text-amber-200">Preview only. Publishing changes the admin lifecycle status; it does not make Expeditions visible to players or issue rewards.</p>
    </div>;
  };

  const metrics = [
    ['Drafts', counts.drafts, Layers],
    ['Legacy Events', counts.legacy, CalendarDays],
    ['Published legacy Events', counts.active, Clock3],
    ['Builder steps', 6, Sparkles],
  ] as const;

  return <section className="space-y-4">
    <style>{'.admin-field{display:block;width:100%;margin-top:6px;background:#020503;border:1px solid rgba(80,255,150,.25);padding:10px;color:#d1fae5;font-size:12px;outline:none}.admin-field:focus{border-color:rgba(80,255,150,.7)}.admin-field-label{display:block;font-size:11px;color:#70d99b}'}</style>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map(([label,value,Icon]) => <div key={label} className="border border-neon/20 bg-black/30 p-3"><Icon size={16} className="mb-2 text-neon-500"/><p className="text-xl font-bold text-neon-200">{value}</p><p className="text-[9px] uppercase tracking-wider text-neon-700">{label}</p></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neon/20 pb-3"><div><h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neon-300"><Compass size={15}/> Expedition Command</h2><p className="mt-1 text-[10px] text-neon-700">Build structured solo, team and mixed-objective Expeditions.</p></div>{!creating && <button type="button" onClick={() => {reset();setCreating(true);}} className="flex items-center gap-2 border border-neon/50 bg-neon/10 px-3 py-2 text-xs text-neon-200"><Plus size={14}/> Create Expedition</button>}</div>
    {savedMessage && <p role="status" className="border-l-2 border-neon/50 bg-neon/5 px-3 py-2 text-[10px] text-neon-300">{savedMessage}</p>}
    {creating && <div className="space-y-4 border border-neon/30 bg-black/40 p-3 sm:p-5">
      <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] uppercase tracking-widest text-neon-500">Expedition Builder</p><h3 className="mt-1 text-sm font-bold text-neon-200">Step {step+1}: {steps[step]}</h3></div><button type="button" onClick={() => setCreating(false)} className="text-[10px] text-neon-700">Close</button></div>
      <div className="grid grid-cols-6 gap-1">{steps.map((name,i) => <button key={name} type="button" onClick={() => setStep(i)} title={name} className={'h-1.5 '+(i<=step?'bg-neon-400':'bg-neon/15')}/>)}</div>
      {content()}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neon/15 pt-3"><button type="button" disabled={step===0} onClick={() => setStep(v => Math.max(0,v-1))} className="flex items-center gap-1 border border-neon/20 px-3 py-2 text-xs text-neon-500 disabled:opacity-30"><ChevronLeft size={14}/> Back</button>{step<5 ? <button type="button" onClick={() => setStep(v => Math.min(5,v+1))} className="flex items-center gap-1 border border-neon/50 bg-neon/10 px-3 py-2 text-xs text-neon-200">Continue <ChevronRight size={14}/></button> : <button type="button" onClick={saveDraft} disabled={!canSave || saving} className="flex items-center gap-2 border border-neon/50 bg-neon/15 px-3 py-2 text-xs text-neon-200 disabled:opacity-40"><Save size={14}/> {saving ? 'Saving…' : 'Save database draft'}</button>}</div>
      {!validDates && <p role="alert" className="text-[10px] text-red-300">The end date must be after the start date.</p>}{!validReward && <p role="alert" className="text-[10px] text-red-300">Enter a whole-number reward greater than zero, or select No reward.</p>}
    </div>}
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-bold uppercase tracking-widest text-neon-600">Saved Expeditions</h3><button type="button" onClick={() => void loadDrafts()} disabled={loadingDrafts} className="border border-neon/20 px-2 py-1 text-[10px] text-neon-400 disabled:opacity-40">Refresh</button></div>
      {loadingDrafts ? <p className="border border-dashed border-neon/20 p-6 text-center text-xs text-neon-700">Loading saved Expeditions…</p> : drafts.length===0 ? <div className="border border-dashed border-neon/20 p-6 text-center text-xs text-neon-700">No Expeditions have been saved yet.</div> : drafts.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border border-neon/20 bg-black/30 p-3">
        <div className="min-w-0"><p className="text-xs text-neon-200">{d.title}</p><p className="mt-1 text-[9px] text-neon-700">{d.category.replace(/_/g,' ')} · {d.participation_mode} · {d.objectives.length} objectives</p><p className="mt-1 text-[9px] uppercase tracking-wider text-neon-500">{d.status.replace(/_/g,' ')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] text-neon-400">{d.reward?.amount ? d.reward.amount+' '+d.reward.reward_type.toUpperCase() : 'No reward'}</span>{d.status==='draft' && <><button type="button" onClick={() => editDraft(d)} className="border border-neon/30 px-2 py-1 text-[10px] text-neon-300">Edit</button><button type="button" disabled={publishingId===d.id} onClick={() => void publishDraft(d)} className="border border-amber-400/40 px-2 py-1 text-[10px] text-amber-200 disabled:opacity-40">{publishingId===d.id?'Publishing…':'Publish'}</button></>}</div>
      </div>)}
    </div>
    <section className="space-y-3 border border-neon/25 bg-black/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-[10px] font-bold uppercase tracking-widest text-neon-300">Objective verification queue</h3><p className="mt-1 text-[10px] text-neon-700">Review player and team evidence that needs an admin decision.</p></div>
        <button type="button" onClick={() => void loadReviews()} disabled={loadingReviews} className="border border-neon/20 px-2 py-1 text-[10px] text-neon-400 disabled:opacity-40">{loadingReviews ? 'Refreshing…' : 'Refresh queue'}</button>
      </div>
      {reviewMessage && <p role="status" className="border-l-2 border-neon/40 bg-neon/5 px-3 py-2 text-[10px] text-neon-300">{reviewMessage}</p>}
      {loadingReviews ? <p className="p-4 text-center text-xs text-neon-700">Loading review submissions…</p> : (
        <>
          {(['individual','team'] as const).map(scope => {
            const items = scope === 'individual' ? reviewQueue.individualSubmissions : reviewQueue.teamSubmissions;
            return <div key={scope} className="space-y-2">
              <div className="flex items-center justify-between border-b border-neon/15 pb-1"><h4 className="text-[10px] font-bold uppercase tracking-wider text-neon-500">{scope === 'individual' ? 'Individual submissions' : 'Team submissions'}</h4><span className="text-[10px] text-neon-700">{items.length} pending</span></div>
              {items.length === 0 ? <p className="border border-dashed border-neon/15 p-3 text-[10px] text-neon-800">No pending {scope} reviews.</p> : items.map(item => {
                const key = scope + ':' + item.id;
                return <article key={key} className="space-y-2 border border-neon/20 bg-black/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="text-xs text-neon-200">{item.expedition_objectives?.title ?? 'Expedition objective'}</p><p className="mt-1 text-[9px] text-neon-700">{item.expedition_objectives?.objective_type ?? 'objective'} · {scope} · submitted {new Date(item.created_at).toLocaleString()}</p><p className="mt-1 break-all text-[9px] text-neon-600">{scope === 'team' ? 'Team: ' + (item.expedition_teams?.name ?? item.team_id ?? 'Unknown') : 'Player ID: ' + (item.player_id ?? 'Unknown')}</p></div>
                    <span className="border border-amber-400/30 px-2 py-1 text-[9px] text-amber-200">Pending review</span>
                  </div>
                  <details className="text-[10px] text-neon-500"><summary className="cursor-pointer">View submitted evidence</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-neon/10 bg-black/50 p-2 text-[9px] text-neon-300">{JSON.stringify(item.evidence ?? {}, null, 2)}</pre></details>
                  <label className="admin-field-label">Review reason {scope === 'team' ? '(optional for approval, required for rejection)' : '(optional for approval, required for rejection)'}<input value={reviewReasons[key] ?? ''} onChange={e => setReviewReasons(v => ({ ...v, [key]: e.target.value }))} maxLength={500} placeholder="Explain the decision…" className="admin-field"/></label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={reviewingId === key} onClick={() => void submitReview(item, scope, 'verified')} className="border border-emerald-400/40 bg-emerald-950/20 px-3 py-2 text-[10px] text-emerald-200 disabled:opacity-40">{reviewingId === key ? 'Saving…' : 'Verify submission'}</button>
                    <button type="button" disabled={reviewingId === key} onClick={() => void submitReview(item, scope, 'rejected')} className="border border-red-400/30 px-3 py-2 text-[10px] text-red-200 disabled:opacity-40">Reject</button>
                  </div>
                </article>;
              })}
            </div>;
          })}
        </>
      )}
      <p className="text-[9px] leading-relaxed text-neon-800">Verifying evidence updates Expedition completion and eligibility only. It does not issue ZP/ZAP or change player balances.</p>
    </section>
    <p className="text-[10px] leading-relaxed text-neon-800">Legacy Events data is preserved. This admin screen does not modify or delete existing Events. Player visibility and real reward issuance remain separate, disabled steps.</p>
  </section>;
}
