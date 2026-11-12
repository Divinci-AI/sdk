/**
 * RobotHero — the SDK docs splash-hero wrapper around the shared
 * @divinci-ai/robot-avatar mascot.
 *
 * This file owns only what is docs-specific:
 *  - Divinci brand colors (no CSS-variable theme dependency)
 *  - the Hero.astro pause gate (window.__divinciHeroActive + event)
 *  - the "who's speaking" gaze target for the orbit satellites
 *  - the static fallback (hero logo PNG): shown while the three.js chunk
 *    loads, and permanently if WebGL fails or the GL context is lost.
 *
 * Everything else — the rigged robot, its motion/signals, the hardened
 * Canvas (low-power GPU, failIfMajorPerformanceCaveat, paused frameloop,
 * context-loss reporting) — lives in the shared package.
 */

import React, { Suspense, lazy, Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { blendHex, type RobotAvatarColors } from "@divinci-ai/robot-avatar";
import type { AvatarState } from "@divinci-ai/robot-avatar";

// ── Brand colors ────────────────────────────────────────────────────
const BRAND = {
  primary: "#4f46e5",
  primaryLight: "#818cf8",
  primaryDark: "#3730a3",
  accent: "#ec4899",
} as const;

function resolveColors(): RobotAvatarColors {
  return {
    body: blendHex("#eef1f8", BRAND.primaryLight, 0.32),
    trim: BRAND.primary,
    heart: BRAND.accent,
    eye: blendHex("#2a2c2a", BRAND.primaryDark, 0.5),
    shadow: blendHex("#0e140e", BRAND.primaryDark, 0.7),
  };
}

// ── Lazy scene chunk (three.js lives only here) ─────────────────────

const RobotScene = lazy(() =>
  import("@divinci-ai/robot-avatar/scene").then((m) => ({ default: m.RobotScene }))
);

// ── Docs-specific speaker gaze ──────────────────────────────────────
// The Hero conversation script publishes the active speaker index on
// `window.__divinciHeroSpeaker` (a satellite index, or null for the robot's
// own turn / nobody). The robot tracks that emoji so he looks at whoever's
// talking — unless the cursor is moving (the user always wins his attention).
let satEls: NodeListOf<Element> | null = null;
function heroSpeakerTarget(): [number, number] | null {
  const idx = (window as unknown as { __divinciHeroSpeaker?: number | null })
    .__divinciHeroSpeaker;
  if (typeof idx !== "number") return null;
  if (!satEls || !satEls.length) {
    satEls = document.querySelectorAll(".sdk-orbit-satellite");
  }
  const el = satEls?.[idx];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [
    ((r.left + r.width / 2) / window.innerWidth) * 2 - 1,
    ((r.top + r.height / 2) / window.innerHeight) * 2 - 1,
  ];
}

// ── Error boundary for WebGL / chunk failures ───────────────────────

class WebGLBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    // swallowed — fallback is already rendered
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── Component ───────────────────────────────────────────────────────

// ── Narrow-viewport framing ─────────────────────────────────────────
// Matches the `max-width: 50rem` breakpoint Hero.astro switches the hero to a
// single column at. On a phone the robot's slot is only ~140px across, so the
// default camera frames him tight enough that an arm swing or an antenna
// wobble leaves the canvas. Dolly back there (and only there) — desktop has
// the room already and its framing is unchanged.
const MOBILE_QUERY = "(max-width: 50rem)";
const MOBILE_CAMERA_DISTANCE = 7.5;
const DESKTOP_CAMERA_DISTANCE = 6.4;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    setNarrow(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export interface RobotHeroProps {
  state?: AvatarState;
}

export function RobotHero({ state = "idle" }: RobotHeroProps): JSX.Element {
  const colors = resolveColors();
  const narrow = useIsNarrow();
  // Pause the WebGL render loop whenever the shared hero gate says so —
  // off-screen, tab hidden, or 30s idle (see Hero.astro's gate controller).
  const [active, setActive] = useState(true);
  // `webglcontextlost` doesn't throw through React, so the boundary can't see
  // it — the scene reports it via callback and we swap to the static logo.
  const [contextLost, setContextLost] = useState(false);
  const onContextLost = useCallback(() => setContextLost(true), []);

  useEffect(() => {
    const w = window as unknown as { __divinciHeroActive?: boolean };
    setActive(w.__divinciHeroActive !== false);
    const onChange = (e: Event): void => {
      setActive(Boolean((e as CustomEvent<{ active: boolean }>).detail?.active));
    };
    window.addEventListener("divinci:hero-active", onChange);
    return () => window.removeEventListener("divinci:hero-active", onChange);
  }, []);

  // Static stand-in: shown while the three.js chunk streams in (no pop-in),
  // and permanently when WebGL is unavailable / software-rendered / lost.
  const staticFallback = (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <img
        src="/hero-logo.png"
        alt=""
        width={140}
        height={140}
        loading="eager"
        style={{ opacity: 0.9 }}
      />
    </div>
  );

  return (
    <div
      style={{
        // NO min-height. `.sdk-orbit-center` is a percentage of the hero
        // visual's aspect-ratio box, so this always has a real height — but on
        // a phone that box is ~140px, and a 240px floor made the canvas
        // overflow it by ~50px top AND bottom. The bottom overflow is what put
        // the robot's feet on top of the "Divinci AI SDK" title.
        position: "relative",
        width: "100%",
        height: "100%",
        lineHeight: 0,
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      {contextLost ? (
        staticFallback
      ) : (
        <WebGLBoundary fallback={staticFallback}>
          <Suspense fallback={staticFallback}>
            <RobotScene
              state={state}
              colors={colors}
              paused={!active}
              cameraDistance={narrow ? MOBILE_CAMERA_DISTANCE : DESKTOP_CAMERA_DISTANCE}
              onContextLost={onContextLost}
              speakerTarget={heroSpeakerTarget}
            />
          </Suspense>
        </WebGLBoundary>
      )}
    </div>
  );
}

export default RobotHero;
