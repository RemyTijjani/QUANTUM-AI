import { useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, Plus, ChevronLeft, ChevronRight, Save, Users, BookOpen, Gamepad2, Globe, Trophy, CalendarDays, Layers, ShieldCheck, Clock3, Copy, CalendarClock, Trash2 } from 'lucide-react';
import { listAdminExpeditions, publishAdminExpedition, rescheduleAdminExpedition, issueAdminExpeditionRewards, saveExpeditionDraft, deleteAdminExpeditionDraft, listAdminExpeditionObjectiveReviews, reviewAdminExpeditionObjective, type AdminCredentials, type AdminExpeditionDraftInput, type AdminExpeditionRecord, type AdminExpeditionObjectiveReview } from '@/lib/admin/adminApi';

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
  { value: 'briefing', label: 'Instructions', icon: BookOpen }, { value: 'quiz', label: 'Knowledge challenge', icon: ShieldCheck },
  { value: 'game', label: 'Game mission', icon: Gamepad2 }, { value: 'community', label: 'Community activity', icon: Users },
  { value: 'external', label: 'External ecosystem', icon: Globe }, { value: 'milestone', label: 'Milestone', icon: Trophy },
];

export default function AdminExpeditionManager({ creds }: { creds: AdminCredentials }) {
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [issuingRewardsId, setIssuingRewardsId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [savedMessageKind, setSavedMessageKind] = useState<'success' | 'error' | 'info'>('info');
  const [saving, setSaving] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<{ individualSubmissions: AdminExpeditionObjectiveReview[]; teamSubmissions: AdminExpeditionObjectiveReview[] }>({ individualSubmissions: [], teamSubmissions: [] });
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [reviewMessage, setReviewMessage] = useState('');
  const counts = useMemo(() => ({ expeditions: drafts.length, live: drafts.filter(e => e.status === 'registration_open' || e.status === 'active').length, drafts: drafts.filter(e => e.status === 'draft').length, pendingReviews: reviewQueue.individualSubmissions.length + reviewQueue.teamSubmissions.length }), [drafts, reviewQueue]);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try { setDrafts(await listAdminExpeditions(creds)); }
    catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not load saved Expeditions.');
      setSavedMessageKind('error');
    }
    finally { setLoadingDrafts(false); }
  }, [creds]);
  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  const loadReviews = useCallback(async () => {
    setLoadingReviews(true);
    try { setReviewQueue(await listAdminExpeditionObjectiveReviews(creds)); setReviewMessage(''); }
    catch (error) { setReviewMessage(error instanceof Error ? error.message : 'Could not load objective reviews.'); }
    finally { setLoadingReviews(false); }
  }, [creds]);
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
  const saveDraft = async () => {
    if (saving) return;
    if (!title.trim()) { setSavedMessage('Add an Expedition name before saving.'); setSavedMessageKind('error'); return; }
    if (!validReward) { setSavedMessage('Enter a whole-number reward greater than zero, or select No reward.'); setSavedMessageKind('error'); return; }
    if (!validDates) { setSavedMessage('The end date must be later than the start date.'); setSavedMessageKind('error'); return; }
    if (participation !== 'solo' && (!startsAt || !endsAt)) { setSavedMessage('Team Expeditions need both a future start date and an end date.'); setSavedMessageKind('error'); return; }
    if (participation !== 'solo' && new Date(startsAt) <= new Date()) { setSavedMessage('Choose a future start date so players have time to register their teams.'); setSavedMessageKind('error'); return; }
    if (objectives.length === 0) { setSavedMessage('Add at least one objective before saving.'); setSavedMessageKind('error'); return; }
    const min = Number(teamMin);
    const max = Number(teamMax);
    const minContributions = Number(contribution);
    if (participation !== 'solo' && (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max > 100 || min > max || !Number.isInteger(minContributions) || minContributions < 0)) {
      setSavedMessage('Check the team size and individual contribution settings.');
      setSavedMessageKind('error');
      return;
    }
    setSaving(true);
    setSavedMessage('');
    setSavedMessageKind('info');
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
      
      setSavedMessage(`Saved successfully: ${title.trim()} is now in Saved Expeditions. Draft ID: ${saved.id}. It has not been published.`);
      setSavedMessageKind('success');
      setCreating(false);
      await loadDrafts();
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not save the Expedition draft.');
      setSavedMessageKind('error');
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
    setStep(0); setCreating(true); setSavedMessage(''); setSavedMessageKind('info');
  };
  const duplicateExpedition = (draft: AdminExpeditionRecord) => {
    const categoryLabels: Record<string, string> = { open:'Open', progressive:'Progressive', seasonal:'Seasonal', community:'Community', competitive:'Competitive', team:'Team', special_limited_time:'Special limited-time' };
    setEditingId(null);
    setTitle(draft.title + ' (Copy)');
    setDescription(draft.description);
    setCategory(categoryLabels[draft.category] ?? 'Community');
    setAccess(draft.access_mode);
    setParticipation(draft.participation_mode);
    setTeamMin(String(draft.min_team_size));
    setTeamMax(String(draft.max_team_size));
    setContribution(String(draft.min_individual_contributions));
    setStartsAt('');
    setEndsAt('');
    setRewardType(draft.reward?.reward_type === 'none' ? 'none' : (draft.reward?.reward_type ?? 'zp').toUpperCase());
    setRewardAmount(String(draft.reward?.amount ?? 0));
    setObjectives(draft.objectives.map((o,i) => ({ id: i+1, kind: o.objective_type, title: o.title, scope: o.completion_scope ?? 'individual' })));
    setStep(0);
    setCreating(true);
    setSavedMessage('A new draft copy is ready. Set a future schedule before saving.');
    setSavedMessageKind('info');
  };
  const beginReschedule = (draft: AdminExpeditionRecord) => {
    setReschedulingId(draft.id);
    setRescheduleStart(toLocalDateTimeInput(draft.starts_at));
    setRescheduleEnd(toLocalDateTimeInput(draft.ends_at));
    setSavedMessage('');
  };
  const submitReschedule = async (draft: AdminExpeditionRecord) => {
    if (!rescheduleStart || !rescheduleEnd || new Date(rescheduleStart) <= new Date() || new Date(rescheduleEnd) <= new Date(rescheduleStart)) {
      setSavedMessage('Choose a future start date and an end date later than the start.');
      setSavedMessageKind('error');
      return;
    }
    setPublishingId(draft.id);
    setSavedMessage('');
    try {
      await rescheduleAdminExpedition(creds, draft.id, new Date(rescheduleStart).toISOString(), new Date(rescheduleEnd).toISOString());
      setSavedMessage('Expedition rescheduled successfully.');
      setSavedMessageKind('success');
      setReschedulingId(null);
      await loadDrafts();
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not reschedule this Expedition.');
      setSavedMessageKind('error');
    } finally { setPublishingId(null); }
  };
  const issueRewards = async (draft: AdminExpeditionRecord) => {
    if (draft.status !== 'completed' || !draft.reward || draft.reward.reward_type === 'none' || issuingRewardsId) return;
    const confirmed = window.confirm(
      `Issue ${draft.reward.amount} ${draft.reward.reward_type.toUpperCase()} to every currently eligible participant in "${draft.title}"? This will change player balances. Already-issued rewards will not be paid twice.`
    );
    if (!confirmed) return;
    setIssuingRewardsId(draft.id); setSavedMessage(''); setSavedMessageKind('info');
    try {
      const result = await issueAdminExpeditionRewards(creds, draft.id);
      setSavedMessage(`Reward processing complete: ${result.issuedCount} player(s) paid ${result.amountPerPlayer} ${result.rewardType.toUpperCase()} each; ${result.voidedCount} ineligible record(s) skipped.`);
      setSavedMessageKind('success');
      await loadDrafts();
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not issue Expedition rewards.');
      setSavedMessageKind('error');
    } finally { setIssuingRewardsId(null); }
  };

  const deleteDraft = async (draft: AdminExpeditionRecord) => {
    if (draft.status !== 'draft' || deletingId) return;
    const confirmed = window.confirm(
      `Delete the unpublished draft "${draft.title}"? Only draft setup data will be removed. Published Expeditions and any player activity or rewards are protected.`
    );
    if (!confirmed) return;
    setDeletingId(draft.id);
    setSavedMessage('');
    try {
      await deleteAdminExpeditionDraft(creds, draft.id);
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      if (editingId === draft.id) reset();
      setSavedMessage(`Draft "${draft.title}" deleted. No player balances or progress were changed.`);
      setSavedMessageKind('success');
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not delete this Expedition draft.');
      setSavedMessageKind('error');
    } finally {
      setDeletingId(null);
    }
  };

  const publishDraft = async (draft: AdminExpeditionRecord) => {
    if (draft.status !== 'draft' || publishingId) return;
    const rewardWarning = draft.reward && draft.reward.reward_type !== 'none'
      ? '\\n\\nRewards are not paid when you publish. After the Expedition is completed, you can separately issue rewards to eligible players.'
      : '';
    if (!window.confirm('Publish this Expedition? It will become visible in the Player Expeditions list. You can no longer edit it as a draft.' + rewardWarning)) return;
    setPublishingId(draft.id); setSavedMessage(''); setSavedMessageKind('info');
    try {
      const result = await publishAdminExpedition(creds, draft.id);
      setSavedMessage(`Published successfully. This Expedition is now visible to players (${result.status.replace('_',' ')}).${draft.reward && draft.reward.reward_type !== 'none' ? ' Rewards can be issued separately after completion and eligibility review.' : ''}`);
      setSavedMessageKind('success');
      await loadDrafts();
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Could not publish Expedition.');
      setSavedMessageKind('error');
    }
    finally { setPublishingId(null); }
  };

  const content = () => {
    if (step === 0) return <div className="grid gap-4 md:grid-cols-2">
      <label className="admin-field-label">Expedition name<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Sentinel Initiation" className="admin-field" /></label>
      <label className="admin-field-label">Category<select value={category} onChange={e => setCategory(e.target.value)} className="admin-field">{['Open','Progressive','Seasonal','Community','Competitive','Team','Special limited-time'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label className="admin-field-label md:col-span-2">Description<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={4} placeholder="Explain the mission and what players will achieve..." className="admin-field" /></label>
    </div>;
    if (step === 1) return <div className="grid gap-4 md:grid-cols-2">
      <fieldset className="space-y-2"><legend className="admin-field-label">Who can access it?</legend>{[['open','Open to eligible players'],['progressive','Unlock after prerequisites']].map(([v,l]) => <label key={v} className="flex gap-3 border border-white/10 p-3 text-xs text-emerald-300"><input type="radio" checked={access===v} onChange={() => setAccess(v)} />{l}</label>)}</fieldset>
      <fieldset className="space-y-2"><legend className="admin-field-label">Participation type</legend>{[['solo','Solo'],['team','Team'],['both','Solo or team']].map(([v,l]) => <label key={v} className="flex gap-3 border border-white/10 p-3 text-xs text-emerald-300"><input type="radio" checked={participation===v} onChange={() => setParticipation(v)} />{l}</label>)}</fieldset>
      {participation !== 'solo' && <div className="md:col-span-2 grid gap-3 rounded border border-white/10 p-3 md:grid-cols-3">
        <label className="admin-field-label">Minimum team size<input type="number" min="2" max="50" value={teamMin} onChange={e => setTeamMin(e.target.value)} className="admin-field" /></label>
        <label className="admin-field-label">Maximum team size<input type="number" min="2" max="50" value={teamMax} onChange={e => setTeamMax(e.target.value)} className="admin-field" /></label>
        <label className="admin-field-label">Individual contribution minimum<input type="number" min="1" max="20" value={contribution} onChange={e => setContribution(e.target.value)} className="admin-field" /></label>
        <p className="text-[10px] leading-relaxed text-slate-500 md:col-span-3">Approved rule: team membership locks when an Expedition starts. Teams complete shared objectives and each member meets the individual contribution requirement.</p>
      </div>}
    </div>;
    if (step === 2) return <div className="space-y-4">
      <p className="text-[11px] text-slate-400">Combine different objective types. Add up to 20 objectives.</p>
      <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"><select value={objectiveKind} onChange={e => setObjectiveKind(e.target.value as ObjectiveKind)} className="admin-field">{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select><input value={objectiveTitle} onChange={e => setObjectiveTitle(e.target.value)} maxLength={160} placeholder="Objective instruction" className="admin-field" /><button type="button" onClick={addObjective} disabled={!objectiveTitle.trim() || objectives.length>=20} className="border border-emerald-400/30 px-3 py-2 text-xs text-emerald-300 disabled:opacity-40"><Plus size={14}/></button></div>
      {objectives.map((o,i) => { const k = kinds.find(x => x.value===o.kind)!; const Icon=k.icon; return <div key={o.id} className="grid gap-2 border border-white/10 bg-[#101a14] p-3 md:grid-cols-[minmax(0,1fr)_150px_auto]"><div className="flex min-w-0 items-start gap-3"><span className="pt-1 text-[10px] text-slate-500">{i+1}</span><Icon size={15} className="mt-0.5 text-slate-300"/><div className="min-w-0"><p className="text-xs text-slate-100">{o.title}</p><p className="text-[9px] text-slate-500">{k.label} · Required</p><p className="mt-1 text-[9px] text-emerald-300">{verificationSource(o.kind, o.scope)}</p></div></div><label className="admin-field-label">Completion scope<select value={o.scope} onChange={e => setObjectives(v => v.map(x => x.id===o.id ? { ...x, scope: e.target.value as Objective['scope'] } : x))} className="admin-field"><option value="individual">Individual</option><option value="team">Team</option><option value="both">Both</option></select></label><button type="button" onClick={() => setObjectives(v => v.filter(x => x.id!==o.id))} className="text-left text-[10px] text-red-300">Remove</button></div>; })}
      {!objectives.length && <p className="border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">No objectives added yet.</p>}
      <p className="text-[10px] text-slate-500">Automatic source matching applies only to the source shown above. Other objective evidence remains in the manual review queue. Raffle entries are not an automatic Expedition verification source.</p>
    </div>;
    if (step === 3) return <div className="grid gap-4 md:grid-cols-2">
      <label className="admin-field-label">Reward type<select value={rewardType} onChange={e => setRewardType(e.target.value)} className="admin-field"><option value="ZP">ZP</option><option value="ZAP">ZAP</option><option value="none">No reward</option></select></label>
      <label className="admin-field-label">Reward amount<input type="number" min="1" step="1" disabled={rewardType==='none'} value={rewardAmount} onChange={e => setRewardAmount(e.target.value)} className="admin-field disabled:opacity-40"/></label>
      {participation!=='solo' && <p className="text-[11px] leading-relaxed text-slate-500 md:col-span-2">Each eligible team member receives the full configured amount, not a shared pool. Rewards can be issued by an Admin after the Expedition is completed and eligibility is checked.</p>}
      {rewardType==='ZAP' && <p className="text-[11px] text-amber-300 md:col-span-2">ZAP rewards are issued only after the Expedition is completed, eligible players are checked, and an Admin confirms the separate reward-issue action.</p>}
    </div>;
    if (step === 4) return <div className="grid gap-4 md:grid-cols-2">
      <label className="admin-field-label">Starts (local time)<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="admin-field"/></label>
      <label className="admin-field-label">Ends (local time)<input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="admin-field"/></label>
      <div className="rounded border border-white/10 p-3 text-[11px] leading-relaxed text-slate-400 md:col-span-2"><p className="mb-2 font-bold text-emerald-300">Rules in the approved design</p><ul className="list-disc space-y-1 pl-4"><li>Team roster locks at start.</li><li>Shared objectives and individual contribution are checked.</li><li>Only eligible members receive rewards.</li><li>Pausing or cancelling preserves progress and issued rewards.</li></ul></div>
    </div>;
    return <div className="space-y-3 text-xs text-emerald-300">
      <div className="rounded border border-white/10 p-3"><p className="font-bold text-white">{title || 'Untitled Expedition'}</p><p className="mt-1 text-slate-400">{description || 'No description added.'}</p></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[['Category',category],['Access',access],['Participation',participation],['Reward',rewardType==='none'?'None':rewardAmount+' '+rewardType]].map(([k,v]) => <div key={k} className="border border-white/10 p-2"><p className="text-[9px] uppercase text-slate-500">{k}</p><p className="mt-1">{v}</p></div>)}</div>
      <p className="text-slate-400">{objectives.length} objectives · {startsAt ? new Date(startsAt).toLocaleString() : 'Start not set'} · {endsAt ? new Date(endsAt).toLocaleString() : 'End not set'}</p>
      {objectives.map((o,i) => <p key={o.id} className="border-l border-emerald-400/30 pl-2">{i+1}. {o.title} <span className="text-slate-500">({o.kind} · {o.scope})</span><span className="block text-[9px] text-emerald-300">{verificationSource(o.kind, o.scope)}</span></p>)}
      <p className="border border-amber-500/30 bg-amber-950/10 p-3 text-[10px] text-amber-200">Publishing makes this Expedition visible to players. It does not pay rewards immediately; after completion, an Admin must separately issue rewards to eligible players.</p>
    </div>;
  };

  const metrics = [
    ['Drafts', counts.drafts, Layers],
    ['Live / registration', counts.live, Clock3],
    ['Pending reviews', counts.pendingReviews, ShieldCheck],
    ['Expeditions', counts.expeditions, CalendarDays],
  ] as const;

  return <section className="space-y-4">
    <style>{'.admin-field{display:block;width:100%;margin-top:6px;background:#020503;border:1px solid rgba(80,255,150,.25);padding:10px;color:#d1fae5;font-size:12px;outline:none}.admin-field:focus{border-color:rgba(80,255,150,.7)}.admin-field-label{display:block;font-size:11px;color:#70d99b}'}</style>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map(([label,value,Icon]) => <div key={label} className="border border-white/10 bg-[#101a14] p-3"><Icon size={16} className="mb-2 text-slate-400"/><p className="text-xl font-bold text-slate-100">{value}</p><p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3"><div><h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-300"><Compass size={15}/> Expedition Command</h2><p className="mt-1 text-[10px] text-slate-500">Create and publish Expeditions, review player evidence, then issue eligible rewards after completion.</p></div>{!creating && <button type="button" onClick={() => {reset();setCreating(true);}} className="flex items-center gap-2 border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-slate-100"><Plus size={14}/> Create Expedition</button>}</div>
    {savedMessage && <p role={savedMessageKind === 'error' ? 'alert' : 'status'} aria-live="polite" className={'border-l-2 px-3 py-3 text-xs ' + (savedMessageKind === 'success' ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-200' : savedMessageKind === 'error' ? 'border-red-400/60 bg-red-400/10 text-red-200' : 'border-sky-400/50 bg-sky-400/10 text-sky-200')}>{savedMessage}</p>}
    {creating && <div className="space-y-4 border border-white/10 bg-[#0b120e] p-3 sm:p-5">
      <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] uppercase tracking-widest text-slate-400">Expedition Builder</p><h3 className="mt-1 text-sm font-bold text-slate-100">Step {step+1}: {steps[step]}</h3></div><button type="button" onClick={() => setCreating(false)} className="text-[10px] text-slate-500">Close</button></div>
      <div className="grid grid-cols-6 gap-1">{steps.map((name,i) => <button key={name} type="button" onClick={() => setStep(i)} title={name} className={'h-1.5 '+(i<=step?'bg-emerald-400':'bg-emerald-400/10')}/>)}</div>
      {content()}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3"><button type="button" disabled={step===0} onClick={() => setStep(v => Math.max(0,v-1))} className="flex items-center gap-1 border border-white/10 px-3 py-2 text-xs text-slate-400 disabled:opacity-30"><ChevronLeft size={14}/> Back</button>{step<5 ? <button type="button" onClick={() => setStep(v => Math.min(5,v+1))} className="flex items-center gap-1 border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-slate-100">Continue <ChevronRight size={14}/></button> : <button type="button" onClick={saveDraft} disabled={saving} className="flex items-center gap-2 border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-slate-100 disabled:opacity-40"><Save size={14}/> {saving ? 'Saving…' : 'Save database draft'}</button>}</div>
      {!validDates && <p role="alert" className="text-[10px] text-red-300">The end date must be after the start date.</p>}{!validReward && <p role="alert" className="text-[10px] text-red-300">Enter a whole-number reward greater than zero, or select No reward.</p>}
    </div>}
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Saved Expeditions</h3><button type="button" onClick={() => void loadDrafts()} disabled={loadingDrafts} className="border border-white/10 px-2 py-1 text-[10px] text-slate-300 disabled:opacity-40">Refresh</button></div>
      {loadingDrafts ? <p className="border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">Loading saved Expeditions…</p> : drafts.length===0 ? <div className="border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">No Expeditions have been saved yet.</div> : drafts.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#101a14] p-3">
        <div className="min-w-0"><p className="text-xs text-slate-100">{d.title}</p><p className="mt-1 text-[9px] text-slate-500">{d.category.replace(/_/g,' ')} · {d.participation_mode} · {d.objectives.length} objectives</p><p className="mt-1 text-[9px] uppercase tracking-wider text-slate-400">{d.status.replace(/_/g,' ')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] text-slate-300">{d.reward?.amount ? d.reward.amount+' '+d.reward.reward_type.toUpperCase() : 'No reward'}</span>
          {d.status==='draft' && <><button type="button" onClick={() => editDraft(d)} className="border border-white/10 px-2 py-1 text-[10px] text-emerald-300">Edit</button><button type="button" onClick={() => duplicateExpedition(d)} className="flex items-center gap-1 border border-white/10 px-2 py-1 text-[10px] text-slate-200"><Copy size={11}/> Duplicate</button><button type="button" disabled={deletingId !== null} onClick={() => void deleteDraft(d)} className="flex items-center gap-1 border border-red-400/30 px-2 py-1 text-[10px] text-red-200 disabled:opacity-40"><Trash2 size={11}/>{deletingId === d.id ? 'Deleting…' : 'Delete'}</button><button type="button" disabled={publishingId===d.id} onClick={() => void publishDraft(d)} className="border border-amber-400/40 px-2 py-1 text-[10px] text-amber-200 disabled:opacity-40">{publishingId===d.id?'Publishing…':'Publish'}</button></>}
          {['scheduled','registration_open'].includes(d.status) && d.starts_at && new Date(d.starts_at) > new Date() && <><button type="button" onClick={() => beginReschedule(d)} className="flex items-center gap-1 border border-sky-400/30 px-2 py-1 text-[10px] text-sky-200"><CalendarClock size={11}/> Reschedule</button><button type="button" onClick={() => duplicateExpedition(d)} className="flex items-center gap-1 border border-white/10 px-2 py-1 text-[10px] text-slate-200"><Copy size={11}/> Duplicate</button></>}
          {d.status==='completed' && d.reward && d.reward.reward_type!=='none' && <button type="button" disabled={issuingRewardsId===d.id || !!issuingRewardsId} onClick={() => void issueRewards(d)} className="border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200 disabled:opacity-40">{issuingRewardsId===d.id ? 'Issuing…' : 'Issue eligible rewards'}</button>}
          {!['draft','scheduled','registration_open'].includes(d.status) && <button type="button" onClick={() => duplicateExpedition(d)} className="flex items-center gap-1 border border-white/10 px-2 py-1 text-[10px] text-slate-200"><Copy size={11}/> Duplicate</button>}
        </div>
        {reschedulingId===d.id && <div className="mt-3 grid w-full gap-2 border-t border-white/10 pt-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <label className="admin-field-label">New start<input type="datetime-local" value={rescheduleStart} onChange={e=>setRescheduleStart(e.target.value)} className="admin-field"/></label>
          <label className="admin-field-label">New end<input type="datetime-local" value={rescheduleEnd} onChange={e=>setRescheduleEnd(e.target.value)} className="admin-field"/></label>
          <button type="button" disabled={publishingId===d.id} onClick={()=>void submitReschedule(d)} className="self-end border border-sky-400/40 px-3 py-2 text-[10px] text-sky-200 disabled:opacity-40">{publishingId===d.id?'Saving…':'Save dates'}</button>
          <button type="button" onClick={()=>setReschedulingId(null)} className="self-end border border-white/10 px-3 py-2 text-[10px] text-slate-300">Cancel</button>
        </div>}
      </div>)}
    </div>
    <section className="space-y-3 border border-white/10 bg-[#101a14] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Objective verification queue</h3><p className="mt-1 text-[10px] text-slate-500">Review player and team evidence that needs an admin decision.</p></div>
        <button type="button" onClick={() => void loadReviews()} disabled={loadingReviews} className="border border-white/10 px-2 py-1 text-[10px] text-slate-300 disabled:opacity-40">{loadingReviews ? 'Refreshing…' : 'Refresh queue'}</button>
      </div>
      {reviewMessage && <p role="status" className="border-l-2 border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-[10px] text-emerald-300">{reviewMessage}</p>}
      {loadingReviews ? <p className="p-4 text-center text-xs text-slate-500">Loading review submissions…</p> : (
        <>
          {(['individual','team'] as const).map(scope => {
            const items = scope === 'individual' ? reviewQueue.individualSubmissions : reviewQueue.teamSubmissions;
            return <div key={scope} className="space-y-2">
              <div className="flex items-center justify-between border-b border-white/10 pb-1"><h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{scope === 'individual' ? 'Individual submissions' : 'Team submissions'}</h4><span className="text-[10px] text-slate-500">{items.length} pending</span></div>
              {items.length === 0 ? <p className="border border-dashed border-white/10 p-3 text-[10px] text-slate-500">No pending {scope} reviews.</p> : items.map(item => {
                const key = scope + ':' + item.id;
                return <article key={key} className="space-y-2 border border-white/10 bg-[#0b120e] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="text-xs text-slate-100">{item.expedition_objectives?.title ?? 'Expedition objective'}</p><p className="mt-1 text-[9px] text-slate-500">{item.expedition_objectives?.objective_type ?? 'objective'} · {scope} · submitted {new Date(item.created_at).toLocaleString()}</p><p className="mt-1 text-[9px] text-emerald-300">{item.expeditions?.title ?? 'Expedition'}</p><p className="mt-1 break-all text-[9px] text-slate-400">{scope === 'team' ? 'Team: ' + (item.expedition_teams?.name ?? item.team_id ?? 'Unknown') : 'Player ID: ' + (item.player_id ?? 'Unknown')}</p></div>
                    <span className="border border-amber-400/30 px-2 py-1 text-[9px] text-amber-200">Pending review</span>
                  </div>
                  <details className="text-[10px] text-slate-400"><summary className="cursor-pointer">View submitted evidence</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-white/10 bg-[#0b120e] p-2 text-[9px] text-emerald-300">{JSON.stringify(item.evidence ?? {}, null, 2)}</pre></details>
                  <label className="admin-field-label">Review reason (required for rejection)<input value={reviewReasons[key] ?? ''} onChange={e => setReviewReasons(v => ({ ...v, [key]: e.target.value }))} maxLength={500} placeholder="Explain the decision…" className="admin-field"/></label>
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
      <p className="text-[9px] leading-relaxed text-slate-500">Verifying evidence updates Expedition completion and eligibility only. It does not issue ZP/ZAP or change player balances.</p>
    </section>
    <p className="text-[10px] leading-relaxed text-slate-500">Existing expedition records are preserved. Publishing an Expedition makes it visible to players; reward issuance remains a separate, explicit Admin action after completion.</p>
  </section>;
}
