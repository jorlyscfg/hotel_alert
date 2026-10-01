import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInformationCarouselLifecycle,
  createInformationCarouselOverlayHandlers,
  createInformationImageLoadCoordinator,
  resolveInformationCarouselPhase,
  type InformationCarouselLifecycleState,
  type LoadedInformationImage
} from '../../apps/web/src/features/device/InformationCarousel';

const informationCarouselSource = readFileSync(fileURLToPath(new URL('../../apps/web/src/features/device/InformationCarousel.tsx', import.meta.url)), 'utf8');

afterEach(() => {
  vi.useRealTimers();
});

describe('information carousel timeline', () => {
  it('selects the square image only when both viewport dimensions are compact', async () => {
    const module = await import('../../apps/web/src/features/device/InformationCarousel');
    const resolveInformationImageVariant = Reflect.get(module, 'resolveInformationImageVariant') as ((width: number, height: number) => string) | undefined;

    expect(resolveInformationImageVariant).toBeTypeOf('function');
    if (resolveInformationImageVariant === undefined) return;

    expect(resolveInformationImageVariant(480, 480)).toBe('square480');
    expect(resolveInformationImageVariant(520, 520)).toBe('square480');
    expect(resolveInformationImageVariant(521, 520)).toBe('wide');
    expect(resolveInformationImageVariant(520, 521)).toBe('wide');
  });

  it('keeps the room display visible until five seconds of inactivity', () => {
    expect(resolveInformationCarouselPhase(2, 0)).toBe('ROOM');
    expect(resolveInformationCarouselPhase(2, 4_999)).toBe('ROOM');
    expect(resolveInformationCarouselPhase(2, 5_000)).toEqual({ kind: 'IMAGE', index: 0 });
  });

  it('shows each image for five seconds, waits through a final grace period, and then completes', () => {
    expect(resolveInformationCarouselPhase(3, 9_999)).toEqual({ kind: 'IMAGE', index: 0 });
    expect(resolveInformationCarouselPhase(3, 10_000)).toEqual({ kind: 'IMAGE', index: 1 });
    expect(resolveInformationCarouselPhase(3, 14_999)).toEqual({ kind: 'IMAGE', index: 1 });
    expect(resolveInformationCarouselPhase(3, 15_000)).toEqual({ kind: 'IMAGE', index: 2 });
    expect(resolveInformationCarouselPhase(3, 20_000)).toBe('GRACE');
    expect(resolveInformationCarouselPhase(3, 24_999)).toBe('GRACE');
    expect(resolveInformationCarouselPhase(3, 25_000)).toBe('SAVER');
  });

  it('never starts when there are no information images', () => {
    expect(resolveInformationCarouselPhase(0, 60_000)).toBe('ROOM');
  });

  it('uses configured inactivity and slide intervals', () => {
    const timing = { inactivityMs: 1_000, slideIntervalMs: 2_000 };

    expect(resolveInformationCarouselPhase(2, 999, timing)).toBe('ROOM');
    expect(resolveInformationCarouselPhase(2, 1_000, timing)).toEqual({ kind: 'IMAGE', index: 0 });
    expect(resolveInformationCarouselPhase(2, 2_999, timing)).toEqual({ kind: 'IMAGE', index: 0 });
    expect(resolveInformationCarouselPhase(2, 3_000, timing)).toEqual({ kind: 'IMAGE', index: 1 });
    expect(resolveInformationCarouselPhase(2, 7_000, timing)).toBe('SAVER');
  });

  it('shields the full carousel surface from click-through and interaction leakage', () => {
    expect(informationCarouselSource).toMatch(/onPointerDown=\{handleOverlayPointerDown\}/);
    expect(informationCarouselSource).toMatch(/onTouchStart=\{handleOverlayPointerDown\}/);
    expect(informationCarouselSource).toMatch(/onPointerCancel=\{handleOverlayCancel\}/);
    expect(informationCarouselSource).toMatch(/onKeyDown=\{handleOverlayCancel\}/);
    expect(informationCarouselSource).toMatch(/onClick=\{handleOverlayCancel\}/);
    expect(informationCarouselSource).toMatch(/className="room-screensaver-interaction"[\s\S]*?onPointerDown=\{handleOverlayPointerDown\}[\s\S]*?onClick=\{handleOverlayCancel\}/);
  });

  it('keys the active overlay by image and slide so its fade replays on changes', () => {
    expect(informationCarouselSource).toContain('key={`${activeImage.image.id}:${activeIndex}`}');
  });

  it('keeps an active overlay through pointer-down and cancels only after a consumed click', () => {
    const states: InformationCarouselLifecycleState[] = [];
    const scheduled: Array<() => void> = [];
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 1,
      setScreensaver: async () => undefined,
      onStateChange: (state) => states.push(state),
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length - 1;
      },
      cancelSchedule: () => undefined
    });
    lifecycle.start();
    scheduled[0]?.();

    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 0 });

    const order: string[] = [];
    const handlers = createInformationCarouselOverlayHandlers(() => {
      order.push('cancel');
      lifecycle.cancel();
    });
    const pointerDown = createObservableOverlayEvent(order);
    handlers.block(pointerDown);

    expect(pointerDown.prevented).toBe(false);
    expect(pointerDown.stopped).toBe(true);
    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 0 });
    expect(order).toEqual(['stop']);

    const click = createObservableOverlayEvent(order);
    handlers.cancel(click);

    expect(click.prevented).toBe(true);
    expect(click.stopped).toBe(true);
    expect(order).toEqual(['stop', 'prevent', 'stop', 'cancel']);
    expect(states.at(-1)).toEqual({ phase: 'ROOM', activeIndex: 0 });
    lifecycle.dispose();
  });

  it('keeps the custom saver active through pointer-down and returns to ROOM after the click', async () => {
    vi.useFakeTimers();
    const states: InformationCarouselLifecycleState[] = [];
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const lifecycle = createInformationCarouselLifecycle({ imageCount: 1, setScreensaver, onStateChange: (state) => states.push(state) });

    lifecycle.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });

    const order: string[] = [];
    const handlers = createInformationCarouselOverlayHandlers(() => lifecycle.cancel());
    const pointerDown = createObservableOverlayEvent(order);
    handlers.block(pointerDown);
    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });

    const click = createObservableOverlayEvent(order);
    handlers.cancel(click);
    await flushPromises();

    expect(click.prevented).toBe(true);
    expect(click.stopped).toBe(true);
    expect(states.at(-1)).toEqual({ phase: 'ROOM', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenLastCalledWith(true);
    lifecycle.dispose();
  });
});

describe('information carousel lifecycle', () => {
  it('ignores image-count updates after disposal', () => {
    const states: InformationCarouselLifecycleState[] = [];
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const schedule = vi.fn((_callback: () => void, _delayMs: number) => 0);
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 0,
      setScreensaver,
      onStateChange: (state) => states.push(state),
      schedule
    });

    lifecycle.dispose();
    lifecycle.setImageCount(1);

    expect(states).toEqual([]);
    expect(setScreensaver).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('enters the custom saver after the grace period and stays until interaction', async () => {
    vi.useFakeTimers();
    const states: InformationCarouselLifecycleState[] = [];
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const onCycleComplete = vi.fn();
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 2,
      setScreensaver,
      onStateChange: (state) => states.push(state),
      onCycleComplete
    });

    lifecycle.start();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(setScreensaver).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenNthCalledWith(1, false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(states.at(-1)).toEqual({ phase: 'GRACE', activeIndex: 1 });
    expect(onCycleComplete).not.toHaveBeenCalled();
    expect(setScreensaver).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(onCycleComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onCycleComplete).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenCalledOnce();
    expect(setScreensaver).toHaveBeenNthCalledWith(1, false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenCalledOnce();
    expect(onCycleComplete).toHaveBeenCalledOnce();

    lifecycle.cancel();
    await flushPromises();
    expect(states.at(-1)).toEqual({ phase: 'ROOM', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenNthCalledWith(2, true);
    lifecycle.dispose();
  });

  it('does not re-enable the device screensaver when the custom saver begins', async () => {
    vi.useFakeTimers();
    const states: InformationCarouselLifecycleState[] = [];
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const onCycleComplete = vi.fn();
    const lifecycle = createInformationCarouselLifecycle({ imageCount: 1, setScreensaver, onStateChange: (state) => states.push(state), onCycleComplete });

    lifecycle.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenCalledOnce();
    expect(setScreensaver).toHaveBeenNthCalledWith(1, false);
    expect(onCycleComplete).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onCycleComplete).toHaveBeenCalledOnce();
    expect(setScreensaver).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it('starts one new information cycle only after interaction with the custom saver', async () => {
    vi.useFakeTimers();
    const commands: boolean[] = [];
    const setScreensaver = vi.fn((enabled: boolean): Promise<void> => {
      commands.push(enabled);
      return Promise.resolve();
    });
    const onCycleComplete = vi.fn();
    const states: InformationCarouselLifecycleState[] = [];
    const lifecycle = createInformationCarouselLifecycle({ imageCount: 1, setScreensaver, onStateChange: (state) => states.push(state), onCycleComplete });

    lifecycle.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(commands).toEqual([false]);
    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });
    expect(onCycleComplete).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(commands).toEqual([false]);
    expect(states.at(-1)).toEqual({ phase: 'SAVER', activeIndex: 0 });

    lifecycle.cancel();
    await flushPromises();
    expect(commands).toEqual([false, true]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(commands).toEqual([false, true]);
    await vi.advanceTimersByTimeAsync(1);

    expect(commands).toEqual([false, true, false]);
    expect(onCycleComplete).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it('cancels stale queued timers and safely re-enables the screensaver', async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const states: InformationCarouselLifecycleState[] = [];
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 2,
      setScreensaver,
      onStateChange: (state) => states.push(state),
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length - 1;
      },
      cancelSchedule: () => undefined
    });

    lifecycle.start();
    const idleTimer = scheduled[0];
    expect(idleTimer?.delayMs).toBe(5_000);
    idleTimer?.callback();
    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 0 });

    const staleSlideTimer = scheduled[1];
    lifecycle.cancel();
    staleSlideTimer?.callback();
    await flushPromises();

    expect(states.at(-1)).toEqual({ phase: 'ROOM', activeIndex: 0 });
    expect(setScreensaver).toHaveBeenNthCalledWith(1, false);
    expect(setScreensaver).toHaveBeenNthCalledWith(2, true);
  });

  it('schedules configured inactivity and slide intervals', () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 1,
      inactivityMs: 1_000,
      slideIntervalMs: 2_000,
      setScreensaver: async () => undefined,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length - 1;
      },
      cancelSchedule: () => undefined
    });

    lifecycle.start();
    scheduled[0]?.callback();
    expect(scheduled[0]?.delayMs).toBe(1_000);
    expect(scheduled[1]?.delayMs).toBe(2_000);
    scheduled[1]?.callback();
    expect(scheduled[2]?.delayMs).toBe(2_000);
    lifecycle.dispose();
  });

  it('updates timing in place without leaving a stale cycle active', async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const states: InformationCarouselLifecycleState[] = [];
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 1,
      inactivityMs: 1_000,
      slideIntervalMs: 2_000,
      setScreensaver,
      onStateChange: (state) => states.push(state),
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length - 1;
      },
      cancelSchedule: () => undefined
    });

    lifecycle.start();
    scheduled[0]?.callback();
    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 0 });

    lifecycle.setTiming({ inactivityMs: 3_000, slideIntervalMs: 4_000 });
    expect(states.at(-1)).toEqual({ phase: 'ROOM', activeIndex: 0 });
    expect(scheduled.at(-1)?.delayMs).toBe(3_000);

    scheduled[1]?.callback();
    expect(states.at(-1)).toEqual({ phase: 'ROOM', activeIndex: 0 });

    scheduled[2]?.callback();
    expect(states.at(-1)).toEqual({ phase: 'IMAGE', activeIndex: 0 });
    expect(scheduled.at(-1)?.delayMs).toBe(4_000);
    await flushPromises();
    expect(setScreensaver).toHaveBeenNthCalledWith(1, false);
    expect(setScreensaver).toHaveBeenNthCalledWith(2, true);
    expect(setScreensaver).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
  });

  it('serializes screensaver commands so a newer cycle ends with the latest requested state', async () => {
    vi.useFakeTimers();
    const resolvers: Array<() => void> = [];
    const commands: boolean[] = [];
    const setScreensaver = vi.fn((enabled: boolean) => {
      commands.push(enabled);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    });
    const lifecycle = createInformationCarouselLifecycle({ imageCount: 2, setScreensaver });

    lifecycle.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(commands).toEqual([false]);

    lifecycle.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(commands).toEqual([false]);

    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toEqual([false, true]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(commands).toEqual([false, true]);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toEqual([false, true, false]);

    resolvers.shift()?.();
    lifecycle.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toEqual([false, true, false, true]);
    resolvers.shift()?.();
    lifecycle.dispose();
  });

  it('does not control the screensaver or complete when the image set is empty', async () => {
    vi.useFakeTimers();
    const setScreensaver = vi.fn(async (_enabled: boolean) => undefined);
    const onCycleComplete = vi.fn();
    const lifecycle = createInformationCarouselLifecycle({ imageCount: 0, setScreensaver, onCycleComplete });

    lifecycle.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(setScreensaver).not.toHaveBeenCalled();
    expect(onCycleComplete).not.toHaveBeenCalled();
    lifecycle.dispose();
  });
});

describe('information image refresh lifecycle', () => {
  it('ignores a slow result from an old manifest after a newer refresh starts', async () => {
    const pending = new Map<string, { resolve: (value: LoadedInformationImage) => void }>();
    const loaded = vi.fn<(images: LoadedInformationImage[]) => void>();
    const disposeLoaded = vi.fn<(image: LoadedInformationImage) => void>();
    const coordinator = createInformationImageLoadCoordinator({
      load: (image) => new Promise<LoadedInformationImage>((resolve) => {
        pending.set(image.id, { resolve });
      }),
      onLoaded: loaded,
      disposeLoaded
    });
    const oldImage = createLoadedImage('old-image');
    const newImage = createLoadedImage('new-image');

    coordinator.refresh('old-manifest', [oldImage.image]);
    coordinator.refresh('new-manifest', [newImage.image]);
    pending.get('old-image')?.resolve(oldImage);
    await flushPromises();
    expect(loaded).not.toHaveBeenCalled();
    expect(disposeLoaded).toHaveBeenCalledOnce();
    expect(disposeLoaded).toHaveBeenCalledWith(oldImage);

    pending.get('new-image')?.resolve(newImage);
    await flushPromises();
    expect(loaded).toHaveBeenCalledOnce();
    expect(loaded).toHaveBeenCalledWith([newImage]);
    coordinator.dispose();
  });

  it('aborts the previous manifest request when a refresh starts without reporting its cancellation', async () => {
    const signals: AbortSignal[] = [];
    const loaded = vi.fn<(images: LoadedInformationImage[]) => void>();
    const errors = vi.fn();
    const coordinator = createInformationImageLoadCoordinator({
      load: (_image, signal) => {
        signals.push(signal);
        return new Promise<LoadedInformationImage>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
        });
      },
      onLoaded: loaded,
      onError: errors
    });
    const oldImage = createLoadedImage('old-image');
    const newImage = createLoadedImage('new-image');

    coordinator.refresh('old-manifest', [oldImage.image]);
    const oldSignal = signals[0];
    coordinator.refresh('new-manifest', [newImage.image]);
    const newSignal = signals[1];

    expect(oldSignal?.aborted).toBe(true);
    expect(newSignal).not.toBe(oldSignal);
    expect(newSignal?.aborted).toBe(false);
    await flushPromises();
    expect(loaded).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    coordinator.dispose();
    expect(newSignal?.aborted).toBe(true);
    await flushPromises();
    expect(loaded).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('aborts the active manifest request when disposed', () => {
    const signals: AbortSignal[] = [];
    const coordinator = createInformationImageLoadCoordinator({
      load: (_image, signal) => {
        signals.push(signal);
        return new Promise<LoadedInformationImage>(() => undefined);
      },
      onLoaded: vi.fn()
    });
    const image = createLoadedImage('active-image');

    coordinator.refresh('active-manifest', [image.image]);
    const activeSignal = signals[0];
    coordinator.dispose();

    expect(activeSignal?.aborted).toBe(true);
  });
});

function createLoadedImage(id: string): LoadedInformationImage {
  return {
    image: {
      id,
      originalName: `${id}.png`,
      mimeType: 'image/png',
      byteSize: 1,
      displayOrder: 1,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z'
    },
    source: `blob:${id}`
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function createObservableOverlayEvent(order: string[]): {
  prevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
} {
  return {
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
      order.push('prevent');
    },
    stopPropagation() {
      this.stopped = true;
      order.push('stop');
    }
  };
}
