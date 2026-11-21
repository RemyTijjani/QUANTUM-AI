import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  CheckCircle2,
  Compass,
  LockKeyhole,
  RefreshCw,
  Send,
} from 'lucide-react';

type Objective = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  instructions: string | null;
  required: boolean;
  completionScope: 'individual' | 'team' | 'both';
  order: number;
  progress?: {
    individual?: { id: string; status: string; evidence: Record<string, unknown>; updated_at: string; reviewReason?: string | null } | null;
    team?: { id: string; status: string; evidence: Record<string, unknown>; updated_at: string; reviewReason?: string | null } | null;
  };
};

type TeamMember = { playerId: string; role: string; joinedAt: string };
type Team = {
  id: string;
  expedition_id: string;
  name: string;
  leader_player_id: string;
  status: string;
  members: TeamMember[];
};

type Participation = {
  status: string;
  teamId: string | null;
  individualContributionCount: number;
  rewardEligible: boolean;
  registeredAt: string;
  completedAt: string | null;
};

type Expedition = {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  category: string;
  access_mode: 'open' | 'progressive';
  participation_mode: 'solo' | 'team' | 'both';
  status: 'scheduled' | 'registration_open' | 'active' | 'completed';
  starts_at: string | null;
  ends_at: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  timezone: string;
  min_team_size: number;
  max_team_size: number;
  min_individual_contributions: number;
  objectives: Objective[];
  reward: { type: 'zp' | 'zap' | 'none'; amount: number; recipientScope: string };
  myParticipation: Participation | null;
  myRewardIssuance: { type: 'zp' | 'zap'; amount: number; status: 'pending' | 'issued' | 'failed' | 'voided'; issuedAt: string | null } | null;
  isUnlocked: boolean;
  lockedReason: string | null;
  canJoinSolo: boolean;
  myTeam: Team | null;
};

type Filter = 'all' | 'available' | 'joined' | 'locked';

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/player-expeditions`;

async function callExpeditionApi<T>(method: 'GET' | 'POST', payload?: Record<string, unknown>): Promise<T> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) throw new Error('Your session has expired. Reopen the Mini App from Telegram.');

  const response = await fetch(functionUrl, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('The Expedition service returned an unreadable response.');
  }

  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : 'The Expedition request failed. Please try again.';
    throw new Error(message);
  }

  return body as T;
}

function dateLabel(value: string | null, timezone: string) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function rewardLabel(reward: Expedition['reward']) {
  if (!reward || reward.type === 'none' || reward.amount <= 0) return 'No reward configured';
  return `+${reward.amount.toLocaleString()} ${reward.type.toUpperCase()}`;
}

function statusLabel(expedition: Expedition) {
  if (expedition.myParticipation) return expedition.myParticipation.status.replace(/_/g, ' ');
  if (!expedition.isUnlocked) return 'Locked';
  if (expedition.status === 'active') return 'In progress';
  if (expedition.status === 'registration_open') return 'Registration open';
  return 'Scheduled';
}

function journeyGuide(expedition: Expedition) {
  if (expedition.status === 'completed') {
    return { step: 3, heading: 'Expedition completed', detail: 'Review your final progress and reward status.' };
  }
  if (expedition.status === 'active') {
    return expedition.myParticipation
      ? { step: 2, heading: 'Your Expedition is live', detail: 'Open your objectives, submit evidence, and follow review progress.' }
      : { step: 2, heading: 'Expedition is live', detail: 'Registration is closed. You can view the objectives but cannot join now.' };
  }
  if (expedition.myParticipation) {
    return { step: 1, heading: 'You are registered', detail: 'Your place is saved. Return when the start time arrives to take part.' };
  }
  if (!expedition.isUnlocked) {
    return { step: 0, heading: 'Complete the prerequisite', detail: expedition.lockedReason || 'This Expedition is not unlocked for your account yet.' };
  }
  if (expedition.status === 'registration_open') {
    return { step: 0, heading: 'Registration is open', detail: 'Choose solo participation or register a team before the deadline.' };
  }
  return { step: 0, heading: 'Coming soon', detail: expedition.registrationOpensAt
    ? `Registration opens ${dateLabel(expedition.registrationOpensAt, expedition.timezone)}.`
    : 'Check the start and registration dates. Registration is not open yet.' };
}

export default function ExpeditionsScreen() {
  const [expeditions, setExpeditions] = useState<Expedition[]>([]);
  const [rewardHistory, setRewardHistory] = useState<Expedition[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [activePage, setActivePage] = useState<'overview' | 'registration' | 'tasks' | 'team' | 'results'>('overview');
  const [activeObjectiveIndex, setActiveObjectiveIndex] = useState<Record<string, number>>({});
  const [selectedExpeditionId, setSelectedExpeditionId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<Record<string, string>>({});
  const [inviteCode, setInviteCode] = useState<Record<string, string>>({});
  const [createdInvite, setCreatedInvite] = useState<Record<string, string>>({});
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await callExpeditionApi<{ expeditions: Expedition[]; rewardHistory?: Expedition[] }>('GET');
      setExpeditions(Array.isArray(result.expeditions) ? result.expeditions : []);
      setRewardHistory(Array.isArray(result.rewardHistory) ? result.rewardHistory : []);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load Expeditions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => ({
    all: expeditions.length,
    available: expeditions.filter((item) => item.isUnlocked && item.status === 'registration_open' && !item.myParticipation).length,
    joined: expeditions.filter((item) => !!item.myParticipation).length,
    locked: expeditions.filter((item) => !item.isUnlocked).length,
  }), [expeditions]);

  const visible = expeditions.filter((item) => {
    if (selectedExpeditionId && item.id !== selectedExpeditionId) return false;
    if (filter === 'available') return item.isUnlocked && item.status === 'registration_open' && !item.myParticipation;
    if (filter === 'joined') return !!item.myParticipation;
    if (filter === 'locked') return !item.isUnlocked;
    return true;
  });

  const perform = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setSuccessMessage('');
    try {
      await action();
      await load(true);
    } catch (requestError) {
      setSuccessMessage('');
      setError(requestError instanceof Error ? requestError.message : 'The action could not be completed.');
    } finally {
      setBusyId(null);
    }
  };

  const joinSolo = (item: Expedition) => perform(item.id, async () => {
    await callExpeditionApi('POST', { action: 'join', expeditionId: item.id });
  });

  const createTeam = (item: Expedition) => perform(item.id, async () => {
    const name = (teamName[item.id] ?? '').trim();
    if (!name) throw new Error('Enter a team name first.');
    const result = await callExpeditionApi<{ team?: Record<string, unknown> }>('POST', {
      action: 'create_team', expeditionId: item.id, teamName: name,
    });
    const team = result.team ?? {};
    const code = String(team.invite_code ?? team.inviteCode ?? '');
    if (code) setCreatedInvite((current) => ({ ...current, [item.id]: code }));
    setTeamName((current) => ({ ...current, [item.id]: '' }));
  });

  const joinTeam = (item: Expedition) => perform(item.id, async () => {
    const code = (inviteCode[item.id] ?? '').trim();
    if (!code) throw new Error('Enter the 16-character team invitation code.');
    await callExpeditionApi('POST', { action: 'join_team', inviteCode: code });
    setInviteCode((current) => ({ ...current, [item.id]: '' }));
  });

  const submitObjective = (item: Expedition, objective: Objective, scope: 'individual' | 'team') => perform(item.id, async () => {
    const key = `${item.id}:${objective.id}:${scope}`;
    const evidenceText = (evidenceDrafts[key] ?? '').trim();
    if (!evidenceText) throw new Error('Add a link or a short note describing your completed objective.');
    await callExpeditionApi('POST', {
      action: 'submit_objective',
      expeditionId: item.id,
      objectiveId: objective.id,
      scope,
      evidence: { text: evidenceText },
    });
    setEvidenceDrafts((current) => ({ ...current, [key]: '' }));
    setSuccessMessage('Your evidence is waiting for the operations team to review it.');
  });

  const leaveTeam = (item: Expedition) => {
    if (!window.confirm('Leave this Expedition team? You can only leave before registration closes or the Expedition starts.')) return;
    return perform(item.id, async () => {
      await callExpeditionApi('POST', { action: 'leave_team', expeditionId: item.id });
      setActivePage('overview');
      setCreatedInvite((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    });
  };

  const copyInvite = async (code: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setCopiedInvite(code);
      setError('');
    } catch {
      // Telegram and some embedded webviews block the Clipboard API.
      // Fall back to the legacy copy command while the temporary field is focused.
      try {
        const field = document.createElement('textarea');
        field.value = code;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        field.style.pointerEvents = 'none';
        document.body.appendChild(field);
        field.focus();
        field.select();
        field.setSelectionRange(0, field.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(field);
        if (!copied) throw new Error('Fallback copy failed');
        setCopiedInvite(code);
        setError('');
      } catch {
        setCopiedInvite(null);
        setError('Could not copy automatically. Tap and hold the invitation code to copy it.');
      }
    }
  };

  return (
    <section className="space-y-3">
      <div className="panel min-w-0 space-y-3 border border-neon/25 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/30 bg-neon/10 text-neon-300"><Compass size={18} /></span>
            <div><p className="label">Special operations</p><h2 className="title mt-1">Expeditions</h2></div>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} aria-label="Refresh Expeditions" className="rounded-lg border border-neon/20 p-2 text-neon-400 disabled:opacity-40">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-neon-500">Join solo or assemble a squad. Objectives and eligibility are checked by ZORD’s trusted services — team leaders cannot approve their own progress.</p>
        <div className="grid grid-cols-1 min-[380px]:grid-cols-3 gap-2">
          <div className="rounded-lg border border-neon/15 bg-black/30 p-2"><p className="label">Available</p><p className="mt-1 font-display text-lg text-neon-200">{counts.available}</p></div>
          <div className="rounded-lg border border-neon/15 bg-black/30 p-2"><p className="label">Joined</p><p className="mt-1 font-display text-lg text-cyan-200">{counts.joined}</p></div>
          <div className="rounded-lg border border-neon/15 bg-black/30 p-2"><p className="label">Locked</p><p className="mt-1 font-display text-lg text-amber-200">{counts.locked}</p></div>
        </div>
      </div>

      {selectedExpeditionId && <button type="button" onClick={() => { setSelectedExpeditionId(null); setActivePage('overview'); setActiveObjectiveIndex({}); }} className="inline-flex items-center gap-2 rounded-lg border border-neon/20 px-3 py-2 font-mono text-[10px] text-neon-300 hover:bg-neon/10">← Back to Expeditions</button>}

      {!selectedExpeditionId && <div className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-neon/15 bg-black/30 p-1">
        {(['all', 'available', 'joined', 'locked'] as Filter[]).map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-11 min-w-[76px] flex-1 rounded-lg px-2 py-2 font-mono text-[8px] uppercase tracking-wide transition ${filter === value ? 'bg-neon/15 text-neon-200' : 'text-neon-600 hover:text-neon-400'}`}>
            {value} <span className="opacity-60">{counts[value]}</span>
          </button>
        ))}
      </div>}

      {error && <div role="alert" className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 font-mono text-[10px] text-amber-200">{error}</div>}
      {successMessage && <div role="status" aria-live="polite" className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3 font-mono text-[10px] leading-relaxed text-emerald-200">{successMessage}</div>}

      {loading ? (
        <div className="panel flex items-center justify-center gap-2 p-8 font-mono text-[10px] text-neon-500"><RefreshCw size={14} className="animate-spin" /> Loading live Expeditions…</div>
      ) : visible.length === 0 ? (
        <div className="panel space-y-2 p-7 text-center">
          <Compass size={28} className="mx-auto text-neon-700" />
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-neon-300">{filter === 'joined' ? 'No joined Expeditions' : filter === 'locked' ? 'No locked Expeditions' : filter === 'available' ? 'No Expeditions open for registration' : 'No published Expeditions yet'}</h3>
          <p className="font-mono text-[9px] leading-relaxed text-neon-700">{filter === 'joined' ? 'When you register or join a squad, your operations will appear here.' : filter === 'available' ? 'There are no unlocked Expeditions accepting registrations right now. Check back when a registration window opens.' : filter === 'locked' ? 'Locked Expeditions will appear here when they have prerequisites you have not completed yet.' : 'New Expeditions appear here after the operations team publishes them.'}</p>
          <button type="button" onClick={() => void load(true)} className="btn-ghost mx-auto"><RefreshCw size={12} /> Refresh list</button>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const joined = !!item.myParticipation;
            const hasTeam = !!item.myTeam;
            const canUseTeams = item.participation_mode === 'team' || item.participation_mode === 'both';
            const busy = busyId === item.id;
            const guide = journeyGuide(item);
            const objectiveIndex = Math.min(activeObjectiveIndex[item.id] ?? 0, Math.max(0, item.objectives.length - 1));
            const activeObjective = item.objectives[objectiveIndex] ?? null;
            const objectivePosition = objectiveIndex;
            const rosterLocked = item.status === 'active' || (!!item.starts_at && new Date(item.starts_at).getTime() <= Date.now());
            return (
              <article key={item.id} className="panel min-w-0 space-y-3 overflow-hidden p-3 sm:p-4">
                {item.cover_image_url && <img src={item.cover_image_url} alt="" className="h-32 w-full rounded-lg object-cover" loading="lazy" />}
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-neon/20 px-2 py-1 font-mono text-[8px] uppercase text-neon-500">{item.category}</span>
                      <span className={`rounded-full border px-2 py-1 font-mono text-[8px] uppercase ${joined ? 'border-cyan-400/30 text-cyan-200' : item.isUnlocked ? 'border-emerald-400/25 text-emerald-300' : 'border-amber-400/25 text-amber-300'}`}>{statusLabel(item)}</span>
                    </div>
                    <h3 className="mt-2 break-words font-display text-sm font-bold uppercase tracking-wide text-neon-200">{item.title}</h3>
                  </div>
                  <div className="min-w-0 shrink-0 text-left sm:text-right"><p className="break-words font-display text-sm text-cyan-200">{rewardLabel(item.reward)}</p><p className="mt-1 font-mono text-[8px] text-neon-700">{item.reward?.recipientScope === 'each_eligible_team_member' ? 'Per eligible team member' : 'Per eligible participant'}</p></div>
                </div>
                {item.description && <p className="font-mono text-[10px] leading-relaxed text-neon-500">{item.description}</p>}
                <div className="space-y-2 rounded-lg border border-neon/15 bg-black/30 p-3">
                  <div>
                    <p className="font-mono text-[9px] font-bold text-neon-200">{guide.heading}</p>
                    <p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-500">{guide.detail}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5" aria-label="Expedition journey progress">
                    {['Register', 'Take part', 'Results'].map((label, index) => (
                      <div key={label} className={`rounded-md border px-2 py-2 text-center ${guide.step > index ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-200' : guide.step === index ? 'border-cyan-400/30 bg-cyan-400/5 text-cyan-200' : 'border-neon/10 text-neon-700'}`}>
                        <span className="block font-mono text-[8px]">{index + 1}. {label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[9px]">
                  <div className="rounded-lg border border-neon/10 bg-black/25 p-2"><p className="label">Starts</p><p className="mt-1 break-words font-mono text-neon-400">{dateLabel(item.starts_at, item.timezone)}</p></div>
                  <div className="rounded-lg border border-neon/10 bg-black/25 p-2"><p className="label">Ends</p><p className="mt-1 font-mono break-words font-mono text-neon-400">{dateLabel(item.ends_at, item.timezone)}</p></div>
                  <div className="rounded-lg border border-neon/10 bg-black/25 p-2"><p className="label">Registration opens</p><p className="mt-1 font-mono break-words font-mono text-neon-400">{dateLabel(item.registrationOpensAt, item.timezone)}</p></div>
                  <div className="rounded-lg border border-neon/10 bg-black/25 p-2"><p className="label">Registration closes</p><p className="mt-1 font-mono break-words font-mono text-neon-400">{dateLabel(item.registrationClosesAt, item.timezone)}</p></div>
                </div>
                {!joined && item.status === 'active' && <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 font-mono text-[9px] leading-relaxed text-amber-200">This Expedition has already started, so new registrations are closed. You can still read its objectives and details.</p>}
                {!joined && item.status === 'scheduled' && <p className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 font-mono text-[9px] leading-relaxed text-cyan-200">Registration is not open yet. Come back when the registration window begins.</p>}
                {joined && item.status !== 'completed' && <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 font-mono text-[9px] leading-relaxed text-emerald-200">You are on the participant list. When the scheduled start arrives, return here to follow the live objectives. No second registration is needed.</p>}
                {item.myParticipation && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-2 font-mono text-[9px] text-cyan-200"><CheckCircle2 size={13} /> Registered · {item.myParticipation.individualContributionCount} individual contributions · {item.myParticipation.rewardEligible ? 'Reward eligible' : 'Eligibility in progress'}</div>}
                {item.myParticipation && item.reward.type !== 'none' && item.status === 'completed' && <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 font-mono text-[9px] ${item.myRewardIssuance?.status === 'issued' ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200' : item.myRewardIssuance?.status === 'voided' ? 'border-red-400/25 bg-red-400/5 text-red-200' : 'border-amber-400/25 bg-amber-400/5 text-amber-200'}`}>
                  {item.myRewardIssuance?.status === 'issued'
                    ? <><CheckCircle2 size={13} /> Reward paid: {item.myRewardIssuance.amount} {item.myRewardIssuance.type.toUpperCase()}</>
                    : item.myRewardIssuance?.status === 'voided'
                      ? <>Reward not issued — eligibility was not met at final verification.</>
                      : item.myRewardIssuance?.status === 'pending'
                        ? <>Reward approved for processing: {item.myRewardIssuance.amount} {item.myRewardIssuance.type.toUpperCase()}.</>
                        : item.myParticipation.rewardEligible
                          ? <>Eligible for {item.reward.amount} {item.reward.type.toUpperCase()} — awaiting Admin payment processing.</>
                          : <>Reward eligibility has not been confirmed.</>}
                </div>}

                {!selectedExpeditionId ? (
                  <button type="button" onClick={() => { setSelectedExpeditionId(item.id); setActivePage('overview'); setActiveObjectiveIndex((current) => ({ ...current, [item.id]: 0 })); }} className="btn-primary w-full py-3 text-[10px]">View Expedition details →</button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex min-w-0 gap-1 overflow-x-auto pb-1" aria-label="Expedition steps">
                      {([
                        { id: 'overview', label: 'Overview' },
                        { id: 'registration', label: 'Register' },
                        { id: 'tasks', label: 'Tasks' },
                        ...(hasTeam ? [{ id: 'team' as const, label: 'Team' }] : []),
                        { id: 'results', label: 'Results' },
                      ] as const).map((step, index) => {
                        const active = activePage === step.id;
                        const complete = step.id === 'overview' || (step.id === 'registration' && (joined || !item.isUnlocked || item.status !== 'registration_open')) || (step.id === 'tasks' && item.status === 'completed');
                        return (
                          <button key={step.id} type="button" onClick={() => {
                            if (step.id === 'registration' && (joined || !item.isUnlocked || item.status !== 'registration_open')) return;
                            if (step.id === 'tasks' && (!joined || item.status !== 'active')) return;
                            if (step.id === 'results' && item.status !== 'completed') return;
                            if (step.id === 'team' && !hasTeam) return;
                            setActivePage(step.id);
                          }} disabled={(step.id === 'registration' && (joined || !item.isUnlocked || item.status !== 'registration_open')) || (step.id === 'tasks' && (!joined || item.status !== 'active')) || (step.id === 'team' && !hasTeam) || (step.id === 'results' && item.status !== 'completed')}
                            className={`min-h-11 min-w-[88px] flex-1 rounded-lg border px-2 py-2 font-mono text-[9px] transition ${active ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : complete ? 'border-emerald-400/20 text-emerald-300' : 'border-neon/10 text-neon-700'} disabled:cursor-not-allowed disabled:opacity-60`}>
                            <span className="block">{index + 1}. {step.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {activePage === 'overview' && (
                      <div className="space-y-3 rounded-xl border border-neon/15 bg-black/25 p-3">
                        <div>
                          <p className="label">Step 1 · Expedition overview</p>
                          <h4 className="mt-1 font-display text-xs font-bold uppercase text-neon-200">{item.title}</h4>
                          <p className="mt-2 font-mono text-[9px] leading-relaxed text-neon-500">{item.description || 'Review the schedule, participation rules and reward before continuing.'}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-neon/10 bg-black/30 p-2"><p className="label">Participation</p><p className="mt-1 font-mono text-[9px] text-neon-300">{item.participation_mode === 'both' ? 'Solo or team' : item.participation_mode}</p></div>
                          <div className="rounded-lg border border-neon/10 bg-black/30 p-2"><p className="label">Reward</p><p className="mt-1 font-mono text-[9px] text-cyan-200">{rewardLabel(item.reward)}</p></div>
                          <div className="rounded-lg border border-neon/10 bg-black/30 p-2"><p className="label">Starts</p><p className="mt-1 font-mono text-[9px] text-neon-300">{dateLabel(item.starts_at, item.timezone)}</p></div>
                          <div className="rounded-lg border border-neon/10 bg-black/30 p-2"><p className="label">Ends</p><p className="mt-1 font-mono text-[9px] text-neon-300">{dateLabel(item.ends_at, item.timezone)}</p></div>
                        </div>
                        <div className="rounded-lg border border-neon/10 bg-black/30 p-3">
                          <p className="label">What you need to do</p>
                          <ol className="mt-2 list-inside list-decimal space-y-1 font-mono text-[9px] leading-relaxed text-neon-500">
                            <li>Register before the registration deadline.</li>
                            <li>Complete each objective and submit evidence where requested.</li>
                            <li>Wait for verification and check your final reward status.</li>
                          </ol>
                        </div>
                        {joined ? (
                          <div className="space-y-2">
                            <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 font-mono text-[9px] text-emerald-200"><CheckCircle2 size={13} className="mr-1 inline" /> You are registered. {item.status === 'active' ? 'The Expedition is live.' : item.status === 'completed' ? 'The Expedition has ended.' : 'Your place is saved until the start time.'}</p>
                            <div className="grid grid-cols-2 gap-2">
                              {hasTeam && <button type="button" onClick={() => setActivePage('team')} className="btn-ghost py-3 text-[9px]">View my team</button>}
                              {item.status === 'active' && <button type="button" onClick={() => { setActiveObjectiveIndex((current) => ({ ...current, [item.id]: 0 })); setActivePage('tasks'); }} className="btn-primary py-3 text-[9px]">Go to tasks →</button>}
                              {item.status === 'completed' && <button type="button" onClick={() => setActivePage('results')} className="btn-primary py-3 text-[9px]">View results →</button>}
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setActivePage('registration')} disabled={!item.isUnlocked || item.status !== 'registration_open'} className="btn-primary w-full py-3 text-[10px] disabled:opacity-40">
                            {!item.isUnlocked ? 'Complete prerequisite first' : item.status !== 'registration_open' ? 'Registration is not open' : 'Continue to registration →'}
                          </button>
                        )}
                      </div>
                    )}

                    {activePage === 'registration' && (
                      <div className="space-y-3 rounded-xl border border-neon/15 bg-black/25 p-3">
                        <div>
                          <p className="label">Step 2 · Registration</p>
                          <h4 className="mt-1 font-display text-xs font-bold uppercase text-neon-200">Choose how to participate</h4>
                          <p className="mt-1 font-mono text-[9px] leading-relaxed text-neon-500">Register once. Your place will be saved for the scheduled start. Follow the instructions below to join solo or with a team.</p>
                        </div>
                        {!joined && !item.isUnlocked && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] text-amber-200"><LockKeyhole size={13} className="mr-1 inline" /> {item.lockedReason || 'Complete the prerequisite first.'}</p>}
                        {!joined && item.isUnlocked && item.status === 'registration_open' && item.canJoinSolo && item.participation_mode !== 'team' && (
                          <div className="space-y-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
                            <p className="font-mono text-[10px] font-bold text-cyan-200">Option A · Join solo</p>
                            <p className="font-mono text-[9px] leading-relaxed text-neon-500">Take part as an individual. Your own verified contributions determine your eligibility.</p>
                            <button type="button" disabled={busy} onClick={() => void joinSolo(item)} className="btn-primary w-full py-3 text-[9px] disabled:opacity-40">{busy ? 'Registering…' : 'Register as an individual'}</button>
                          </div>
                        )}
                        {!joined && item.isUnlocked && item.status === 'registration_open' && canUseTeams && (
                          <div className="space-y-3 rounded-lg border border-neon/15 bg-black/30 p-3">
                            <p className="font-mono text-[10px] font-bold text-neon-200">Option B · Join a team</p>
                            <p className="font-mono text-[9px] leading-relaxed text-neon-500">Create a team and invite members, or enter an invitation code from your team leader.</p>
                            <div className="space-y-2">
                              <label className="block space-y-1"><span className="label">Create a team</span><input value={teamName[item.id] ?? ''} onChange={(event) => setTeamName((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={80} placeholder="Enter team name" className="w-full rounded-lg border border-neon/20 bg-black/50 px-3 py-3 font-mono text-[10px] text-neon-200 outline-none focus:border-neon/50" /></label>
                              <button type="button" disabled={busy || !(teamName[item.id] ?? '').trim()} onClick={() => void createTeam(item)} className="btn-ghost w-full py-3 text-[9px] disabled:opacity-40">{busy ? 'Creating…' : 'Create team & register'}</button>
                            </div>
                            <div className="border-t border-neon/10 pt-3">
                              <label className="block space-y-1"><span className="label">Join an existing team</span><input value={inviteCode[item.id] ?? ''} onChange={(event) => setInviteCode((current) => ({ ...current, [item.id]: event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 16) }))} maxLength={16} placeholder="16-character invitation code" className="w-full rounded-lg border border-neon/20 bg-black/50 px-3 py-3 font-mono text-[10px] uppercase tracking-widest text-neon-200 outline-none focus:border-neon/50" /></label>
                              <button type="button" disabled={busy || (inviteCode[item.id] ?? '').length !== 16} onClick={() => void joinTeam(item)} className="btn-ghost mt-2 w-full py-3 text-[9px] disabled:opacity-40">{busy ? 'Joining…' : 'Join team with code'}</button>
                            </div>
                          </div>
                        )}
                        {joined && <div className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"><p className="font-mono text-[9px] text-emerald-200"><CheckCircle2 size={13} className="mr-1 inline" /> Registration complete. Your place is saved.</p><button type="button" onClick={() => setActivePage(hasTeam ? 'team' : item.status === 'active' ? 'tasks' : 'overview')} className="btn-primary w-full py-3 text-[9px]">{hasTeam ? 'View my team →' : item.status === 'active' ? 'Go to tasks →' : 'Back to overview'}</button></div>}
                        {createdInvite[item.id] && <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"><p className="font-mono text-[9px] text-emerald-200">Your team is registered. Share this invitation code:</p><div className="mt-2 flex gap-2"><input readOnly value={createdInvite[item.id]} onFocus={(event) => event.currentTarget.select()} aria-label="Team invitation code" className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/50 px-2 py-2 font-mono text-[10px] tracking-widest text-neon-200" /><button type="button" onClick={() => void copyInvite(createdInvite[item.id])} className="rounded-lg border border-neon/25 px-3 py-2 font-mono text-[9px] text-neon-300">{copiedInvite === createdInvite[item.id] ? 'Copied' : 'Copy code'}</button></div></div>}
                        <button type="button" onClick={() => setActivePage('overview')} className="btn-ghost w-full py-2 text-[9px]">← Back to overview</button>
                      </div>
                    )}

                    {activePage === 'tasks' && (
                      <div className="space-y-3 rounded-xl border border-neon/15 bg-black/25 p-3">
                        <div>
                          <p className="label">Step 3 · Live Expedition tasks</p>
                          <h4 className="mt-1 font-display text-xs font-bold uppercase text-neon-200">Complete one objective at a time</h4>
                          <p className="mt-1 font-mono text-[9px] text-neon-500">Use Previous and Next to move through the objectives. Your submissions and review status are saved by ZORD.</p>
                        </div>
                        {!joined || item.status !== 'active' ? (
                          <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] text-amber-200">Your tasks will appear here when you are registered and the Expedition is live.</p>
                        ) : item.objectives.length === 0 ? (
                          <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] text-amber-200">Objectives are being configured. Please check again later.</p>
                        ) : activeObjective ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2"><span className="font-mono text-[9px] uppercase text-cyan-200">Task {objectivePosition + 1} of {item.objectives.length}</span><span className="font-mono text-[8px] uppercase text-neon-600">{activeObjective.required ? 'Required' : 'Optional'}</span></div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-neon/10"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${((objectivePosition + 1) / item.objectives.length) * 100}%` }} /></div>
                            <article className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                              <div><h5 className="break-words font-display text-sm font-bold uppercase text-cyan-100">{activeObjective.title}</h5><p className="mt-1 font-mono text-[8px] uppercase text-cyan-500">{activeObjective.type.replace(/_/g, ' ')} · {activeObjective.completionScope} completion</p></div>
                              {activeObjective.description && <p className="font-mono text-[10px] leading-relaxed text-neon-400">{activeObjective.description}</p>}
                              {activeObjective.instructions && <div className="rounded-lg border border-neon/10 bg-black/30 p-3"><p className="label">How to complete this task</p><p className="mt-2 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-neon-300">{activeObjective.instructions}</p></div>}
                              {activeObjective.completionScope === 'team' && !hasTeam && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] leading-relaxed text-amber-200">This objective requires an Expedition team. Your current registration is individual, so contact the operations team for guidance.</p>}
                              {([
                                ...(activeObjective.completionScope === 'individual' || activeObjective.completionScope === 'both' ? [{ scope: 'individual' as const, progress: activeObjective.progress?.individual ?? null, label: 'Your submission' }] : []),
                                ...(hasTeam && (activeObjective.completionScope === 'team' || activeObjective.completionScope === 'both') ? [{ scope: 'team' as const, progress: activeObjective.progress?.team ?? null, label: 'Team submission' }] : []),
                              ]).map(({ scope, progress, label }) => {
                                const key = `${item.id}:${activeObjective.id}:${scope}`;
                                const status = progress?.status ?? 'not_submitted';
                                const verified = status === 'verified';
                                const pending = status === 'submitted';
                                return <div key={scope} className="space-y-2 rounded-lg border border-neon/15 bg-black/30 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-[9px] text-neon-300">{label}</p><span className={`rounded-full border px-2 py-1 font-mono text-[8px] uppercase ${verified ? 'border-emerald-400/30 text-emerald-300' : pending ? 'border-amber-400/30 text-amber-200' : status === 'rejected' ? 'border-red-400/30 text-red-300' : 'border-neon/20 text-neon-600'}`}>{status === 'not_submitted' ? 'Not submitted' : status}</span></div>
                                  {progress?.reviewReason && status === 'rejected' && <p className="rounded border border-red-400/20 bg-red-400/5 p-2 font-mono text-[9px] text-red-200">Admin feedback: {progress.reviewReason}</p>}
                                  {!verified && !pending && <div className="space-y-2"><textarea value={evidenceDrafts[key] ?? ''} onChange={(event) => setEvidenceDrafts((current) => ({ ...current, [key]: event.target.value }))} maxLength={3500} rows={3} placeholder="Paste a link or explain what you completed…" className="w-full rounded-lg border border-neon/20 bg-black/50 px-3 py-3 font-mono text-[10px] text-neon-200 outline-none focus:border-neon/50" /><button type="button" disabled={busy || !(evidenceDrafts[key] ?? '').trim()} onClick={() => void submitObjective(item, activeObjective, scope)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-3 font-mono text-[9px] uppercase text-cyan-200 disabled:opacity-40"><Send size={12} /> {busy ? 'Submitting…' : status === 'rejected' ? 'Resubmit evidence' : 'Submit evidence'}</button></div>}
                                  {pending && <p className="font-mono text-[9px] text-amber-200">Submitted. Waiting for the operations team to review your evidence.</p>}
                                  {verified && <p className="font-mono text-[9px] text-emerald-300"><CheckCircle2 size={12} className="mr-1 inline" /> This objective is verified.</p>}
                                </div>;
                              })}
                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neon/10 pt-3"><button type="button" disabled={objectivePosition === 0} onClick={() => setActiveObjectiveIndex((current) => ({ ...current, [item.id]: Math.max(0, objectivePosition - 1) }))} className="btn-ghost px-4 py-2 text-[9px] disabled:opacity-30">← Previous task</button><button type="button" disabled={objectivePosition >= item.objectives.length - 1} onClick={() => setActiveObjectiveIndex((current) => ({ ...current, [item.id]: Math.min(item.objectives.length - 1, objectivePosition + 1) }))} className="btn-primary px-4 py-2 text-[9px] disabled:opacity-30">Next task →</button></div>
                            </article>
                          </div>
                        ) : null}
                        <button type="button" onClick={() => setActivePage(hasTeam ? 'team' : 'overview')} className="btn-ghost w-full py-2 text-[9px]">{hasTeam ? 'View my team' : '← Back to overview'}</button>
                      </div>
                    )}

                    {activePage === 'team' && (
                      <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                        <div><p className="label">Your team</p><h4 className="mt-1 font-display text-xs font-bold uppercase text-cyan-100">{item.myTeam?.name ?? 'Team information'}</h4></div>
                        {hasTeam ? (
                          <>
                            <p className="font-mono text-[9px] text-neon-400">{item.myTeam?.members.length ?? 0} member(s) · {rosterLocked ? 'Roster locked' : 'Roster locks when the Expedition starts'}.</p>
                            <div className="space-y-2 rounded-lg border border-neon/10 bg-black/30 p-3">
                              <p className="label">Team roster</p>
                              {(item.myTeam?.members ?? []).length > 0 ? item.myTeam!.members.map((member) => (
                                <div key={member.playerId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-neon/10 pb-2 last:border-0 last:pb-0">
                                  <span className="min-w-0 break-all font-mono text-[9px] text-neon-300">Player {member.playerId.slice(0, 8)}…</span>
                                  <span className="shrink-0 rounded-full border border-cyan-400/20 px-2 py-1 font-mono text-[8px] uppercase text-cyan-200">{member.role.replace(/_/g, ' ')}</span>
                                </div>
                              )) : <p className="font-mono text-[9px] text-neon-600">No active members are listed yet.</p>}
                            </div>
                            {createdInvite[item.id] && <div className="flex gap-2"><input readOnly value={createdInvite[item.id]} aria-label="Team invitation code" onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/50 px-2 py-2 font-mono text-[10px] tracking-widest text-neon-200" /><button type="button" onClick={() => void copyInvite(createdInvite[item.id])} className="rounded-lg border border-neon/25 px-3 py-2 font-mono text-[9px] text-neon-300">{copiedInvite === createdInvite[item.id] ? 'Copied' : 'Copy code'}</button></div>}
                            {rosterLocked ? <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] text-amber-200"><LockKeyhole size={12} className="mr-1 inline" /> Team membership is locked for this Expedition. Members cannot join or leave now.</p> : <button type="button" disabled={busy} onClick={() => void leaveTeam(item)} className="w-full rounded-lg border border-red-400/25 px-3 py-3 font-mono text-[9px] uppercase text-red-300 disabled:opacity-40">{busy ? 'Leaving…' : 'Leave team'}</button>}
                          </>
                        ) : <p className="font-mono text-[9px] text-neon-500">You are registered as an individual participant.</p>}
                        <button type="button" onClick={() => setActivePage(item.status === 'active' ? 'tasks' : 'overview')} className="btn-ghost w-full py-2 text-[9px]">← Back to Expedition</button>
                      </div>
                    )}

                    {activePage === 'results' && (
                      <div className="space-y-3 rounded-xl border border-neon/15 bg-black/25 p-3">
                        <div><p className="label">Step 4 · Results</p><h4 className="mt-1 font-display text-xs font-bold uppercase text-neon-200">Expedition results</h4></div>
                        {item.status !== 'completed' ? <p className="font-mono text-[9px] text-neon-500">Final results will appear here after the Expedition ends.</p> : (
                          <>
                            <div className="rounded-lg border border-neon/10 bg-black/30 p-3"><p className="label">Your contributions</p><p className="mt-1 font-display text-lg text-cyan-200">{item.myParticipation?.individualContributionCount ?? 0}</p><p className="font-mono text-[8px] text-neon-600">Verified individual contributions</p></div>
                            <div className="rounded-lg border border-neon/10 bg-black/30 p-3"><p className="label">Reward eligibility</p><p className="mt-1 font-mono text-[10px] text-neon-300">{item.myParticipation?.rewardEligible ? 'Eligible' : 'Not eligible'}</p></div>
                            {item.myRewardIssuance?.status === 'issued' ? <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 font-mono text-[10px] text-emerald-200"><CheckCircle2 size={13} className="mr-1 inline" /> Reward paid: {item.myRewardIssuance.amount} {item.myRewardIssuance.type.toUpperCase()}.</p> : item.myRewardIssuance?.status === 'pending' ? <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] text-amber-200">Your reward is approved and awaiting Admin processing.</p> : item.myRewardIssuance?.status === 'voided' ? <p className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 font-mono text-[9px] text-red-200">A reward was not issued because final eligibility requirements were not met.</p> : <p className="rounded-lg border border-neon/10 bg-black/30 p-3 font-mono text-[9px] text-neon-500">{item.myParticipation?.rewardEligible ? 'You are eligible. Reward processing has not yet been recorded.' : 'Your final reward eligibility was not confirmed.'}</p>}
                          </>
                        )}
                        <button type="button" onClick={() => setActivePage('overview')} className="btn-ghost w-full py-2 text-[9px]">← Back to overview</button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {rewardHistory.length > 0 && (
        <section className="panel space-y-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div><p className="label">Completed operations</p><h3 className="mt-1 font-display text-xs font-bold uppercase tracking-wide text-neon-200">Reward History</h3></div>
            <span className="font-mono text-[9px] text-neon-500">{rewardHistory.length} record{rewardHistory.length === 1 ? '' : 's'}</span>
          </div>
          <div className="space-y-2">
            {rewardHistory.map((item) => {
              const issuance = item.myRewardIssuance;
              const rewardText = issuance
                ? `${issuance.amount.toLocaleString()} ${issuance.type.toUpperCase()}`
                : rewardLabel(item.reward);
              const statusText = issuance?.status === 'issued'
                ? 'Reward paid'
                : issuance?.status === 'voided'
                  ? 'Not eligible for payout'
                  : issuance?.status === 'pending'
                    ? 'Awaiting processing'
                    : item.myParticipation?.rewardEligible
                      ? 'Eligible · awaiting Admin'
                      : 'Participation recorded';
              return (
                <article key={item.id} className="rounded-lg border border-neon/15 bg-black/30 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><h4 className="break-words font-display text-[11px] font-bold text-neon-200">{item.title}</h4><p className="mt-1 font-mono text-[8px] text-neon-600">Ended {dateLabel(item.ends_at, item.timezone)}</p></div>
                    <span className="font-mono text-[9px] text-cyan-200">{rewardText}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-neon/10 pt-2">
                    <span className="font-mono text-[9px] text-neon-400">{statusText}</span>
                    <span className="font-mono text-[8px] text-neon-700">{item.myParticipation?.individualContributionCount ?? 0} contributions</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <p className="px-2 text-center font-mono text-[8px] leading-relaxed text-neon-800">Expedition rewards are not issued by this screen. Eligibility is calculated by trusted verification services and reward issuance remains controlled by the server.</p>
    </section>
  );
}
