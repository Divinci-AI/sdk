/**
 * Shared interaction signals for the rigged robot. One window-listener setup,
 * one mutable ref every body part reads from. Provides:
 *  - lookX/lookY: where his attention should go — the cursor when it's moving,
 *    the focused input when you're typing, otherwise the user (screen center).
 *  - keystroke reactions + idle fidgets, each with a fresh random seed/style so
 *    the motion never loops identically.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { MutableRefObject } from "react";

export const BASE_BODY_YAW = 0.08;

/**
 * Optional extra gaze target, screen-normalized to -1..1. Returns null when
 * nobody is "speaking". The docs hero injects one that tracks the orbiting
 * conversation satellites; other surfaces leave it unset.
 */
export type SpeakerTarget = () => [number, number] | null;

export interface RobotSignals {
  lookX: number;
  lookY: number;
  reactUntil: number;
  reactSeed: number;
  fidgetUntil: number;
  fidgetSeed: number;
  /** Honor the OS "reduce motion" setting — freezes autonomous idle motion. */
  reduced: boolean;
}

export function useRobotSignals(speakerTarget?: SpeakerTarget): MutableRefObject<RobotSignals> {
  const sig = useRef<RobotSignals>({
    lookX: 0,
    lookY: 0,
    reactUntil: 0,
    reactSeed: 0,
    fidgetUntil: 0,
    fidgetSeed: 0,
    reduced: false,
  });
  const mouse = useRef({ x: 0, y: 0, at: -10 });
  const focus = useRef({ x: 0, y: 0, active: false });
  const nextFidget = useRef(5);

  useEffect(() => {
    const norm = (px: number, py: number): [number, number] => [
      (px / window.innerWidth) * 2 - 1,
      (py / window.innerHeight) * 2 - 1,
    ];
    const onMove = (e: MouseEvent): void => {
      const [x, y] = norm(e.clientX, e.clientY);
      mouse.current = { x, y, at: performance.now() / 1000 };
    };
    const onKey = (): void => {
      sig.current.reactUntil = performance.now() / 1000 + 0.5 + Math.random() * 0.3;
      sig.current.reactSeed = Math.random();
    };
    const onFocusIn = (e: FocusEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && typeof el.getBoundingClientRect === "function") {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) {
          const r = el.getBoundingClientRect();
          const [x, y] = norm(r.left + r.width / 2, r.top + r.height / 2);
          focus.current = { x, y, active: true };
        }
      }
    };
    const onFocusOut = (): void => {
      focus.current.active = false;
    };
    // ── prefers-reduced-motion (live) ────────────────────────────────
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    sig.current.reduced = mq?.matches ?? false;
    const onReduceChange = (e: MediaQueryListEvent): void => {
      sig.current.reduced = e.matches;
    };
    mq?.addEventListener?.("change", onReduceChange);

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      mq?.removeEventListener?.("change", onReduceChange);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useFrame(() => {
    const t = performance.now() / 1000;
    const s = sig.current;

    let tx = 0;
    let ty = 0;
    // The injected speaker target loses to a moving cursor (the user always
    // wins the robot's attention) and is ignored under reduced motion.
    const sp = s.reduced || !speakerTarget ? null : speakerTarget();
    if (t - mouse.current.at < 2.5) {
      tx = mouse.current.x;
      ty = mouse.current.y;
    } else if (sp) {
      tx = sp[0];
      ty = sp[1];
    } else if (focus.current.active) {
      tx = focus.current.x;
      ty = focus.current.y;
    }
    s.lookX += (tx - s.lookX) * 0.08;
    s.lookY += (ty - s.lookY) * 0.08;

    if (!s.reduced && t > nextFidget.current && t > s.reactUntil) {
      s.fidgetUntil = t + 1.4 + Math.random() * 0.8;
      s.fidgetSeed = Math.random();
      nextFidget.current = t + 6 + Math.random() * 8;
    }
  });

  return sig;
}
