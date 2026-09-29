const NOTIFICATION_FREQUENCY_HZ = 880;
const NOTIFICATION_DURATION_SECONDS = 0.2;
const DND_ACTIVE_FREQUENCIES_HZ = [698, 523] as const;
const DND_INACTIVE_FREQUENCIES_HZ = [523, 698] as const;
const DND_NOTE_DURATION_SECONDS = 0.12;
const DND_NOTE_GAP_SECONDS = 0.06;

type AudioContextConstructor = new () => AudioContext;
type NotificationAudioWindow = Window & {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
};

export function createNotificationAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const audioWindow = window as NotificationAudioWindow;
  const standardConstructor = audioWindow.AudioContext;
  const fallbackConstructor = audioWindow.webkitAudioContext;
  const AudioContextClass = typeof standardConstructor === 'function' ? standardConstructor : fallbackConstructor;
  if (typeof AudioContextClass !== 'function') return null;
  try {
    return new AudioContextClass();
  } catch {
    return null;
  }
}

export function replaceNotificationAudioContext(context: AudioContext | null): AudioContext | null {
  closeNotificationAudioContext(context);
  return createNotificationAudioContext();
}

export async function playNotificationTone(context: AudioContext): Promise<boolean> {
  try {
    if (context.state === 'closed') return false;
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') return false;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(NOTIFICATION_FREQUENCY_HZ, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + NOTIFICATION_DURATION_SECONDS);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + NOTIFICATION_DURATION_SECONDS);
    return true;
  } catch {
    return false;
  }
}

export type DoNotDisturbTransition = 'activated' | 'deactivated';

export async function playDoNotDisturbTransitionTones(
  context: AudioContext,
  transitions: readonly DoNotDisturbTransition[]
): Promise<boolean> {
  try {
    if (transitions.length === 0 || context.state === 'closed') return false;
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') return false;

    const frequencies = transitions.flatMap((transition) => transition === 'activated'
      ? DND_ACTIVE_FREQUENCIES_HZ
      : DND_INACTIVE_FREQUENCIES_HZ);
    let startAt = context.currentTime;
    for (const frequency of frequencies) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + DND_NOTE_DURATION_SECONDS);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + DND_NOTE_DURATION_SECONDS);
      startAt += DND_NOTE_DURATION_SECONDS + DND_NOTE_GAP_SECONDS;
    }
    return true;
  } catch {
    return false;
  }
}

export function closeNotificationAudioContext(context: AudioContext | null): void {
  if (context === null || context.state === 'closed') return;
  try {
    void context.close().catch(() => undefined);
  } catch {
    // Audio cleanup is best effort; the browser owns the context lifecycle.
  }
}
