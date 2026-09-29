import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { InformationImageDTO, InformationImageLanguage, InformationImageVariant } from '@hotel/shared';
import { fetchDeviceInformationImageContent, isDeviceAuthFailure, setDeviceInformationScreensaver } from '../../api';

export const INFORMATION_CAROUSEL_IDLE_MS = 5_000;
export const INFORMATION_CAROUSEL_SLIDE_MS = 5_000;
export const INFORMATION_CAROUSEL_COMPACT_MAX = 520;

export function resolveInformationImageVariant(width: number, height: number): InformationImageVariant {
  return width <= INFORMATION_CAROUSEL_COMPACT_MAX && height <= INFORMATION_CAROUSEL_COMPACT_MAX ? 'square480' : 'wide';
}

export interface InformationCarouselTiming {
  inactivityMs: number;
  slideIntervalMs: number;
}

export const DEFAULT_INFORMATION_CAROUSEL_TIMING: InformationCarouselTiming = {
  inactivityMs: INFORMATION_CAROUSEL_IDLE_MS,
  slideIntervalMs: INFORMATION_CAROUSEL_SLIDE_MS
};

export type InformationCarouselPhase = 'ROOM' | 'GRACE' | { kind: 'IMAGE'; index: number };

export function resolveInformationCarouselPhase(imageCount: number, elapsedMs: number, timing: InformationCarouselTiming = DEFAULT_INFORMATION_CAROUSEL_TIMING): InformationCarouselPhase {
  const count = normalizeImageCount(imageCount);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const normalizedTiming = normalizeInformationCarouselTiming(timing);
  if (count === 0 || elapsed < normalizedTiming.inactivityMs) return 'ROOM';

  const carouselElapsed = elapsed - normalizedTiming.inactivityMs;
  const imageIndex = Math.floor(carouselElapsed / normalizedTiming.slideIntervalMs);
  if (imageIndex < count) return { kind: 'IMAGE', index: imageIndex };
  if (carouselElapsed < (count + 1) * normalizedTiming.slideIntervalMs) return 'GRACE';
  return 'ROOM';
}

export interface LoadedInformationImage {
  image: InformationImageDTO;
  source: string;
}

export interface InformationCarouselLifecycleState {
  phase: 'ROOM' | 'IMAGE' | 'GRACE';
  activeIndex: number;
}

export interface InformationCarouselLifecycleOptions {
  imageCount: number;
  setScreensaver: (enabled: boolean) => Promise<void>;
  inactivityMs?: number;
  slideIntervalMs?: number;
  onStateChange?: (state: InformationCarouselLifecycleState) => void;
  onCycleComplete?: () => void;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
}

export interface InformationCarouselLifecycle {
  start: () => void;
  setImageCount: (imageCount: number) => void;
  setTiming: (timing: InformationCarouselTiming) => void;
  cancel: () => void;
  dispose: () => void;
}

export interface InformationImageLoadCoordinatorOptions {
  load: (image: InformationImageDTO, signal: AbortSignal) => Promise<LoadedInformationImage>;
  onLoaded: (images: LoadedInformationImage[]) => void;
  onError?: (error: unknown) => void;
  disposeLoaded?: (image: LoadedInformationImage) => void;
}

type InformationCarouselOverlayEvent = Pick<SyntheticEvent, 'preventDefault' | 'stopPropagation'>;

export interface InformationCarouselOverlayHandlers {
  block: (event: InformationCarouselOverlayEvent) => void;
  cancel: (event: InformationCarouselOverlayEvent) => void;
}

export interface InformationImageLoadCoordinator {
  refresh: (manifestKey: string, images: readonly InformationImageDTO[]) => void;
  dispose: () => void;
}

export function createInformationCarouselOverlayHandlers(onCancel: () => void): InformationCarouselOverlayHandlers {
  const block = (event: InformationCarouselOverlayEvent): void => {
    event.stopPropagation();
  };

  return {
    block,
    cancel: (event) => {
      event.preventDefault();
      block(event);
      onCancel();
    }
  };
}

export function createInformationCarouselLifecycle(options: InformationCarouselLifecycleOptions): InformationCarouselLifecycle {
  const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let imageCount = normalizeImageCount(options.imageCount);
  let timing = normalizeInformationCarouselTiming({
    inactivityMs: options.inactivityMs ?? INFORMATION_CAROUSEL_IDLE_MS,
    slideIntervalMs: options.slideIntervalMs ?? INFORMATION_CAROUSEL_SLIDE_MS
  });
  let phase: InformationCarouselLifecycleState['phase'] = 'ROOM';
  let activeIndex = 0;
  let started = false;
  let disposed = false;
  let cycleActive = false;
  let generation = 0;
  let cycleId = 0;
  let timerHandle: unknown = null;
  let desiredScreensaverEnabled = true;
  let commandTail = Promise.resolve();

  const emitState = (): void => {
    options.onStateChange?.({ phase, activeIndex });
  };

  const clearTimer = (): void => {
    if (timerHandle === null) return;
    cancelSchedule(timerHandle);
    timerHandle = null;
  };

  const invalidateTimers = (): void => {
    generation += 1;
    clearTimer();
  };

  const queueScreensaverCommand = (enabled: boolean): Promise<void> => {
    if (desiredScreensaverEnabled === enabled) return commandTail;
    desiredScreensaverEnabled = enabled;
    const command = commandTail.then(() => options.setScreensaver(enabled));
    commandTail = command.catch(() => undefined);
    return commandTail;
  };

  const scheduleTimer = (
    delayMs: number,
    expectedGeneration: number,
    callback: () => void,
    expectedCycleId?: number,
    expectedPhase?: InformationCarouselLifecycleState['phase']
  ): void => {
    clearTimer();
    timerHandle = schedule(() => {
      timerHandle = null;
      if (disposed || generation !== expectedGeneration) return;
      if (expectedCycleId !== undefined && cycleId !== expectedCycleId) return;
      if (expectedPhase !== undefined && phase !== expectedPhase) return;
      callback();
    }, delayMs);
  };

  const scheduleInactivity = (): void => {
    if (disposed || !started || imageCount === 0 || phase !== 'ROOM') return;
    scheduleTimer(timing.inactivityMs, generation, () => startCycle(generation));
  };

  const completeCycle = (expectedGeneration: number, expectedCycleId: number): void => {
    if (disposed || generation !== expectedGeneration || cycleId !== expectedCycleId || phase !== 'GRACE') return;

    cycleActive = false;
    phase = 'ROOM';
    activeIndex = 0;
    generation += 1;
    emitState();

    const completionGeneration = generation;
    const reenable = queueScreensaverCommand(true);
    options.onCycleComplete?.();
    void reenable.then(() => {
      if (disposed) return;
      if (generation === completionGeneration) scheduleInactivity();
    });
  };

  const advanceCycle = (expectedGeneration: number, expectedCycleId: number): void => {
    if (disposed || generation !== expectedGeneration || cycleId !== expectedCycleId || phase !== 'IMAGE') return;

    if (activeIndex + 1 < imageCount) {
      activeIndex += 1;
      emitState();
      scheduleTimer(timing.slideIntervalMs, expectedGeneration, () => advanceCycle(expectedGeneration, expectedCycleId), expectedCycleId, 'IMAGE');
      return;
    }

    phase = 'GRACE';
    emitState();
    scheduleTimer(timing.slideIntervalMs, expectedGeneration, () => completeCycle(expectedGeneration, expectedCycleId), expectedCycleId, 'GRACE');
  };

  function startCycle(expectedGeneration: number): void {
    if (disposed || generation !== expectedGeneration || imageCount === 0 || phase !== 'ROOM') return;

    cycleActive = true;
    cycleId += 1;
    phase = 'IMAGE';
    activeIndex = 0;
    emitState();
    void queueScreensaverCommand(false);
    scheduleTimer(timing.slideIntervalMs, expectedGeneration, () => advanceCycle(expectedGeneration, cycleId), cycleId, 'IMAGE');
  }

  const setImageCount = (nextImageCount: number): void => {
    if (disposed) return;

    const normalizedCount = normalizeImageCount(nextImageCount);
    if (normalizedCount === imageCount) return;

    const wasRunning = cycleActive || phase !== 'ROOM' || !desiredScreensaverEnabled;
    invalidateTimers();
    imageCount = normalizedCount;
    cycleActive = false;
    phase = 'ROOM';
    activeIndex = 0;
    emitState();
    if (wasRunning) void queueScreensaverCommand(true);
    scheduleInactivity();
  };

  const setTiming = (nextTiming: InformationCarouselTiming): void => {
    if (disposed) return;
    const normalizedTiming = normalizeInformationCarouselTiming(nextTiming);
    if (normalizedTiming.inactivityMs === timing.inactivityMs && normalizedTiming.slideIntervalMs === timing.slideIntervalMs) return;

    const wasRunning = cycleActive || phase !== 'ROOM' || !desiredScreensaverEnabled;
    timing = normalizedTiming;
    invalidateTimers();
    cycleActive = false;
    phase = 'ROOM';
    activeIndex = 0;
    emitState();
    if (wasRunning) void queueScreensaverCommand(true);
    scheduleInactivity();
  };

  const cancel = (): void => {
    if (disposed) return;

    const wasRunning = cycleActive || phase !== 'ROOM' || !desiredScreensaverEnabled;
    invalidateTimers();
    cycleActive = false;
    phase = 'ROOM';
    activeIndex = 0;
    emitState();
    if (wasRunning) void queueScreensaverCommand(true);
    scheduleInactivity();
  };

  const dispose = (): void => {
    if (disposed) return;

    const wasRunning = cycleActive || phase !== 'ROOM' || !desiredScreensaverEnabled;
    invalidateTimers();
    cycleActive = false;
    phase = 'ROOM';
    activeIndex = 0;
    disposed = true;
    if (wasRunning) void queueScreensaverCommand(true);
  };

  return {
    start: () => {
      if (disposed || started) return;
      started = true;
      scheduleInactivity();
    },
    setImageCount,
    setTiming,
    cancel,
    dispose
  };
}

export function createInformationImageLoadCoordinator(options: InformationImageLoadCoordinatorOptions): InformationImageLoadCoordinator {
  let generation = 0;
  let activeManifestKey = '';
  let activeController: AbortController | undefined;

  const disposeLoaded = (images: LoadedInformationImage[]): void => {
    images.forEach((image) => options.disposeLoaded?.(image));
  };

  const refresh = (manifestKey: string, images: readonly InformationImageDTO[]): void => {
    generation += 1;
    const requestGeneration = generation;
    activeManifestKey = manifestKey;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    if (images.length === 0) {
      options.onLoaded([]);
      return;
    }

    void Promise.allSettled(images.map((image) => options.load(image, controller.signal))).then((results) => {
      const loadedImages = results.filter(isFulfilled).map((result) => result.value);
      const rejectedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      const isCurrent = requestGeneration === generation && activeManifestKey === manifestKey;
      if (!isCurrent) {
        disposeLoaded(loadedImages);
        return;
      }
      if (rejectedResult !== undefined) {
        disposeLoaded(loadedImages);
        options.onError?.(rejectedResult.reason);
        return;
      }
      options.onLoaded(loadedImages);
    });
  };

  return {
    refresh,
    dispose: () => {
      generation += 1;
      activeManifestKey = '';
      activeController?.abort();
      activeController = undefined;
    }
  };
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled';
}

function normalizeImageCount(imageCount: number): number {
  return Number.isFinite(imageCount) ? Math.max(0, Math.floor(imageCount)) : 0;
}

function normalizeInformationCarouselTiming(timing: InformationCarouselTiming): InformationCarouselTiming {
  return {
    inactivityMs: normalizeDurationMs(timing.inactivityMs, INFORMATION_CAROUSEL_IDLE_MS),
    slideIntervalMs: normalizeDurationMs(timing.slideIntervalMs, INFORMATION_CAROUSEL_SLIDE_MS)
  };
}

function normalizeDurationMs(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readViewportSize(): { width: number; height: number } | null {
  if (typeof window === 'undefined') return null;
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface InformationCarouselProps {
  images: InformationImageDTO[];
  locale?: InformationImageLanguage;
  deviceToken: string;
  onAuthFailure: () => void;
  onCycleComplete?: (() => void) | undefined;
  inactivityMs?: number;
  slideIntervalMs?: number;
  children: ReactNode;
}

export function InformationCarousel({ images, locale = 'es', deviceToken, onAuthFailure, onCycleComplete, inactivityMs, slideIntervalMs, children }: InformationCarouselProps) {
  const [loadedImages, setLoadedImages] = useState<LoadedInformationImage[]>([]);
  const [loadedManifestKey, setLoadedManifestKey] = useState('');
  const [experience, setExperience] = useState<InformationCarouselLifecycleState['phase']>('ROOM');
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewportSize, setViewportSize] = useState(() => readViewportSize());
  const lifecycleRef = useRef<InformationCarouselLifecycle | null>(null);
  const screensaverHandlerRef = useRef<(enabled: boolean) => Promise<void>>(() => Promise.resolve());
  const cycleCompleteRef = useRef<(() => void) | undefined>(undefined);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const imageVariant = viewportSize === null ? 'wide' : resolveInformationImageVariant(viewportSize.width, viewportSize.height);
  const imageKey = useMemo(() => `${locale}:${imageVariant}:${images.map((image) => `${image.id}:${image.updatedAt}`).join('|')}`, [imageVariant, images, locale]);

  const setScreensaver = useCallback(async (enabled: boolean): Promise<void> => {
    try {
      await setDeviceInformationScreensaver(enabled, deviceToken);
    } catch (error) {
      if (isDeviceAuthFailure(error)) onAuthFailure();
    }
  }, [deviceToken, onAuthFailure]);

  screensaverHandlerRef.current = setScreensaver;
  cycleCompleteRef.current = onCycleComplete;

  useEffect(() => {
    const updateViewportSize = (): void => setViewportSize(readViewportSize());
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  const handleLifecycleStateChange = useCallback((state: InformationCarouselLifecycleState): void => {
    setExperience(state.phase);
    setActiveIndex(state.activeIndex);
  }, []);

  useEffect(() => {
    const lifecycle = createInformationCarouselLifecycle({
      imageCount: 0,
      inactivityMs: inactivityMs ?? DEFAULT_INFORMATION_CAROUSEL_TIMING.inactivityMs,
      slideIntervalMs: slideIntervalMs ?? DEFAULT_INFORMATION_CAROUSEL_TIMING.slideIntervalMs,
      setScreensaver: (enabled) => screensaverHandlerRef.current(enabled),
      onStateChange: handleLifecycleStateChange,
      onCycleComplete: () => cycleCompleteRef.current?.()
    });
    lifecycleRef.current = lifecycle;
    lifecycle.start();
    return () => {
      lifecycle.dispose();
      lifecycleRef.current = null;
    };
  }, [handleLifecycleStateChange]);

  useEffect(() => {
    lifecycleRef.current?.setTiming({
      inactivityMs: inactivityMs ?? DEFAULT_INFORMATION_CAROUSEL_TIMING.inactivityMs,
      slideIntervalMs: slideIntervalMs ?? DEFAULT_INFORMATION_CAROUSEL_TIMING.slideIntervalMs
    });
  }, [inactivityMs, slideIntervalMs]);

  useEffect(() => {
    lifecycleRef.current?.setImageCount(0);
    setLoadedImages([]);
    setLoadedManifestKey('');
  }, [imageKey]);

  useEffect(() => {
    const objectUrls = new Set<string>();
    const coordinator = createInformationImageLoadCoordinator({
      load: async (image, signal): Promise<LoadedInformationImage> => {
        const blob = await fetchDeviceInformationImageContent(image.id, deviceToken, { signal, language: locale, variant: imageVariant });
        const source = URL.createObjectURL(blob);
        objectUrls.add(source);
        return { image, source };
      },
      onLoaded: (nextImages) => {
        setLoadedImages(nextImages);
        setLoadedManifestKey(imageKey);
      },
      onError: (error) => {
        if (isDeviceAuthFailure(error)) onAuthFailure();
        setLoadedImages([]);
        setLoadedManifestKey(imageKey);
      },
      disposeLoaded: ({ source }) => {
        URL.revokeObjectURL(source);
        objectUrls.delete(source);
      }
    });

    coordinator.refresh(imageKey, imagesRef.current);
    return () => {
      coordinator.dispose();
      objectUrls.forEach((source) => URL.revokeObjectURL(source));
    };
  }, [deviceToken, imageKey, imageVariant, locale, onAuthFailure]);

  useEffect(() => {
    const currentImageCount = loadedManifestKey === imageKey ? loadedImages.length : 0;
    lifecycleRef.current?.setImageCount(currentImageCount);
  }, [imageKey, loadedImages.length, loadedManifestKey]);

  const handleActivity = useCallback((): void => {
    lifecycleRef.current?.cancel();
  }, []);

  const { block: handleOverlayPointerDown, cancel: handleOverlayCancel } = useMemo(
    () => createInformationCarouselOverlayHandlers(handleActivity),
    [handleActivity]
  );

  const activeImage = loadedImages[activeIndex];

  return (
    <div className="information-experience" onPointerDown={handleActivity} onTouchStart={handleActivity} onKeyDown={handleActivity}>
      {children}
      {experience !== 'ROOM' && activeImage !== undefined && (
        <div
          key={`${activeImage.image.id}:${activeIndex}`}
          className={`information-carousel${experience === 'GRACE' ? ' information-carousel--grace' : ''}`}
          role="region"
          aria-label="Guest information"
          tabIndex={-1}
          data-information-carousel="true"
          data-information-carousel-state={experience.toLowerCase()}
          onPointerDown={handleOverlayPointerDown}
          onTouchStart={handleOverlayPointerDown}
          onPointerCancel={handleOverlayCancel}
          onKeyDown={handleOverlayCancel}
          onClick={handleOverlayCancel}
        >
          <img className="information-carousel__image" src={activeImage.source} alt={activeImage.image.originalName} />
        </div>
      )}
    </div>
  );
}
