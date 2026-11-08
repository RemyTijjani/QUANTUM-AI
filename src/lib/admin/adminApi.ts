export interface AdminCredentials {
  username: string;
  password: string;
}

export interface AdminSubmission {
  id: string;
  mission_id: string;
  player_referral_code: string;
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
}

export interface AdminTaskInput {
  id?: string;
  kind: AdminTask['kind'];
  title: string;
  description: string;
  reward: number;
  platform: AdminTask['platform'];
  actionUrl: string | null;
}

export interface AdminStats {
  totalPlayers: number;
  totalSubmissions: number;
  pendingSubmissions: number;
  totalZp: number;
}

export interface AdminDashboardData {
  stats: AdminStats;
  submissions: AdminSubmission[];
  tasks: AdminTask[];
}

export interface ReviewResult {
  rewardZp: number;
  playerReferralCode: string;
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
    throw new AdminApiError('Could not reach the admin service. Check your connection and try again.');
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const serverError = (body as { error?: unknown } | null)?.error;
    if (res.status === 401) throw new AdminApiError('Invalid credentials. Access denied.');
    throw new AdminApiError(typeof serverError === 'string' ? serverError : `Request failed (${res.status}).`);
  }

  return body;
}

function isDashboardData(value: unknown): value is AdminDashboardData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AdminDashboardData>;
  return !!v.stats && Array.isArray(v.submissions) && Array.isArray(v.tasks);
}

export async function fetchDashboard(creds: AdminCredentials): Promise<AdminDashboardData> {
  const body = await callAdminApi(creds, { action: 'fetch_dashboard' });
  if (!isDashboardData(body)) throw new AdminApiError('Received an unexpected response from the admin service.');
  return body;
}

export async function reviewSubmission(
  creds: AdminCredentials,
  submissionId: string,
  decision: 'approved' | 'rejected',
): Promise<ReviewResult> {
  const body = (await callAdminApi(creds, { action: 'review_submission', submissionId, decision })) as Partial<ReviewResult> | null;
  if (typeof body?.rewardZp !== 'number' || typeof body?.playerReferralCode !== 'string') {
    throw new AdminApiError('Received an unexpected response from the admin service.');
  }
  return { rewardZp: body.rewardZp, playerReferralCode: body.playerReferralCode };
}

export async function saveTask(creds: AdminCredentials, task: AdminTaskInput): Promise<void> {
  await callAdminApi(creds, { action: 'save_task', task });
}

export async function deleteTask(creds: AdminCredentials, taskId: string): Promise<void> {
  await callAdminApi(creds, { action: 'delete_task', taskId });
}
