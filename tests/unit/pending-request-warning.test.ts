import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PendingRequestWarningController,
  resolveBrowserPendingWarningRequests
} from '../../apps/web/src/features/device/pending-request-warning';

const WARNING_INTERVAL_MS = 3 * 60 * 1000;

describe('AREA pending request warning controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves Android bridge reminders to the native owner and selects only pending requests in browsers', () => {
    const requests = [
      { id: 'request-1', createdAt: '2026-09-27T12:00:00.000Z', status: 'PENDING' },
      { id: 'request-2', createdAt: '2026-09-27T12:01:00.000Z', status: 'IN_PROGRESS' }
    ];

    expect(resolveBrowserPendingWarningRequests(requests, true)).toEqual([]);
    expect(resolveBrowserPendingWarningRequests(requests, false)).toEqual([
      { id: 'request-1', createdAt: '2026-09-27T12:00:00.000Z' }
    ]);
  });

  it('warns immediately when an initial snapshot contains an overdue pending request', () => {
    const now = Date.parse('2026-09-27T12:04:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const onWarning = vi.fn();
    const controller = new PendingRequestWarningController(onWarning);

    controller.update([{ id: 'request-1', createdAt: '2026-09-27T12:01:00.000Z' }], now);
    vi.advanceTimersByTime(0);

    expect(onWarning).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('repeats every three minutes and stops when no pending requests remain', () => {
    const now = Date.parse('2026-09-27T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const onWarning = vi.fn();
    const controller = new PendingRequestWarningController(onWarning);

    controller.update([{ id: 'request-1', createdAt: new Date(now).toISOString() }], now);
    vi.advanceTimersByTime(WARNING_INTERVAL_MS - 1);
    expect(onWarning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onWarning).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WARNING_INTERVAL_MS);
    expect(onWarning).toHaveBeenCalledTimes(2);

    controller.update([], Date.now());
    vi.advanceTimersByTime(WARNING_INTERVAL_MS * 2);
    expect(onWarning).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('restarts the deadline on every newly pending request and retains older pending requests', () => {
    const now = Date.parse('2026-09-27T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const onWarning = vi.fn();
    const controller = new PendingRequestWarningController(onWarning);
    const firstRequest = { id: 'request-1', createdAt: new Date(now).toISOString() };

    controller.update([firstRequest], now);
    vi.advanceTimersByTime(2 * 60 * 1000);
    const secondRequest = { id: 'request-2', createdAt: new Date(Date.now()).toISOString() };
    controller.update([firstRequest, secondRequest], Date.now());

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(onWarning).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 1000);
    expect(onWarning).toHaveBeenCalledTimes(1);

    controller.update([firstRequest], Date.now());
    vi.advanceTimersByTime(WARNING_INTERVAL_MS);
    expect(onWarning).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('does not restart the warning deadline on a refresh with the same pending request', () => {
    const now = Date.parse('2026-09-27T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const onWarning = vi.fn();
    const controller = new PendingRequestWarningController(onWarning);
    const pendingRequest = { id: 'request-1', createdAt: new Date(now).toISOString() };

    controller.update([pendingRequest], now);
    vi.advanceTimersByTime(2 * 60 * 1000);
    controller.update([pendingRequest], Date.now());
    vi.advanceTimersByTime(60 * 1000);

    expect(onWarning).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
