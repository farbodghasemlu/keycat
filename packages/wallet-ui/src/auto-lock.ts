export type AutoLockController = {
  start(): void;
  stop(): void;
  poke(): void;
  lockNow(): void;
};

export type AutoLockControllerOptions = {
  timeoutMs: number;
  onLock(): void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
};

export function createAutoLockController({
  timeoutMs,
  onLock,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
}: AutoLockControllerOptions): AutoLockController {
  let active = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      timer = undefined;
    }
  }

  function schedule() {
    clearTimer();
    if (!active || timeoutMs <= 0) {
      return;
    }
    timer = setTimeoutFn(() => {
      timer = undefined;
      if (active) {
        onLock();
      }
    }, timeoutMs);
  }

  return {
    start() {
      active = true;
      schedule();
    },
    stop() {
      active = false;
      clearTimer();
    },
    poke() {
      schedule();
    },
    lockNow() {
      clearTimer();
      if (active) {
        onLock();
      }
    }
  };
}
