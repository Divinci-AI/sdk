/**
 * useRenderGate — shared "should the robot render right now?" gate.
 *
 * Returns `active: false` when any of these hold:
 *  - the container is scrolled out of the viewport (IntersectionObserver)
 *  - the tab is hidden (visibilitychange)
 *  - the user has been idle for `idleMs` (optional; pass 0/undefined to skip)
 *
 * Consumers feed `active` into RobotScene's `paused` prop, which sets the R3F
 * frameloop to "never" — the WebGL context stays alive but stops burning
 * GPU/battery. This generalizes the SDK docs hero's gate controller so the web
 * app / agent panel / extension iframe get the same behavior for free.
 *
 * Lives in the light entry: React-only, no three.js.
 */

import { useEffect, useState } from "react";

export interface RenderGateOptions {
  /** Pause after this many ms without pointer/key/scroll activity. 0 = never. */
  idleMs?: number;
  /** IntersectionObserver threshold for "visible" (default 0.05). */
  threshold?: number;
}

export interface RenderGate<T extends HTMLElement> {
  /**
   * Attach to the element wrapping the canvas. A callback ref (not a ref
   * object) so the type is identical under react 18 and 19 typings.
   */
  ref: (node: T | null) => void;
  /** True when the robot should animate. */
  active: boolean;
}

export function useRenderGate<T extends HTMLElement = HTMLDivElement>(
  options: RenderGateOptions = {}
): RenderGate<T> {
  const { idleMs = 0, threshold = 0.05 } = options;
  const [node, setNode] = useState<T | null>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    let visible = true;
    let shown = !document.hidden;
    let idle = false;
    let idleTimer: number | undefined;

    const recompute = (): void => {
      setActive(visible && shown && !idle);
    };

    const bumpIdle = (): void => {
      if (!idleMs) return;
      if (idle) {
        idle = false;
        recompute();
      }
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        idle = true;
        recompute();
      }, idleMs);
    };

    let io: IntersectionObserver | undefined;
    if (node && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting);
          recompute();
        },
        { threshold }
      );
      io.observe(node);
    }

    const onVisibility = (): void => {
      shown = !document.hidden;
      recompute();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const activityEvents = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    if (idleMs) {
      activityEvents.forEach((ev) => window.addEventListener(ev, bumpIdle, { passive: true }));
      bumpIdle();
    }

    recompute();
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleMs) {
        activityEvents.forEach((ev) => window.removeEventListener(ev, bumpIdle));
        window.clearTimeout(idleTimer);
      }
    };
  }, [node, idleMs, threshold]);

  return { ref: setNode, active };
}
