
export interface AdminCredentials {
  username: string;
  password: string;
}

export interface AdminSubmission {
  id: string;
  mission_id: string;
  player_referral_code: string | null;
  link_url: string;
  platform: 'tiktok' | 'youtube';
  status: 'pending' | 'approved' | 'rejected';
  reward_zp: number;
  reviewed_at: string | null;
  created_at: string;
}

export interface AdminTask {
  id: string;
  kind: 'daily' | 'social' | 'creator';
  title: string;
  description: string;
  reward: number;
  platform: 'tiktok' | 'youtube' | null;
  actionUrl: string | null;
  telegramChatId: string | null;
  rewardCurrency: 'ZP' | 'ZAP';
  unlockCostZp: number;
  status: 'draft' | 'published' | 'paused' | 'archived';
  objectives: string[];
  requirements: string[];
}

export interface AdminTaskInput {
  id?: string;
  kind: AdminTask['kind'];
  title: string;
  description: string;
  reward: number;
  platform: AdminTask['platform'];
  actionUrl: string | null;
  telegramChatId: string | null;
  rewardCurrency: 'ZP' | 'ZAP';
  unlockCostZp: number;
  status: 'draft' | 'published' | 'paused' | 'archived';
  objectives: string[];
  requirements: string[];
}

export interface AdminStats {
  totalPlayers: number;
  totalSubmissions: number;
  pendingSubmissions: number;
  totalZp: number;
}

export interface AdminEvent {
  id: string;
  title: string;
  description: string;
  category: 'daily' | 'weekly' | 'monthly' | 'special';
  status: 'draft' | 'published' | 'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  reward_zp: number;
  reward_zap: number;
  min_participants: number | null;
  max_participants: number | null;
  objectives: unknown[];
  requirements: unknown[];
  participation_rules: string;
  created_at: string;
  updated_at: string;
}

export interface AdminEventInput {
  id?: string;
  title: string;
  description: string;
  category: AdminEvent['category'];
  status: AdminEvent['status'];
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  rewardZp: number;
  rewardZap: number;
  minParticipants: number | null;
  maxParticipants: number | null;
  objectives: unknown[];
  requirements: unknown[];
  participationRules: string;
}

export type AdminEventActivityType =
  | 'mission'
  | 'creator_submission_approved'
  | 'referral_registration'
  | 'telegram_membership'
  | 'gameplay_verification'
  | 'admin_review';

export interface AdminEventActivity {
  id: string;
  event_id: string;
  mission_id: string | null;
  activity_type: AdminEventActivityType;
  title: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  is_required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AdminEventActivityInput {
  id?: string;
  eventId: string;
  missionId: string | null;
  activityType: AdminEventActivityType;
  title: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  isRequired: boolean;
  sortOrder: number;
}

export type AdminEventParticipantStatus = 'registered' | 'in_progress' | 'completed' | 'submitted' | 'withdrawn';

export interface AdminEventParticipant {
  id: string;
  event_id: string;
  status: AdminEventParticipantStatus;
  registered_at: string;
  updated_at: string;
  completed_at: string | null;
  zp_reward_approved_at: string | null;
  zp_reward_approved_by: string | null;
  zp_reward_amount: number | string | null;
  event_ends_at: string | null;
  event_reward_zp: number | string;
  event_reward_zap: number | string;
  players: {
    telegram_id: number | string;
    username: string | null;
    first_name: string | null;
    referral_code: string;
  };
}

export interface AdminPlayerEconomy {
  player_id: string;
  zp_balance: number | string | null;
  lifetime_zp: number | string | null;
  pending_kickback: number | string | null;
  created_at: string | null;
  updated_at: string | null;
  last_accrued_at: string | null;
}

export interface AdminEconomyLedgerEntry {
  id: string;
  player_id: string;
  transaction_type: string;
  amount: number | string;
  balance_after: number | string;
  reference_id: string | null;
  description: string | null;
  created_at: string | null;
}

export interface AdminPlayerEconomyDetail {
  economy: AdminPlayerEconomy | null;
  ledger: AdminEconomyLedgerEntry[];
  ledgerLimit: number;
  zapBalanceAvailable: false;
}

export interface AdminPlayer {
  id: string;
  telegram_id: number | string;
  username: string | null;
  first_name: string | null;
  referral_code: string;
  created_at: string;
}


export interface AdminXFollowSubmission {
  id: string; player_id: string; x_username: string;
  status: 'pending' | 'approved' | 'rejected'; reward_zp: number; created_at: string;
  players?: { referral_code: string | null; username: string | null; first_name: string | null };
}

export interface AdminDashboardData {
  stats: AdminStats; vaultReserves: AdminVaultReserves;
  submissions: AdminSubmission[]; xFollowSubmissions: AdminXFollowSubmission[];
  tasks: AdminTask[]; events: AdminEvent[];
}

export interface AdminVaultReserves {
  tonReserve: number;
  zpReserve: number;
}

export interface ReviewResult {
  success: true;
  decision: 'approved' | 'rejected';
  rewardZp: number;
  playerReferralCode?: string | null;
  playerId?: string | null;
}

const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api`;

export class AdminApiError extends Error {}

async function callAdminApi(
  creds: AdminCredentials,
  payload: Record<string, unknown>,
): Promise<unknown> {
  let res: Response;

  try {
    res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        ...payload,
        adminUsername: creds.username,
        adminPassword: creds.password,
      }),
    });
  } catch {
    throw new AdminApiError(
      'Could not reach the admin service. Check your connection and try again.',
    );
  }

  let body: unknown = null;

  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const serverError = (body as { error?: unknown } | null)?.error;

    if (res.status === 401) {
      throw new AdminApiError('Invalid credentials. Access denied.');
    }

    throw new AdminApiError(
      typeof serverError === 'string'
        ? serverError
        : `Request failed (${res.status}).`,
    );
  }

  return body;
}

function isDashboardData(value: unknown): value is AdminDashboardData {
  if (!value || typeof value !== 'object') return false;

  const v = value as Partial<AdminDashboardData>;

  return (
    !!v.stats &&
    !!v.vaultReserves &&
    Array.isArray(v.submissions) &&
    Array.isArray(v.xFollowSubmissions) &&
    Array.isArray(v.tasks) &&
    Array.isArray(v.events)
  );
}

export async function fetchDashboard(
  creds: AdminCredentials,
): Promise<AdminDashboardData> {
  const body = await callAdminApi(creds, {
    action: 'fetch_dashboard',
  });

  if (!isDashboardData(body)) {
    throw new AdminApiError(
      'Received an unexpected response from the admin service.',
    );
  }

  return body;
}

export interface BulkApprovalResult {
  success: true;
  approvedCount: number;
  failedCount: number;
  results: Array<{ submissionId: string; success: boolean; rewardZp?: number; reason?: string }>;
}

export async function bulkApproveSubmissions(
  creds: AdminCredentials,
  submissionIds: string[],
): Promise<BulkApprovalResult> {
  const body = await callAdminApi(creds, {
    action: 'bulk_approve_submissions',
    submissionIds,
  });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The bulk approval response could not be verified.');
  }
  const result = body as Partial<BulkApprovalResult>;
  if (result.success !== true || !Number.isInteger(result.approvedCount) ||
      !Number.isInteger(result.failedCount) || !Array.isArray(result.results) ||
      result.results.some((item) => !item || typeof item.submissionId !== 'string' || typeof item.success !== 'boolean')) {
    throw new AdminApiError('The bulk approval response could not be verified. Refresh the queue and check submission statuses.');
  }
  return result as BulkApprovalResult;
}

export async function reviewSubmission(
  creds: AdminCredentials,
  submissionId: string,
  decision: 'approved' | 'rejected',
): Promise<ReviewResult> {
  const body = await callAdminApi(creds, {
    action: 'review_submission',
    submissionId,
    decision,
  });

  if (!body || typeof body !== 'object') {
    throw new AdminApiError(
      'The submission review response could not be verified. Refresh the dashboard and check its status.',
    );
  }

  const result = body as Partial<ReviewResult>;

  // Verify the actual database review result.
  // Referral code and player ID are optional display information.
  if (
    result.success !== true ||
    result.decision !== decision ||
    typeof result.rewardZp !== 'number' ||
    !Number.isFinite(result.rewardZp) ||
    result.rewardZp < 0
  ) {
    throw new AdminApiError(
      'The submission review could not be verified. Refresh the dashboard and check its status.',
    );
  }

  return {
    success: true,
    decision: result.decision,
    rewardZp: result.rewardZp,
    playerReferralCode:
      typeof result.playerReferralCode === 'string'
        ? result.playerReferralCode
        : null,
    playerId:
      typeof result.playerId === 'string'
        ? result.playerId
        : null,
  };
}

export async function saveTask(
  creds: AdminCredentials,
  task: AdminTaskInput,
): Promise<void> {
  await callAdminApi(creds, {
    action: 'save_task',
    task,
  });
}

export async function deleteTask(
  creds: AdminCredentials,
  taskId: string,
): Promise<void> {
  await callAdminApi(creds, {
    action: 'delete_task',
    taskId,
  });
}

export async function saveVaultReserves(
  creds: AdminCredentials,
  reserves: AdminVaultReserves,
): Promise<void> {
  await callAdminApi(creds, {
    action: 'save_vault_reserves',
    vaultReserves: reserves,
  });
}

export async function saveEvent(
  creds: AdminCredentials,
  event: AdminEventInput,
): Promise<void> {
  await callAdminApi(creds, {
    action: 'save_event',
    event,
  });
}

export async function deleteEvent(
  creds: AdminCredentials,
  eventId: string,
): Promise<void> {
  await callAdminApi(creds, {
    action: 'delete_event',
    eventId,
  });
}

export async function getPlayerEconomy(
  creds: AdminCredentials,
  playerId: string,
): Promise<AdminPlayerEconomyDetail> {
  const body = await callAdminApi(creds, {
    action: 'get_player_economy',
    playerId,
  });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('Received an unexpected player economy response.');
  }
  const result = body as Partial<AdminPlayerEconomyDetail>;
  if (
    !Array.isArray(result.ledger) ||
    result.ledgerLimit !== 50 ||
    result.zapBalanceAvailable !== false ||
    (result.economy !== null && typeof result.economy !== 'object')
  ) {
    throw new AdminApiError('Received an unexpected player economy response.');
  }
  return result as AdminPlayerEconomyDetail;
}

export async function listPlayers(
  creds: AdminCredentials,
  search = '',
): Promise<AdminPlayer[]> {
  const body = await callAdminApi(creds, {
    action: 'list_players',
    search,
  });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { players?: unknown }).players)) {
    throw new AdminApiError('Received an unexpected player list response.');
  }
  return (body as { players: AdminPlayer[] }).players;
}

export async function listEventParticipants(
  creds: AdminCredentials,
  eventId: string,
): Promise<AdminEventParticipant[]> {
  const body = await callAdminApi(creds, {
    action: 'list_event_participants',
    eventId,
  });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { participants?: unknown }).participants)) {
    throw new AdminApiError('Received an unexpected event participants response.');
  }
  return (body as { participants: AdminEventParticipant[] }).participants;
}


export async function listEventActivities(
  creds: AdminCredentials,
  eventId: string,
): Promise<AdminEventActivity[]> {
  const body = await callAdminApi(creds, { action: 'list_event_activities', eventId });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { activities?: unknown }).activities)) {
    throw new AdminApiError('Received an unexpected event activities response.');
  }
  return (body as { activities: AdminEventActivity[] }).activities;
}

export async function saveEventActivity(
  creds: AdminCredentials,
  activity: AdminEventActivityInput,
): Promise<void> {
  await callAdminApi(creds, { action: 'save_event_activity', activity });
}

export async function deleteEventActivity(
  creds: AdminCredentials,
  eventId: string,
  activityId: string,
): Promise<void> {
  await callAdminApi(creds, { action: 'delete_event_activity', eventId, activityId });
}

export async function updateEventParticipantStatus(
  creds: AdminCredentials,
  participationId: string,
  status: AdminEventParticipantStatus,
): Promise<void> {
  await callAdminApi(creds, {
    action: 'update_event_participant_status',
    participationId,
    participationStatus: status,
  });
}

export interface EventRewardApprovalResult {
  success: true;
  alreadyApproved: boolean;
  participationId?: string;
  playerId?: string;
  eventId?: string;
  rewardZp: number;
  balanceAfter?: number;
  approvedAt: string;
  approvedBy?: string;
  zapRewardIssued?: false;
  zapRewardDeferred?: boolean;
}

export async function approveEventParticipantReward(
  creds: AdminCredentials,
  participationId: string,
): Promise<EventRewardApprovalResult> {
  const body = await callAdminApi(creds, {
    action: 'approve_event_participant_reward',
    participationId,
  });
  if (!body || typeof body !== 'object' || (body as { success?: unknown }).success !== true) {
    throw new AdminApiError('Event reward approval returned an unexpected response.');
  }
  return body as EventRewardApprovalResult;
}


export interface AdminExpeditionDraftInput {
  id?: string;
  title: string;
  description: string;
  category: 'Open' | 'Progressive' | 'Seasonal' | 'Community' | 'Competitive' | 'Team' | 'Special limited-time';
  accessMode: 'open' | 'progressive';
  participationMode: 'solo' | 'team' | 'both';
  minTeamSize: number;
  maxTeamSize: number;
  minIndividualContributions: number;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  rewardType: 'zp' | 'zap' | 'none';
  rewardAmount: number;
  objectives: Array<{ kind: 'briefing' | 'quiz' | 'game' | 'community' | 'external' | 'milestone'; title: string; scope: 'individual' | 'team' | 'both' }>;
}

export async function saveExpeditionDraft(
  creds: AdminCredentials,
  expedition: AdminExpeditionDraftInput,
): Promise<{ id: string; slug: string }> {
  const body = await callAdminApi(creds, { action: 'save_expedition_draft', expeditionId: expedition.id, expedition });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The Expedition draft response could not be verified.');
  }
  const result = body as { success?: unknown; id?: unknown; slug?: unknown; status?: unknown };
  if (result.success !== true || typeof result.id !== 'string' || typeof result.slug !== 'string' || result.status !== 'draft') {
    throw new AdminApiError('The Expedition draft could not be verified. Refresh the admin page before retrying.');
  }
  return { id: result.id, slug: result.slug };
}


export interface AdminExpeditionRecord {
  id: string; slug: string; title: string; description: string; category: string;
  access_mode: 'open' | 'progressive'; participation_mode: 'solo' | 'team' | 'both';
  status: 'draft' | 'scheduled' | 'registration_open' | 'active' | 'paused' | 'completed' | 'closed' | 'cancelled';
  starts_at: string | null; ends_at: string | null; timezone: string;
  min_team_size: number; max_team_size: number; min_individual_contributions: number;
  objectives: Array<{ id: string; objective_type: AdminExpeditionDraftInput['objectives'][number]['kind']; title: string; completion_scope: 'individual' | 'team' | 'both'; sort_order: number }>;
  reward: { reward_type: 'zp' | 'zap' | 'none'; amount: number; recipient_scope: string } | null;
}
export interface AdminExpeditionRewardIssueResult {
  success: true;
  issuedCount: number;
  voidedCount: number;
  rewardType: 'zp' | 'zap';
  amountPerPlayer: number;
}
export async function issueAdminExpeditionRewards(
  creds: AdminCredentials, expeditionId: string,
): Promise<AdminExpeditionRewardIssueResult> {
  const body = await callAdminApi(creds, { action: 'issue_expedition_rewards', expeditionId });
  if (!body || typeof body !== 'object') throw new AdminApiError('The reward issuance response could not be verified.');
  const result = body as Partial<AdminExpeditionRewardIssueResult>;
  if (result.success !== true || !Number.isInteger(result.issuedCount) || !Number.isInteger(result.voidedCount)
      || !['zp', 'zap'].includes(String(result.rewardType)) || typeof result.amountPerPlayer !== 'number') {
    throw new AdminApiError('Reward issuance could not be verified. Refresh the Expedition before retrying.');
  }
  return result as AdminExpeditionRewardIssueResult;
}
export async function listAdminExpeditions(creds: AdminCredentials): Promise<AdminExpeditionRecord[]> {
  const body = await callAdminApi(creds, { action: 'list_expeditions' });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { expeditions?: unknown }).expeditions)) {
    throw new AdminApiError('Could not verify the saved Expeditions list.');
  }
  return (body as { expeditions: AdminExpeditionRecord[] }).expeditions;
}
export async function publishAdminExpedition(creds: AdminCredentials, id: string): Promise<{ status: 'scheduled' | 'registration_open' }> {
  const body = await callAdminApi(creds, { action: 'publish_expedition', expeditionId: id });
  if (!body || typeof body !== 'object') throw new AdminApiError('The publish response could not be verified.');
  const result = body as { success?: unknown; status?: unknown };
  if (result.success !== true || !['scheduled', 'registration_open'].includes(String(result.status))) {
    throw new AdminApiError('Expedition publishing could not be verified.');
  }
  return { status: result.status as 'scheduled' | 'registration_open' };
}
export async function rescheduleAdminExpedition(
  creds: AdminCredentials, id: string, startsAt: string, endsAt: string,
): Promise<void> {
  const body = await callAdminApi(creds, { action: 'reschedule_expedition', expeditionId: id, startsAt, endsAt });
  if (!body || typeof body !== 'object' || (body as { success?: unknown }).success !== true) {
    throw new AdminApiError('The Expedition schedule could not be verified.');
  }
}


export interface AdminExpeditionObjectiveReview {
  id: string;
  expedition_id: string;
  objective_id: string;
  player_id?: string;
  team_id?: string;
  status: 'submitted';
  evidence: Record<string, unknown>;
  created_at: string;
  expedition_objectives?: { title?: string; objective_type?: string; completion_scope?: string };
  expedition_teams?: { name?: string };
  expeditions?: { title?: string };
}
export async function listAdminExpeditionObjectiveReviews(creds: AdminCredentials, expeditionId?: string): Promise<{ individualSubmissions: AdminExpeditionObjectiveReview[]; teamSubmissions: AdminExpeditionObjectiveReview[] }> {
  const body = await callAdminApi(creds, { action: 'list_expedition_objective_reviews', expeditionId });
  if (!body || typeof body !== 'object') throw new AdminApiError('Could not load Expedition objective reviews.');
  const result = body as { success?: unknown; individualSubmissions?: unknown; teamSubmissions?: unknown };
  if (result.success !== true || !Array.isArray(result.individualSubmissions) || !Array.isArray(result.teamSubmissions)) {
    throw new AdminApiError('The Expedition review queue response could not be verified.');
  }
  return {
    individualSubmissions: result.individualSubmissions as AdminExpeditionObjectiveReview[],
    teamSubmissions: result.teamSubmissions as AdminExpeditionObjectiveReview[],
  };
}
export async function reviewAdminExpeditionObjective(
  creds: AdminCredentials,
  input: { progressId: string; progressScope: 'individual' | 'team'; decision: 'verified' | 'rejected'; reason: string },
): Promise<void> {
  const body = await callAdminApi(creds, {
    action: 'review_expedition_objective',
    progressId: input.progressId,
    progressScope: input.progressScope,
    objectiveDecision: input.decision,
    reviewReason: input.reason,
  });
  if (!body || typeof body !== 'object' || (body as { success?: unknown }).success !== true || (body as { rewardsIssued?: unknown }).rewardsIssued !== false) {
    throw new AdminApiError('The objective review could not be verified.');
  }
}


export interface AdminBriefingQuestionInput {
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}
export interface AdminBriefingInput {
  id?: string;
  title: string;
  summary: string;
  category: string;
  content: Array<{ type: 'text' | 'image' | 'video'; title?: string; body?: string; url?: string; caption?: string }>;
  accessMode: 'open' | 'progressive';
  prerequisiteBriefingId: string | null;
  passingScore: number;
  rewardType: 'none' | 'zp' | 'zap';
  rewardAmount: number;
  questions: AdminBriefingQuestionInput[];
}
export interface AdminBriefingRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  content: AdminBriefingInput['content'];
  status: 'draft' | 'published' | 'archived';
  access_mode: 'open' | 'progressive';
  prerequisite_briefing_id: string | null;
  passing_score: number;
  reward_type: 'none' | 'zp' | 'zap';
  reward_amount: number;
  published_at: string | null;
  questions: Array<{ id: string; prompt: string; options: string[]; correctOptionIndex: number; explanation: string }>;
}
export async function listAdminBriefings(creds: AdminCredentials): Promise<AdminBriefingRecord[]> {
  const body = await callAdminApi(creds, { action: 'list_briefings' });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { briefings?: unknown }).briefings)) {
    throw new AdminApiError('Could not load saved Intelligence Briefings.');
  }
  return (body as { briefings: AdminBriefingRecord[] }).briefings;
}
export async function saveAdminBriefing(creds: AdminCredentials, briefing: AdminBriefingInput): Promise<{ id: string }> {
  const body = await callAdminApi(creds, { action: 'save_briefing_draft', briefing });
  if (!body || typeof body !== 'object') throw new AdminApiError('The briefing draft response could not be verified.');
  const result = body as { success?: unknown; id?: unknown; status?: unknown };
  if (result.success !== true || typeof result.id !== 'string' || result.status !== 'draft') {
    throw new AdminApiError('The briefing draft could not be verified.');
  }
  return { id: result.id };
}
export async function publishAdminBriefing(creds: AdminCredentials, id: string): Promise<void> {
  const body = await callAdminApi(creds, { action: 'publish_briefing', briefingId: id });
  if (!body || typeof body !== 'object' || (body as { success?: unknown; status?: unknown }).success !== true ||
      (body as { status?: unknown }).status !== 'published') {
    throw new AdminApiError('Briefing publishing could not be verified.');
  }
}


export interface AdminExternalZapFundingRecord {
  id: string;
  amount: number | string;
  transaction_reference: string;
  verification_method: string;
  confirmed_by: string;
  confirmed_at: string;
}
export interface AdminExternalZapFundingSummary {
  availableReserve: number;
  updatedAt: string | null;
  funding: AdminExternalZapFundingRecord[];
}
export async function listExternalZapFunding(
  creds: AdminCredentials,
): Promise<AdminExternalZapFundingSummary> {
  const body = await callAdminApi(creds, { action: 'list_external_zap_funding' });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('Could not load external ZAP funding records.');
  }
  const result = body as Partial<AdminExternalZapFundingSummary>;
  if (typeof result.availableReserve !== 'number' || !Array.isArray(result.funding)) {
    throw new AdminApiError('The external ZAP funding response could not be verified.');
  }
  return result as AdminExternalZapFundingSummary;
}
export async function confirmExternalZapFunding(
  creds: AdminCredentials,
  input: { amount: number; transactionReference: string },
): Promise<{ fundingId: string; amount: number; transactionReference: string; confirmedBy: string; confirmedAt: string; availableReserve: number }> {
  const body = await callAdminApi(creds, {
    action: 'confirm_external_zap_funding',
    zapAmount: input.amount,
    transactionReference: input.transactionReference,
  });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The external ZAP funding confirmation could not be verified.');
  }
  const result = body as Record<string, unknown>;
  if (result.success !== true || typeof result.fundingId !== 'string' ||
      typeof result.availableReserve !== 'number' || typeof result.confirmedAt !== 'string') {
    throw new AdminApiError('The external ZAP funding confirmation could not be verified.');
  }
  return result as { fundingId: string; amount: number; transactionReference: string; confirmedBy: string; confirmedAt: string; availableReserve: number };
}


export interface AdminExternalTonFundingRecord {
  id: string;
  amount: number | string;
  transaction_reference: string;
  destination_wallet: string;
  verification_method: string;
  confirmed_by: string;
  confirmed_at: string;
}
export interface AdminExternalTonFundingSummary {
  walletAddress: string;
  availableReserve: number;
  updatedAt: string | null;
  funding: AdminExternalTonFundingRecord[];
}
export async function listExternalTonFunding(
  creds: AdminCredentials,
): Promise<AdminExternalTonFundingSummary> {
  const body = await callAdminApi(creds, { action: 'list_external_ton_funding' });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('Could not load external TON funding records.');
  }
  const result = body as Partial<AdminExternalTonFundingSummary>;
  if (typeof result.walletAddress !== 'string' || typeof result.availableReserve !== 'number' || !Array.isArray(result.funding)) {
    throw new AdminApiError('The external TON funding response could not be verified.');
  }
  return result as AdminExternalTonFundingSummary;
}
export async function confirmExternalTonFunding(
  creds: AdminCredentials,
  input: { amount: number; transactionReference: string },
): Promise<{ fundingId: string; amount: number; transactionReference: string; destinationWallet: string; confirmedBy: string; confirmedAt: string; availableReserve: number }> {
  const body = await callAdminApi(creds, {
    action: 'confirm_external_ton_funding',
    tonAmount: input.amount,
    transactionReference: input.transactionReference,
  });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The external TON funding confirmation could not be verified.');
  }
  const result = body as Record<string, unknown>;
  if (result.success !== true || typeof result.fundingId !== 'string' ||
      typeof result.availableReserve !== 'number' || typeof result.confirmedAt !== 'string' ||
      typeof result.destinationWallet !== 'string') {
    throw new AdminApiError('The external TON funding confirmation could not be verified.');
  }
  return result as { fundingId: string; amount: number; transactionReference: string; destinationWallet: string; confirmedBy: string; confirmedAt: string; availableReserve: number };
}


export interface AdminRaffleEntryRecord {
  id: string;
  raffle_id: string;
  player_id: string;
  stake_zap: number | string;
  ticket_count: number;
  created_at: string;
  players?: { username: string | null; first_name: string | null; telegram_id: number | string | null } | null;
}
export interface AdminRaffleWinnerRecord {
  id: string;
  raffle_id: string;
  player_id: string;
  prize_amount: number | string;
  prize_currency: 'TON' | 'ZAP';
  selection_method: 'random' | 'admin';
  selected_at: string;
  delivery_status: 'pending' | 'credited' | 'withdrawable' | 'delivered' | 'failed';
  players?: { username: string | null; first_name: string | null; telegram_id: number | string | null } | null;
}
export interface AdminRaffleRecord {
  id: string;
  title: string;
  description: string;
  reward_type: 'ton' | 'zap';
  reward_code: string | null;
  prize_pool_amount: number | string;
  prize_currency: 'TON' | 'ZAP';
  funding_source: 'treasury' | 'external';
  min_bet_zap: number | string;
  entry_mode: 'one_bet_one_entry' | 'proportional';
  winner_count: number;
  winner_method: 'random' | 'admin';
  status: 'draft' | 'published' | 'closed' | 'drawn' | 'settled' | 'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  closed_at?: string | null;
  created_at: string;
  entries?: AdminRaffleEntryRecord[];
  winners?: AdminRaffleWinnerRecord[];
}

export interface AdminRaffleDraftInput {
  id?: string;
  title: string;
  description: string;
  rewardType: 'ton' | 'zap';
  rewardCode: null;
  prizePoolAmount: number;
  fundingSource: 'treasury' | 'external';
  minBetZap: number;
  entryMode: 'one_bet_one_entry' | 'proportional';
  winnerCount: number;
  winnerMethod: 'random' | 'admin';
  startsAt: string | null;
  endsAt: string | null;
}

export async function listAdminRaffles(creds: AdminCredentials): Promise<AdminRaffleRecord[]> {
  const body = await callAdminApi(creds, { action: 'list_raffles' });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { raffles?: unknown }).raffles)) {
    throw new AdminApiError('Could not load the raffle list.');
  }
  return (body as { raffles: AdminRaffleRecord[] }).raffles;
}

export async function saveAdminRaffleDraft(creds: AdminCredentials, raffle: AdminRaffleDraftInput): Promise<AdminRaffleRecord> {
  const body = await callAdminApi(creds, { action: 'save_raffle_draft', raffle });
  if (!body || typeof body !== 'object') throw new AdminApiError('The raffle draft response could not be verified.');
  const result = body as { success?: unknown; raffle?: AdminRaffleRecord };
  if (result.success !== true || !result.raffle || typeof result.raffle.id !== 'string' || result.raffle.status !== 'draft') {
    throw new AdminApiError('The raffle draft could not be verified. Refresh the list before retrying.');
  }
  return result.raffle;
}


export interface AdminRafflePublishResult {
  success: true;
  status: 'published';
  publishedAt: string;
}

export async function publishAdminRaffle(
  creds: AdminCredentials,
  raffleId: string,
): Promise<AdminRafflePublishResult> {
  const body = await callAdminApi(creds, { action: 'publish_raffle', raffle: { id: raffleId } });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The publish response could not be verified.');
  }
  const result = body as Partial<AdminRafflePublishResult>;
  if (result.success !== true || result.status !== 'published' || typeof result.publishedAt !== 'string') {
    throw new AdminApiError('The server did not confirm that the raffle was published. Refresh the list before retrying.');
  }
  return result as AdminRafflePublishResult;
}

export interface AdminRaffleSelectionResult { success: true; raffleId: string; winnerCount: number; status: 'drawn' }
export async function selectAdminRaffleWinners(
  creds: AdminCredentials,
  raffleId: string,
  playerIds?: string[],
  prizeShares?: number[],
): Promise<AdminRaffleSelectionResult> {
  const body = await callAdminApi(creds, {
    action: 'select_raffle_winners',
    raffle: { id: raffleId },
    ...(playerIds ? { playerIds } : {}),
    ...(prizeShares ? { prizeShares } : {}),
  });
  if (!body || typeof body !== 'object') throw new AdminApiError('The winner selection response could not be verified.');
  const result = body as Partial<AdminRaffleSelectionResult>;
  if (result.success !== true || result.raffleId !== raffleId || result.status !== 'drawn' || !Number.isInteger(result.winnerCount)) {
    throw new AdminApiError('Winner selection could not be verified. Refresh the raffle before retrying.');
  }
  return result as AdminRaffleSelectionResult;
}
export async function creditAdminRaffleWinner(
  creds: AdminCredentials,
  winnerId: string,
): Promise<{ success: true; alreadyCredited: boolean; winnerId: string; deliveryStatus?: string }> {
  const body = await callAdminApi(creds, { action: 'credit_raffle_winner', winnerId });
  if (!body || typeof body !== 'object') throw new AdminApiError('The prize credit response could not be verified.');
  const result = body as { success?: unknown; alreadyCredited?: unknown; winnerId?: unknown; deliveryStatus?: unknown };
  if (result.success !== true || result.winnerId !== winnerId || typeof result.alreadyCredited !== 'boolean') {
    throw new AdminApiError('The ZAP prize credit could not be verified. Refresh the raffle before retrying.');
  }
  return result as { success: true; alreadyCredited: boolean; winnerId: string; deliveryStatus?: string };
}

export interface AdminRaffleCloseResult {
  success: true;
  status: 'closed';
  alreadyClosed: boolean;
  closedAt: string | null;
  earlyClose?: boolean;
}

export async function closeAdminRaffle(
  creds: AdminCredentials,
  raffleId: string,
): Promise<AdminRaffleCloseResult> {
  const body = await callAdminApi(creds, { action: 'close_raffle', raffle: { id: raffleId } });
  if (!body || typeof body !== 'object') throw new AdminApiError('The close response could not be verified.');
  const result = body as Partial<AdminRaffleCloseResult>;
  if (result.success !== true || result.status !== 'closed' || typeof result.alreadyClosed !== 'boolean') {
    throw new AdminApiError('The server did not confirm that the raffle was closed. Refresh before retrying.');
  }
  return result as AdminRaffleCloseResult;
}

export interface AdminRaffleReservationResult {
  success: true;
  alreadyReserved: boolean;
  reservationId: string;
  amount: number | string;
  currency: 'TON' | 'ZAP';
  fundingSource: 'treasury' | 'external';
}

export async function reserveAdminRafflePrize(
  creds: AdminCredentials,
  raffleId: string,
): Promise<AdminRaffleReservationResult> {
  const body = await callAdminApi(creds, { action: 'reserve_raffle_prize', raffle: { id: raffleId } });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The prize reservation response could not be verified.');
  }
  const result = body as Partial<AdminRaffleReservationResult>;
  if (
    result.success !== true ||
    typeof result.reservationId !== 'string' ||
    !['TON', 'ZAP'].includes(String(result.currency)) ||
    !['treasury', 'external'].includes(String(result.fundingSource)) ||
    !Number.isFinite(Number(result.amount)) ||
    typeof result.alreadyReserved !== 'boolean'
  ) {
    throw new AdminApiError('The prize reservation could not be verified. Refresh the raffle list before retrying.');
  }
  return result as AdminRaffleReservationResult;
}


export interface AdminTonWithdrawal {
  id: string;
  player_id: string;
  wallet_address: string;
  amount_nano: string;
  status: 'pending' | 'approved' | 'processing';
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  transaction_hash: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  telegram_id: number | string;
  username: string | null;
  first_name: string | null;
}

export async function listAdminTonWithdrawals(creds: AdminCredentials): Promise<AdminTonWithdrawal[]> {
  const body = await callAdminApi(creds, { action: 'list_ton_withdrawals' });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { requests?: unknown }).requests)) {
    throw new AdminApiError('Could not load TON withdrawal requests.');
  }
  return (body as { requests: AdminTonWithdrawal[] }).requests;
}

export type AdminTonWithdrawalAction = 'approve' | 'reject' | 'processing' | 'paid';

export async function reviewAdminTonWithdrawal(
  creds: AdminCredentials,
  input: { requestId: string; action: AdminTonWithdrawalAction; note?: string; transactionHash?: string },
): Promise<{ success: true; id: string; status: string; amountNano: string; transactionHash: string | null }> {
  const body = await callAdminApi(creds, {
    action: 'review_ton_withdrawal',
    tonWithdrawalId: input.requestId,
    withdrawalAction: input.action,
    adminNote: input.note ?? '',
    transactionHash: input.transactionHash ?? '',
  });
  if (!body || typeof body !== 'object') throw new AdminApiError('The withdrawal review response could not be verified.');
  const result = body as Record<string, unknown>;
  if (result.success !== true || result.id !== input.requestId || typeof result.status !== 'string' || typeof result.amountNano !== 'string') {
    throw new AdminApiError('The withdrawal request could not be updated. Refresh the queue before retrying.');
  }
  return result as { success: true; id: string; status: string; amountNano: string; transactionHash: string | null };
}


export interface AdminReferralBudget {
  monthStart: string;
  monthlyBudgetZp: number;
  allocatedZp: number;
  remainingBudgetZp: number;
  summary: {
    pendingZp: number;
    verifiedUnfundedZp: number;
    heldZp: number;
    claimableZp: number;
    claimedZp: number;
    lifetimeGeneratedZp: number;
  };
}
export interface AdminReferralPlayer {
  id: string;
  username: string | null;
  first_name: string | null;
  referral_code: string;
  created_at: string;
  status: 'active' | 'held' | 'suspended';
  reason: string | null;
  referralCount: number;
  levelOneCount: number;
}
export interface AdminReferralEntry {
  id: string;
  recipient_player_id: string;
  source_player_id: string;
  referral_level: number;
  amount: number | string;
  allocated_amount: number | string;
  claimed_amount: number | string;
  status: string;
  eligible_at: string;
  created_at: string;
  recipientLabel: string;
}
export interface AdminReferralBudgetHistory {
  id: string;
  month_start: string;
  old_budget_zp: number | string;
  new_budget_zp: number | string;
  admin_username: string;
  created_at: string;
}
export interface AdminReferralManagement {
  budget: AdminReferralBudget;
  rates: { directRate: number; secondLevelRate: number; overclockMultiplier: number; pendingHours: number };
  referralStats: { total: number; directRelationships: number };
  players: AdminReferralPlayer[];
  entries: AdminReferralEntry[];
  history: AdminReferralBudgetHistory[];
}

export async function getReferralManagement(creds: AdminCredentials): Promise<AdminReferralManagement> {
  const body = await callAdminApi(creds, { action: 'list_referral_management' });
  if (!body || typeof body !== 'object') throw new AdminApiError('Could not load referral management data.');
  const result = body as Partial<AdminReferralManagement> & { success?: unknown };
  if (result.success !== true || !result.budget || !result.rates || !result.referralStats ||
      !Array.isArray(result.players) || !Array.isArray(result.entries) || !Array.isArray(result.history)) {
    throw new AdminApiError('The referral management response could not be verified.');
  }
  return result as AdminReferralManagement;
}

export async function saveReferralKickbackBudget(creds: AdminCredentials, amount: number): Promise<AdminReferralBudget> {
  const body = await callAdminApi(creds, { action: 'set_referral_kickback_budget', monthlyKickbackBudgetZp: amount });
  if (!body || typeof body !== 'object') throw new AdminApiError('The monthly referral budget response could not be verified.');
  const result = body as Partial<AdminReferralBudget> & { success?: unknown };
  if (typeof result.monthStart !== 'string' || typeof result.monthlyBudgetZp !== 'number' ||
      typeof result.allocatedZp !== 'number' || typeof result.remainingBudgetZp !== 'number' || !result.summary) {
    throw new AdminApiError('The monthly referral budget could not be verified. Refresh before retrying.');
  }
  return result as AdminReferralBudget;
}

export async function setReferralKickbackAccountStatus(
  creds: AdminCredentials,
  playerId: string,
  status: 'active' | 'held' | 'suspended',
  reason: string,
): Promise<void> {
  const body = await callAdminApi(creds, { action: 'set_referral_account_status', playerId, referralStatus: status, reason });
  if (!body || typeof body !== 'object' || (body as { success?: unknown }).success !== true ||
      (body as { status?: unknown }).status !== status) {
    throw new AdminApiError('The referral account status change could not be verified.');
  }
}


export interface AdminGlobalMiningSettings {
  success: true;
  fragmentMiningEnabled: boolean;
  fragmentMiningRateMultiplier: number;
  pausedAt: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface AdminBroadcastResult {
  success: true;
  announcementId: string;
  inAppPublished: boolean;
  telegramSent: number;
  telegramFailed: number;
  telegramSkipped: number;
}

export async function sendAdminBroadcast(
  creds: AdminCredentials,
  input: { title: string; message: string; channels: Array<'in_app' | 'telegram'> },
): Promise<AdminBroadcastResult> {
  const body = await callAdminApi(creds, { action: 'send_broadcast', ...input });
  if (!body || typeof body !== 'object') throw new AdminApiError('The broadcast response could not be verified.');
  const result = body as Partial<AdminBroadcastResult>;
  if (result.success !== true || typeof result.announcementId !== 'string' ||
      typeof result.inAppPublished !== 'boolean' || !Number.isInteger(result.telegramSent) ||
      !Number.isInteger(result.telegramFailed) || !Number.isInteger(result.telegramSkipped)) {
    throw new AdminApiError('The broadcast result could not be verified. Check the announcement history before retrying.');
  }
  return result as AdminBroadcastResult;
}

export async function getAdminGlobalMiningSettings(creds: AdminCredentials): Promise<AdminGlobalMiningSettings> {
  const body = await callAdminApi(creds, { action: 'get_global_mining_settings' });
  if (!body || typeof body !== 'object') throw new AdminApiError('Could not load global mining settings.');
  const result = body as Partial<AdminGlobalMiningSettings>;
  if (result.success !== true || typeof result.fragmentMiningEnabled !== 'boolean' ||
      typeof result.fragmentMiningRateMultiplier !== 'number' || typeof result.updatedAt !== 'string') {
    throw new AdminApiError('The global mining settings response could not be verified.');
  }
  return result as AdminGlobalMiningSettings;
}

export async function setAdminGlobalMiningSettings(
  creds: AdminCredentials,
  input: { enabled: boolean; rateMultiplier: number },
): Promise<AdminGlobalMiningSettings> {
  const body = await callAdminApi(creds, {
    action: 'set_global_mining_settings',
    miningEnabled: input.enabled,
    miningRateMultiplier: input.rateMultiplier,
  });
  if (!body || typeof body !== 'object') throw new AdminApiError('The mining settings response could not be verified.');
  const result = body as Partial<AdminGlobalMiningSettings>;
  if (result.success !== true || result.fragmentMiningEnabled !== input.enabled ||
      result.fragmentMiningRateMultiplier !== input.rateMultiplier || typeof result.updatedAt !== 'string') {
    throw new AdminApiError('The server did not confirm the requested mining settings. Refresh before retrying.');
  }
  return result as AdminGlobalMiningSettings;
}

export async function flushAdminApiCache(creds: AdminCredentials): Promise<{ success: true; flushedAt: string; scope: string }> {
  const body = await callAdminApi(creds, { action: 'flush_api_cache' });
  if (!body || typeof body !== 'object') throw new AdminApiError('The cache refresh response could not be verified.');
  const result = body as { success?: unknown; flushedAt?: unknown; scope?: unknown };
  if (result.success !== true || typeof result.flushedAt !== 'string' || typeof result.scope !== 'string') {
    throw new AdminApiError('The server did not confirm the API cache refresh.');
  }
  return result as { success: true; flushedAt: string; scope: string };
}

export interface AdminExportRow {
  player_id: string;
  username: string | null;
  first_name: string | null;
  referral_code: string;
  account_created_at: string;
  zp_balance: number;
  lifetime_zp: number;
}

export async function exportAdminPlayerData(creds: AdminCredentials): Promise<AdminExportRow[]> {
  const body = await callAdminApi(creds, { action: 'export_player_data' });
  if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) {
    throw new AdminApiError('The player export response could not be verified.');
  }
  const rows = (body as { rows: AdminExportRow[] }).rows;
  if (rows.some((row) => !row || typeof row.player_id !== 'string' ||
      typeof row.referral_code !== 'string' || typeof row.account_created_at !== 'string' ||
      !Number.isFinite(Number(row.zp_balance)) || !Number.isFinite(Number(row.lifetime_zp)))) {
    throw new AdminApiError('The player export contains an invalid row. No file was created.');
  }
  return rows;
}

export async function reviewXFollowSubmission(creds: AdminCredentials, submissionId: string, decision: 'approved' | 'rejected'): Promise<{ success: true; decision: 'approved' | 'rejected'; rewardZp: number; playerId?: string; xUsername?: string }> {
  const body = await callAdminApi(creds, { action: 'review_x_follow_submission', submissionId, decision });
  if (!body || typeof body !== 'object') throw new AdminApiError('The X Follow review response could not be verified.');
  const result = body as { success?: unknown; decision?: unknown; rewardZp?: unknown; playerId?: unknown; xUsername?: unknown };
  if (result.success !== true || result.decision !== decision || typeof result.rewardZp !== 'number' || !Number.isFinite(result.rewardZp)) throw new AdminApiError('The X Follow review could not be verified. Refresh the queue and check its status.');
  return { success: true, decision, rewardZp: result.rewardZp, playerId: typeof result.playerId === 'string' ? result.playerId : undefined, xUsername: typeof result.xUsername === 'string' ? result.xUsername : undefined };
}
