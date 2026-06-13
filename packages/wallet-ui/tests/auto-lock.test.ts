import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoLockController } from "../src/auto-lock.js";

describe("createAutoLockController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks after the configured idle timeout", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const controller = createAutoLockController({ timeoutMs: 100, onLock });

    controller.start();
    vi.advanceTimersByTime(99);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("resets the idle timeout on activity", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const controller = createAutoLockController({ timeoutMs: 100, onLock });

    controller.start();
    vi.advanceTimersByTime(70);
    controller.poke();
    vi.advanceTimersByTime(70);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
