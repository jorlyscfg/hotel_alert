import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closeNotificationAudioContext,
  createNotificationAudioContext,
  playNotificationTone
} from '../../notification-audio';

export const MAX_PENDING_ALERT_REPEATS = 3;

export interface PendingRequestAlertState {
  soundEnabled: boolean;
  enableSound: () => void;
}

interface PendingRequestAlertOptions {
  playImmediatelyOnEnable?: boolean;
  playImmediatelyOnNewRequest?: boolean;
}

export function resolvePendingAlertIntervalMs(value: number | undefined): number {
  return value ?? 5000;
}

export function shouldPlayPendingAlertImmediately(
  previousPendingRequestCount: number,
  pendingRequestCount: number,
  previousSoundEnabled: boolean,
  soundEnabled: boolean
): boolean {
  if (!soundEnabled || pendingRequestCount === 0) return false;
  return pendingRequestCount > previousPendingRequestCount || (!previousSoundEnabled && soundEnabled);
}

export function usePendingRequestAlert(
  pendingRequestCount: number,
  intervalMs: number,
  { playImmediatelyOnEnable = true, playImmediatelyOnNewRequest = true }: PendingRequestAlertOptions = {}
): PendingRequestAlertState {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousPendingRequestCountRef = useRef(pendingRequestCount);
  const previousSoundEnabledRef = useRef(soundEnabled);
  const repeatCountRef = useRef(0);

  const enableSound = useCallback(() => {
    const context = audioContextRef.current ?? createNotificationAudioContext();
    if (context === null) return;
    audioContextRef.current = context;
    if (playImmediatelyOnEnable) previousSoundEnabledRef.current = true;
    setSoundEnabled(true);
    void context.resume().catch(() => undefined);
    if (playImmediatelyOnEnable) void playNotificationTone(context).catch(() => undefined);
  }, [playImmediatelyOnEnable]);

  const playAlert = useCallback(() => {
    const context = audioContextRef.current;
    if (!soundEnabled || pendingRequestCount === 0 || context === null) return;
    void playNotificationTone(context).catch(() => undefined);
  }, [pendingRequestCount, soundEnabled]);

  useEffect(() => {
    const previousPendingRequestCount = previousPendingRequestCountRef.current;
    const previousSoundEnabled = previousSoundEnabledRef.current;
    const shouldPlayImmediately = playImmediatelyOnNewRequest && shouldPlayPendingAlertImmediately(
      previousPendingRequestCount,
      pendingRequestCount,
      previousSoundEnabled,
      soundEnabled
    );
    previousPendingRequestCountRef.current = pendingRequestCount;
    previousSoundEnabledRef.current = soundEnabled;

    if (!soundEnabled || pendingRequestCount === 0) {
      repeatCountRef.current = 0;
      return undefined;
    }

    if (shouldPlayImmediately) {
      repeatCountRef.current = 0;
      playAlert();
    }

    let timerStopped = false;
    const alertTimer = window.setInterval(() => {
      if (timerStopped) return;
      if (repeatCountRef.current >= MAX_PENDING_ALERT_REPEATS) {
        timerStopped = true;
        window.clearInterval(alertTimer);
        return;
      }
      repeatCountRef.current += 1;
      playAlert();
      if (repeatCountRef.current >= MAX_PENDING_ALERT_REPEATS) {
        timerStopped = true;
        window.clearInterval(alertTimer);
      }
    }, resolvePendingAlertIntervalMs(intervalMs));

    return () => window.clearInterval(alertTimer);
  }, [intervalMs, pendingRequestCount, playAlert, playImmediatelyOnNewRequest, soundEnabled]);

  useEffect(() => () => {
    closeNotificationAudioContext(audioContextRef.current);
  }, []);

  return { soundEnabled, enableSound };
}
