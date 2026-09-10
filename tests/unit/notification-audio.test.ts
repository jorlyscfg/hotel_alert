import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNotificationAudioContext,
  playNotificationTone
} from '../../apps/web/src/notification-audio';

interface FakeOscillator {
  type: string;
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

interface FakeAudioContext {
  state: 'running' | 'suspended' | 'closed';
  currentTime: number;
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  oscillator: FakeOscillator;
  gain: FakeGain;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notification audio', () => {
  it('creates a context with the standard AudioContext constructor', () => {
    const context = createFakeAudioContext('running');
    const constructor = vi.fn(() => context);
    vi.stubGlobal('window', { AudioContext: constructor });

    expect(createNotificationAudioContext()).toBe(context);
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it('falls back to the webkitAudioContext constructor when needed', () => {
    const context = createFakeAudioContext('running');
    const constructor = vi.fn(() => context);
    vi.stubGlobal('window', { webkitAudioContext: constructor });

    expect(createNotificationAudioContext()).toBe(context);
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it('plays a successful automatic tone through the oscillator and gain nodes', async () => {
    const context = createFakeAudioContext('running');

    await expect(playNotificationTone(context as unknown as AudioContext)).resolves.toBe(true);

    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    expect(context.createGain).toHaveBeenCalledTimes(1);
    expect(context.oscillator.start).toHaveBeenCalledTimes(1);
  });
});

function createFakeAudioContext(state: FakeAudioContext['state']): FakeAudioContext {
  const oscillator: FakeOscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  };
  const gain: FakeGain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    },
    connect: vi.fn()
  };
  const context = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    close: vi.fn(),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    oscillator,
    gain
  };
  context.resume.mockImplementation(async () => {
    context.state = 'running';
  });
  context.close.mockImplementation(async () => {
    context.state = 'closed';
  });
  return context;
}
