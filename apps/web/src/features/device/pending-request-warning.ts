export const PENDING_REQUEST_WARNING_INTERVAL_MS = 3 * 60 * 1000;

export interface PendingRequestWarningRequest {
  id: string;
  createdAt: string;
}

export function resolveBrowserPendingWarningRequests(
  requests: readonly (PendingRequestWarningRequest & { status: string })[],
  nativeBridgeAvailable: boolean
): PendingRequestWarningRequest[] {
  if (nativeBridgeAvailable) return [];
  return requests
    .filter((request) => request.status === 'PENDING')
    .map(({ id, createdAt }) => ({ id, createdAt }));
}

export class PendingRequestWarningController {
  private activeRequestIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onWarning: () => void) {}

  update(pendingRequests: readonly PendingRequestWarningRequest[], now = Date.now()): void {
    const currentIds = new Set(pendingRequests.map((request) => request.id));
    if (currentIds.size === 0) {
      this.activeRequestIds.clear();
      this.clearTimer();
      return;
    }

    const newlyPendingRequests = pendingRequests.filter((request) => !this.activeRequestIds.has(request.id));
    this.activeRequestIds = currentIds;
    if (newlyPendingRequests.length === 0 && this.timer !== null) return;

    const anchorRequests = newlyPendingRequests.length > 0 ? newlyPendingRequests : pendingRequests;
    const latestCreatedAt = latestValidCreatedAt(anchorRequests);
    const nextWarningAt = (latestCreatedAt ?? now) + PENDING_REQUEST_WARNING_INTERVAL_MS;
    this.schedule(Math.max(0, nextWarningAt - now));
  }

  dispose(): void {
    this.activeRequestIds.clear();
    this.clearTimer();
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(this.warnAndRepeat, delayMs);
  }

  private warnAndRepeat = (): void => {
    this.timer = null;
    if (this.activeRequestIds.size === 0) return;

    try {
      this.onWarning();
    } finally {
      if (this.activeRequestIds.size > 0) {
        this.timer = setTimeout(this.warnAndRepeat, PENDING_REQUEST_WARNING_INTERVAL_MS);
      }
    }
  };

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

function latestValidCreatedAt(requests: readonly PendingRequestWarningRequest[]): number | null {
  const timestamps = requests
    .map((request) => Date.parse(request.createdAt))
    .filter((timestamp) => Number.isFinite(timestamp));
  return timestamps.length === 0 ? null : Math.max(...timestamps);
}
