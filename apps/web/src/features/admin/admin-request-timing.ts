import { DEFAULT_SETTINGS, type RequestDTO } from '@hotel/shared';

export const ADMIN_QUEUE_TABS = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DO_NOT_DISTURB'] as const;
export const ADMIN_QUEUE_CLOCK_TICK_MS = 15_000;

export interface AdminRequestLifecycleSegment {
  stage: 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS';
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface AdminRequestLifecycle {
  segments: AdminRequestLifecycleSegment[];
  totalDurationMs: number | null;
}

export interface AdminQueueDelayThresholds {
  pendingMinutes: number;
  inProgressMinutes: number;
}

export interface AdminRequestDelayState {
  stage: 'PENDING' | 'IN_PROGRESS';
  startedAt: string;
  elapsedMs: number;
  thresholdMs: number;
  overdue: boolean;
}

export function resolveAdminQueueDelayThresholds(settings: readonly { key: string; value: unknown }[]): AdminQueueDelayThresholds {
  const configuredValues = new Map(settings.map((setting) => [setting.key, setting.value]));
  return {
    pendingMinutes: resolveMinutes(configuredValues.get('requests.pendingDelayWarningMinutes'), DEFAULT_SETTINGS['requests.pendingDelayWarningMinutes']),
    inProgressMinutes: resolveMinutes(configuredValues.get('requests.inProgressDelayWarningMinutes'), DEFAULT_SETTINGS['requests.inProgressDelayWarningMinutes'])
  };
}

export function buildAdminRequestLifecycle(request: RequestDTO): AdminRequestLifecycle {
  const segments: AdminRequestLifecycleSegment[] = [];
  const pendingEnd = request.acceptedAt ?? request.inProgressAt ?? request.completedAt;
  const pending = createSegment('PENDING', request.createdAt, pendingEnd);
  if (pending !== null) segments.push(pending);

  if (request.acceptedAt !== null && request.inProgressAt !== null) {
    const accepted = createSegment('ACCEPTED', request.acceptedAt, request.inProgressAt);
    if (accepted !== null) segments.push(accepted);
  }

  const inProgressStart = request.inProgressAt ?? request.acceptedAt;
  if (inProgressStart !== null) {
    const inProgress = createSegment('IN_PROGRESS', inProgressStart, request.completedAt);
    if (inProgress !== null) segments.push(inProgress);
  }

  const totalDurationMs = request.completedAt === null
    ? null
    : durationBetween(request.createdAt, request.completedAt);

  return { segments, totalDurationMs };
}

export function getAdminRequestDelayState(request: RequestDTO, now: Date, thresholds: AdminQueueDelayThresholds): AdminRequestDelayState | null {
  const activeStage = request.status === 'PENDING'
    ? { stage: 'PENDING' as const, startedAt: request.createdAt, minutes: thresholds.pendingMinutes }
    : request.status === 'IN_PROGRESS' || request.status === 'ACCEPTED'
      ? { stage: 'IN_PROGRESS' as const, startedAt: request.inProgressAt ?? request.acceptedAt, minutes: thresholds.inProgressMinutes }
      : null;
  if (activeStage === null || activeStage.startedAt === null) return null;

  const startedAtMs = parseDate(activeStage.startedAt);
  if (startedAtMs === null) return null;
  const elapsedMs = Math.max(0, now.getTime() - startedAtMs);
  const thresholdMs = Math.max(1, activeStage.minutes) * 60_000;
  return {
    stage: activeStage.stage,
    startedAt: activeStage.startedAt,
    elapsedMs,
    thresholdMs,
    overdue: elapsedMs >= thresholdMs
  };
}

export function formatAdminDuration(durationMs: number | null, locale: 'en' | 'es'): string {
  if (durationMs === null) return '—';
  const totalMinutes = Math.floor(Math.max(0, durationMs) / 60_000);
  if (totalMinutes === 0) return locale === 'es' ? 'ahora' : 'just now';

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);
  return parts.join(' ');
}

export function formatAdminElapsedWithAgo(durationMs: number, locale: 'en' | 'es', ago: string): string {
  const elapsed = formatAdminDuration(durationMs, locale);
  if (elapsed === 'just now' || elapsed === 'ahora') return elapsed;
  return locale === 'es' ? `${ago} ${elapsed}` : `${elapsed} ${ago}`;
}

function resolveMinutes(value: unknown, fallback: number): number {
  const minutes = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? Math.floor(minutes) : fallback;
}

function createSegment(stage: AdminRequestLifecycleSegment['stage'], startedAt: string, endedAt: string | null): AdminRequestLifecycleSegment | null {
  const durationMs = endedAt === null ? null : durationBetween(startedAt, endedAt);
  if (endedAt !== null && durationMs === null) return null;
  return { stage, startedAt, endedAt, durationMs };
}

function durationBetween(startedAt: string, endedAt: string): number | null {
  const start = parseDate(startedAt);
  const end = parseDate(endedAt);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

function parseDate(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
