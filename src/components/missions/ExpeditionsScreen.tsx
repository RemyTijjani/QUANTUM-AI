import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users,
  UserRound,
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

export default function ExpeditionsScreen() {
  const [expeditions, setExpeditions] = useState<Expedition[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
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
      const result = await callExpeditionApi<{ expeditions: Expedition[] }>('GET');
      setExpeditions(Array.isArray(result.expeditions) ? result.expeditions : []);
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
    available: expeditions.filter((item) => item.isUnlocked && !item.myParticipation).length,
    joined: expeditions.filter((item) => !!item.myParticipation).length,
    locked: expeditions.filter((item) => !item.isUnlocked).length,
  }), [expeditions]);

  const visible = expeditions.filter((item) => {
    if (filter === 'available') return item.isUnlocked && !item.myParticipation;
    if (filter === 'joined') return !!item.myParticipation;
    if (filter === 'locked') return !item.isUnlocked;
    return true;
  });

  const perform = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
      await load(true);
    } catch (requestError) {
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
  });

  const leaveTeam = (item: Expedition) => {
    if (!window.confirm('Leave this Expedition team? You can only leave before registration closes or the Expedition starts.')) return;
    return perform(item.id, async () => {
      await callExpeditionApi('POST', { action: 'leave_team', expeditionId: item.id });
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
      <div className="panel space-y-3 border border-neon/25 bg-gradient-to-br from-neon/10 via-black/50 to-cyan-500/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/30 bg-neon/10 text-neon-300"><Compass size={18} /></span>
            <div><p className="label">Special operations</p><h2 className="title mt-1">Expeditions</h2></div>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} aria-label="Refresh Expeditions" className="rounded-lg border border-neon/20 p-2 text-neon-400 disabled:opacity-40">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-neon-500">Join solo or assemble a squad. Objectives and eligibility are checked by ZORD’s trusted services — team leaders cannot approve their own progress.</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-neon/15 bg-black/30 p-2"><p className="label">Available</p><p className="mt-1 font-display text-lg text-neon-200">{counts.available}</p></div>
          <div className="rounded-lg border border-neon/15 bg-black/30 p-2"><p className="label">Joined</p><p className="mt-1 font-display text-lg text-cyan-200">{counts.joined}</p></div>
          <div className="rounded-lg border border-neon/15 bg-black/30 p-2"><p className="label">Locked</p><p className="mt-1 font-display text-lg text-amber-200">{counts.locked}</p></div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-neon/15 bg-black/30 p-1">
        {(['all', 'available', 'joined', 'locked'] as Filter[]).map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`flex-1 rounded-lg px-2 py-2 font-mono text-[8px] uppercase tracking-wide transition ${filter === value ? 'bg-neon/15 text-neon-200' : 'text-neon-600 hover:text-neon-400'}`}>
            {value} <span className="opacity-60">{counts[value]}</span>
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 font-mono text-[10px] text-amber-200">{error}</div>}

      {loading ? (
        <div className="panel flex items-center justify-center gap-2 p-8 font-mono text-[10px] text-neon-500"><RefreshCw size={14} className="animate-spin" /> Loading live Expeditions…</div>
      ) : visible.length === 0 ? (
        <div className="panel space-y-2 p-7 text-center">
          <Compass size={28} className="mx-auto text-neon-700" />
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-neon-300">{filter === 'joined' ? 'No joined Expeditions' : filter === 'locked' ? 'No locked Expeditions' : 'No published Expeditions yet'}</h3>
          <p className="font-mono text-[9px] leading-relaxed text-neon-700">{filter === 'joined' ? 'When you register or join a squad, your operations will appear here.' : 'New Expeditions appear here after the operations team opens registration.'}</p>
          <button type="button" onClick={() => void load(true)} className="btn-ghost mx-auto"><RefreshCw size={12} /> Refresh list</button>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const isOpen = expanded === item.id;
            const joined = !!item.myParticipation;
            const hasTeam = !!item.myTeam;
            const canUseTeams = item.participation_mode === 'team' || item.participation_mode === 'both';
            const busy = busyId === item.id;
            const rosterLocked = item.status === 'active' || (!!item.starts_at && new Date(item.starts_at).getTime() <= Date.now());
            return (
              <article key={item.id} className="panel space-y-3 overflow-hidden p-4">
                {item.cover_image_url && <img src={item.cover_image_url} alt="" className="h-32 w-full rounded-lg object-cover" loading="lazy" />}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-neon/20 px-2 py-1 font-mono text-[8px] uppercase text-neon-500">{item.category}</span>
                      <span className={`rounded-full border px-2 py-1 font-mono text-[8px] uppercase ${joined ? 'border-cyan-400/30 text-cyan-200' : item.isUnlocked ? 'border-emerald-400/25 text-emerald-300' : 'border-amber-400/25 text-amber-300'}`}>{statusLabel(item)}</span>
                    </div>
                    <h3 className="mt-2 font-display text-sm font-bold uppercase tracking-wide text-neon-200">{item.title}</h3>
                  </div>
                  <div className="shrink-0 text-right"><p className="font-display text-sm text-cyan-200">{rewardLabel(item.reward)}</p><p className="mt-1 font-mono text-[8px] text-neon-700">{item.reward?.recipientScope === 'each_eligible_team_member' ? 'Per eligible team member' : 'Per eligible participant'}</p></div>
                </div>
                {item.description && <p className="font-mono text-[10px] leading-relaxed text-neon-500">{item.description}</p>}
                <div className="grid grid-cols-2 gap-2 text-[9px]">
                  <div className="rounded-lg border border-neon/10 bg-black/25 p-2"><p className="label">Starts</p><p className="mt-1 font-mono text-neon-400">{dateLabel(item.starts_at, item.timezone)}</p></div>
                  <div className="rounded-lg border border-neon/10 bg-black/25 p-2"><p className="label">Ends</p><p className="mt-1 font-mono text-neon-400">{dateLabel(item.ends_at, item.timezone)}</p></div>
                </div>
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
                <button type="button" onClick={() => setExpanded(isOpen ? null : item.id)} aria-expanded={isOpen} className="flex w-full items-center justify-between border-t border-neon/10 pt-3 font-mono text-[9px] uppercase text-neon-500 hover:text-neon-300">
                  <span>{isOpen ? 'Hide objectives & actions' : `View ${item.objectives.length} objectives & actions`}</span>{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {isOpen && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <p className="label">Mission objectives</p>
                      {item.objectives.length === 0 ? <p className="font-mono text-[9px] text-amber-300">Objectives are being configured.</p> : item.objectives.map((objective) => (
                        <div key={objective.id} className="rounded-lg border border-neon/15 bg-black/30 p-3">
                          <div className="flex items-start justify-between gap-2"><p className="font-mono text-[10px] font-bold text-neon-300">{objective.title}</p><span className="shrink-0 font-mono text-[8px] uppercase text-neon-700">{objective.required ? 'Required' : 'Optional'}</span></div>
                          <p className="mt-1 font-mono text-[8px] uppercase text-cyan-500">{objective.type.replace(/_/g, ' ')} · {objective.completionScope} completion</p>
                          {objective.description && <p className="mt-2 font-mono text-[9px] leading-relaxed text-neon-600">{objective.description}</p>}
                          {objective.instructions && <p className="mt-2 whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-neon-500">{objective.instructions}</p>}
                          {joined && item.status === 'active' && ([
                            ...(objective.completionScope === 'individual' || objective.completionScope === 'both' ? [{ scope: 'individual' as const, progress: objective.progress?.individual ?? null, label: 'Your individual submission' }] : []),
                            ...(hasTeam && (objective.completionScope === 'team' || objective.completionScope === 'both') ? [{ scope: 'team' as const, progress: objective.progress?.team ?? null, label: 'Team submission' }] : []),
                          ]).map(({ scope, progress, label }) => {
                            const key = `${item.id}:${objective.id}:${scope}`;
                            const status = progress?.status ?? 'not_submitted';
                            const verified = status === 'verified';
                            const pending = status === 'submitted';
                            return <div key={scope} className="mt-3 space-y-2 rounded-lg border border-neon/15 bg-black/30 p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-mono text-[9px] text-neon-300">{label}</p>
                                <span className={`rounded-full border px-2 py-1 font-mono text-[8px] uppercase ${verified ? 'border-emerald-400/30 text-emerald-300' : pending ? 'border-amber-400/30 text-amber-200' : status === 'rejected' ? 'border-red-400/30 text-red-300' : 'border-neon/20 text-neon-600'}`}>{status === 'not_submitted' ? 'Not submitted' : status}</span>
                              </div>
                              {progress?.reviewReason && status === 'rejected' && <p className="rounded border border-red-400/20 bg-red-400/5 p-2 font-mono text-[9px] text-red-200">Admin feedback: {progress.reviewReason}</p>}
                              {!verified && !pending && <div className="space-y-2">
                                <textarea value={evidenceDrafts[key] ?? ''} onChange={(event) => setEvidenceDrafts((current) => ({ ...current, [key]: event.target.value }))} maxLength={3500} rows={2} placeholder="Paste a link or explain what you completed…" className="w-full rounded-lg border border-neon/20 bg-black/50 px-3 py-2 font-mono text-[9px] text-neon-200 outline-none focus:border-neon/50" />
                                <button type="button" disabled={busy || !(evidenceDrafts[key] ?? '').trim()} onClick={() => void submitObjective(item, objective, scope)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 font-mono text-[9px] uppercase text-cyan-200 disabled:opacity-40"><Send size={12} /> {busy ? 'Submitting…' : status === 'rejected' ? 'Resubmit evidence' : 'Submit evidence'}</button>
                              </div>}
                              {pending && <p className="font-mono text-[8px] text-amber-200">Your evidence is waiting for the operations team to review it.</p>}
                              {verified && <p className="font-mono text-[8px] text-emerald-300">This objective has been verified.</p>}
                            </div>;
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-neon/15 bg-black/25 p-3">
                      <p className="label">Participation rules</p>
                      <p className="mt-1 font-mono text-[9px] text-neon-500">{item.participation_mode === 'solo' ? 'Individual participation' : item.participation_mode === 'team' ? 'Team participation only' : 'Solo or team participation'} · {item.access_mode === 'progressive' ? 'Unlocks after prerequisite completion' : 'Open access'}</p>
                      {canUseTeams && <p className="mt-1 font-mono text-[9px] text-neon-600">Team size: {item.min_team_size}–{item.max_team_size} · Each member must meet the contribution minimum of {item.min_individual_contributions}. Team membership locks when the Expedition starts.</p>}
                    </div>

                    {!joined && !item.isUnlocked && <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 font-mono text-[9px] text-amber-200"><LockKeyhole size={14} />{item.lockedReason || 'Complete the prerequisite first.'}</div>}
                    {!joined && item.isUnlocked && item.canJoinSolo && item.participation_mode !== 'team' && (
                      <button type="button" disabled={busy} onClick={() => void joinSolo(item)} className="btn-primary w-full py-3 text-[10px] disabled:opacity-40">{busy ? 'Registering…' : 'Join Expedition'}</button>
                    )}
                    {!joined && item.isUnlocked && canUseTeams && (
                      <div className="space-y-2 rounded-lg border border-neon/15 bg-black/25 p-3">
                        <p className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase text-neon-300"><Users size={13} /> Team registration</p>
                        <label className="block space-y-1"><span className="label">Create a new team</span><input value={teamName[item.id] ?? ''} onChange={(event) => setTeamName((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={80} placeholder="Team name" className="w-full rounded-lg border border-neon/20 bg-black/50 px-3 py-2 font-mono text-[10px] text-neon-200 outline-none focus:border-neon/50" /></label>
                        <button type="button" disabled={busy || !(teamName[item.id] ?? '').trim()} onClick={() => void createTeam(item)} className="btn-ghost w-full py-2 text-[9px] disabled:opacity-40">{busy ? 'Creating…' : 'Create team & get invite code'}</button>
                        <div className="border-t border-neon/10 pt-2"><label className="block space-y-1"><span className="label">Or join with an invitation code</span><input value={inviteCode[item.id] ?? ''} onChange={(event) => setInviteCode((current) => ({ ...current, [item.id]: event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 16) }))} maxLength={16} placeholder="16-character code" className="w-full rounded-lg border border-neon/20 bg-black/50 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-neon-200 outline-none focus:border-neon/50" /></label><button type="button" disabled={busy || (inviteCode[item.id] ?? '').length !== 16} onClick={() => void joinTeam(item)} className="btn-ghost mt-2 w-full py-2 text-[9px] disabled:opacity-40">{busy ? 'Joining…' : 'Join team'}</button></div>
                      </div>
                    )}
                    {joined && hasTeam && (
                      <div className="space-y-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
                        <p className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase text-cyan-200"><Users size={13} /> {item.myTeam?.name ?? 'Your team'}</p>
                        <p className="font-mono text-[8px] text-neon-600">{item.myTeam?.members.length ?? 0} active member(s) · {rosterLocked ? 'Roster locked' : 'Roster locks when the Expedition starts'}</p>
                        {createdInvite[item.id] && <div className="space-y-1"><div className="flex items-center gap-2"><input readOnly value={createdInvite[item.id]} aria-label="Team invitation code" onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-neon/20 bg-black/50 px-2 py-2 font-mono text-[10px] tracking-widest text-neon-200" /><button type="button" onClick={() => void copyInvite(createdInvite[item.id])} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neon/25 px-3 py-2 text-neon-300 hover:bg-neon/10" aria-label="Copy team invite code" title="Copy invitation code">{copiedInvite === createdInvite[item.id] ? <><CheckCircle2 size={14} /><span className="font-mono text-[9px]">Copied</span></> : <><Copy size={14} /><span className="font-mono text-[9px]">Copy</span></>}</button></div><p className="font-mono text-[8px] text-neon-600">{copiedInvite === createdInvite[item.id] ? 'Invitation code copied. Share it with your teammates.' : 'Share this code with players you want to invite.'}</p></div>}
                        {rosterLocked ? <p className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 font-mono text-[9px] text-amber-200"><LockKeyhole size={12} /> Team membership is locked for this Expedition.</p> : <button type="button" disabled={busy} onClick={() => void leaveTeam(item)} className="w-full rounded-lg border border-red-400/25 px-3 py-2 font-mono text-[9px] uppercase text-red-300 disabled:opacity-40">{busy ? 'Leaving…' : 'Leave team'}</button>}
                      </div>
                    )}
                    {joined && !hasTeam && <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 font-mono text-[9px] text-cyan-200"><UserRound size={13} className="mr-1 inline" /> You are registered as an individual participant.</div>}
                    {item.status === 'active' && <p className="flex items-center gap-2 font-mono text-[8px] text-neon-700"><ShieldCheck size={12} /> Completion evidence is verified by operations or trusted server records.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="px-2 text-center font-mono text-[8px] leading-relaxed text-neon-800">Expedition rewards are not issued by this screen. Eligibility is calculated by trusted verification services and reward issuance remains controlled by the server.</p>
    </section>
  );
}
