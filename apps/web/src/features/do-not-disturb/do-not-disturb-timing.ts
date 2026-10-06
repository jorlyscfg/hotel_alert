import type { CompactRoom } from '@hotel/shared';

export type DoNotDisturbAgeSeverity = 'gray' | 'yellow' | 'red' | 'unknown';

const DO_NOT_DISTURB_AGE_SEVERITY_RANK: Record<DoNotDisturbAgeSeverity, number> = {
  unknown: 0,
  gray: 1,
  yellow: 2,
  red: 3
};

export const DO_NOT_DISTURB_WARNING_THRESHOLD_MS = 60 * 60 * 1000;
export const DO_NOT_DISTURB_CRITICAL_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function resolveDoNotDisturbRoomAge(
  activatedAt: string | null | undefined,
  currentTime: Date,
  locale: 'en' | 'es'
): { severity: DoNotDisturbAgeSeverity; elapsed: string | null } {
  if (activatedAt === undefined || activatedAt === null) return { severity: 'unknown', elapsed: null };

  const activatedAtTime = Date.parse(activatedAt);
  const rawElapsedMilliseconds = currentTime.getTime() - activatedAtTime;
  if (!Number.isFinite(activatedAtTime) || !Number.isFinite(rawElapsedMilliseconds)) {
    return { severity: 'unknown', elapsed: null };
  }

  const elapsedMilliseconds = Math.max(0, rawElapsedMilliseconds);
  let severity: DoNotDisturbAgeSeverity = 'gray';
  if (elapsedMilliseconds >= DO_NOT_DISTURB_CRITICAL_THRESHOLD_MS) severity = 'red';
  else if (elapsedMilliseconds >= DO_NOT_DISTURB_WARNING_THRESHOLD_MS) severity = 'yellow';

  return { severity, elapsed: formatDoNotDisturbElapsed(elapsedMilliseconds, locale) };
}

export function resolveDoNotDisturbTabSeverity(rooms: readonly CompactRoom[], currentTime: Date, locale: 'en' | 'es'): DoNotDisturbAgeSeverity {
  return rooms.reduce<DoNotDisturbAgeSeverity>((highest, room) => {
    const next = resolveDoNotDisturbRoomAge(room.doNotDisturbActivatedAt, currentTime, locale).severity;
    return DO_NOT_DISTURB_AGE_SEVERITY_RANK[next] > DO_NOT_DISTURB_AGE_SEVERITY_RANK[highest] ? next : highest;
  }, 'unknown');
}

function formatDoNotDisturbElapsed(durationMs: number, locale: 'en' | 'es'): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes === 0) return locale === 'es' ? 'menos de 1 min' : 'under 1m';

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);
  return parts.join(' ');
}
