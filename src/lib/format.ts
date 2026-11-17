export const pad = (value: number) => String(value).padStart(2, '0');

export const formatZp = (value: number | string) => {
  if (typeof value === 'string') {
    return /^\d+(?:\.0+)?$/.test(value) ? BigInt(value.split('.')[0]).toLocaleString('en-US') : '0';
  }
  return Math.floor(value).toLocaleString('en-US');
};

export const formatRate = (value: number) => value.toFixed(2);

export const formatTon = (value: number) => value.toFixed(2);

export const dayKey = (now: number) => {
  const date = new Date(now);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const msUntilNextDay = (now: number) => {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now;
};

export const formatRemaining = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${pad(seconds)}s`;
};

export const formatCooldown = (ms: number) => `COOLDOWN: ${formatClock(ms)}`;

export const formatClock = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

export const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

 
export const formatGram = (value: number | string, maxFractionDigits = 9) => {
  const raw = typeof value === 'number'
    ? (Number.isFinite(value) ? value.toFixed(maxFractionDigits) : '0')
    : value.trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return '0';
  const [, sign, wholeRaw, fractionRaw = ''] = match;
  const whole = BigInt(wholeRaw).toLocaleString('en-US');
  const fraction = fractionRaw.slice(0, maxFractionDigits).replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
};
