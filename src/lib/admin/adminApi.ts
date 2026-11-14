
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


export interface AdminDashboardData {
  stats: AdminStats;
  vaultReserves: AdminVaultReserves;
  submissions: AdminSubmission[];
  tasks: AdminTask[];
  events: AdminEvent[];
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
  objectives: Array<{ kind: 'briefing' | 'quiz' | 'game' | 'community' | 'external' | 'milestone'; title: string }>;
}

export async function saveExpeditionDraft(
  creds: AdminCredentials,
  expedition: AdminExpeditionDraftInput,
): Promise<{ id: string; slug: string }> {
  const body = await callAdminApi(creds, { action: 'save_expedition_draft', expedition });
  if (!body || typeof body !== 'object') {
    throw new AdminApiError('The Expedition draft response could not be verified.');
  }
  const result = body as { success?: unknown; id?: unknown; slug?: unknown; status?: unknown };
  if (result.success !== true || typeof result.id !== 'string' || typeof result.slug !== 'string' || result.status !== 'draft') {
    throw new AdminApiError('The Expedition draft could not be verified. Refresh the admin page before retrying.');
  }
  return { id: result.id, slug: result.slug };
}
