/**
 * Root-group motion for the robot: gentle bob, a light body-lean toward the
 * page pointer (the head leads the actual gaze), and springy reactions to
 * keystrokes / idle fidgets. Per-part motion (head, eyes, antennae, arms,
 * feet, heart) is layered on top by the individual parts.
 */

import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RefObject, MutableRefObject } from "react";
import type { AvatarState } from "../types.js";
import { BASE_BODY_YAW, type RobotSignals } from "./useRobotSignals.js";

const { damp } = THREE.MathUtils;

export function useGroupMotion(
  ref: RefObject<THREE.Object3D | null>,
  state: AvatarState,
  autoRotate: boolean,
  sig: MutableRefObject<RobotSignals>
): void {
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;

    const t = performance.now() / 1000;
    const dt = Math.min(delta, 0.05);
    const s = sig.current;

    // Reduced motion: settle to a still rest pose, keeping only the gentle
    // gaze lean (cursor-/speaker-driven, not autonomous animation).
    if (s.reduced) {
      g.position.y = damp(g.position.y, 0, 7, dt);
      g.scale.setScalar(damp(g.scale.x, 1, 7, dt));
      g.rotation.z = damp(g.rotation.z, 0, 6, dt);
      g.rotation.y = damp(g.rotation.y, BASE_BODY_YAW + s.lookX * 0.1, 5, dt);
      return;
    }

    const thinking = state === "thinking";
    const happy = state === "happy";
    const reacting = t < s.reactUntil;
    const fidgeting = t < s.fidgetUntil;

    const bobSpeed = thinking ? 4.2 : reacting ? 9 : 1.6;
    const bobAmp = happy ? 0.1 : reacting ? 0.13 : fidgeting ? 0.07 : 0.035;
    g.position.y = Math.sin(t * bobSpeed) * bobAmp;

    const targetScale = happy || reacting ? 1 + Math.abs(Math.sin(t * 8)) * 0.05 : 1;
    g.scale.setScalar(damp(g.scale.x, targetScale, 7, dt));

    if (autoRotate) {
      g.rotation.y += dt * 0.6;
    } else {
      g.rotation.y = damp(g.rotation.y, BASE_BODY_YAW + s.lookX * 0.1, 5, dt);
    }

    const tilt = reacting ? Math.sin(t * 9) * 0.12 : fidgeting ? Math.sin(t * 2.5) * 0.06 : 0;
    g.rotation.z = damp(g.rotation.z, tilt, 6, dt);
  });
}
