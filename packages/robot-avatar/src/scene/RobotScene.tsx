/**
 * RobotScene — the shared, hardened WebGL scene for the Divinci robot.
 *
 * Everything importing `three` / `@react-three/*` lives under ./scene so
 * consumers can code-split it (lazy import of "@divinci-ai/robot-avatar/scene").
 *
 * Hardening (applies to every surface — docs hero, web app, agent panel,
 * extension iframe):
 *  - `powerPreference: "low-power"`: a mascot never needs the discrete GPU;
 *    the default can spin up the dGPU on dual-GPU laptops.
 *  - `failIfMajorPerformanceCaveat: true`: on software WebGL (VMs, locked-down
 *    Chrome) context creation fails instead of burning CPU in SwiftShader —
 *    the consumer's error/fallback path takes over.
 *  - `paused` → frameloop "never": render loop stops while off-screen / tab
 *    hidden / idle (pair with useRenderGate from the light entry).
 *  - `onContextLost`: `webglcontextlost` does NOT throw through React, so an
 *    error boundary never sees it — this callback lets the consumer swap to
 *    its static fallback instead of showing a frozen canvas.
 *  - dpr capped at 1.5 by default: the robot renders small; the top retina
 *    tier is wasted fill.
 */

import React, { useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { LogoRobot } from "./LogoRobot.js";
import type { AvatarState, RobotAvatarColors } from "../types.js";
import type { SpeakerTarget } from "./useRobotSignals.js";

export interface RobotSceneProps {
  state: AvatarState;
  colors: RobotAvatarColors;
  /** When true, R3F stops its render loop (pair with useRenderGate). */
  paused?: boolean;
  /** Slowly auto-rotate so all sides are visible (preview / showcase use). */
  autoRotate?: boolean;
  /** Device-pixel-ratio clamp. Defaults to [1, 1.5]. */
  dpr?: [number, number];
  /**
   * How far back the camera sits (world units on +Z). Defaults to 6.4.
   *
   * The robot's rig swings well past his resting silhouette — antennae, both
   * arms, the feet — so a frame drawn tight to the idle pose clips the motion.
   * Push this out to give the animation headroom in a small viewport, where
   * the canvas is too narrow to absorb the swing.
   */
  cameraDistance?: number;
  /** Notified once if the WebGL context is lost (GPU reset, context pressure). */
  onContextLost?: () => void;
  /**
   * Optional extra gaze target (screen-normalized -1..1) the robot looks at
   * when the cursor is still — e.g. the docs hero's "who's speaking" emoji.
   */
  speakerTarget?: SpeakerTarget;
}

export function RobotScene({
  state,
  colors,
  paused = false,
  autoRotate = false,
  dpr = [1, 1.5],
  cameraDistance = 6.4,
  onContextLost,
  speakerTarget,
}: RobotSceneProps): React.ReactElement {
  const handleCreated = useCallback(
    ({ gl }: { gl: { domElement: HTMLCanvasElement } }) => {
      if (!onContextLost) return;
      gl.domElement.addEventListener(
        "webglcontextlost",
        (e: Event) => {
          e.preventDefault(); // allow restoration attempts, but tell the consumer now
          onContextLost();
        },
        { once: true }
      );
    },
    [onContextLost]
  );

  return (
    <Canvas
      camera={{ position: [0, 0, cameraDistance], fov: 34 }}
      dpr={dpr}
      frameloop={paused ? "never" : "always"}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: true,
      }}
      onCreated={handleCreated}
      style={{ width: "100%", height: "100%" }}
    >
      {/* Soft key + fill + a themed rim light (silver/neutral shading). */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 4]} intensity={0.9} />
      <directionalLight position={[-4, 2, -3]} intensity={0.35} color={colors.trim} />

      {/* Procedural studio environment (no HDR download) — gives the plastic
          soft reflections + highlights so it isn't flat matte. */}
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={2.2} position={[0, 2.5, 3]} scale={[6, 6, 1]} />
        <Lightformer intensity={0.9} position={[-3, 1, 2]} scale={[3, 4, 1]} color={colors.trim} />
        <Lightformer intensity={0.7} position={[3, -1.5, 2]} scale={[3, 3, 1]} />
      </Environment>

      <LogoRobot state={state} colors={colors} autoRotate={autoRotate} speakerTarget={speakerTarget} />
    </Canvas>
  );
}
