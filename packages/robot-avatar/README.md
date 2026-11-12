# @divinci-ai/robot-avatar

The Divinci robot mascot — the procedural, rigged react-three-fiber avatar
shared by every surface that shows him:

| Surface | Wrapper |
|---|---|
| SDK docs hero (sdk.divinci.ai) | `workspace/sdk/docs/src/components/RobotHero/RobotHero.tsx` |
| Web app + Divinci Agent panel | `workspace/clients/web/src/components/RobotAvatar/RobotAvatar.tsx` |
| Chrome extension (iframe) | via the web app / a dedicated robot page (planned) |

## Entry points

- **`@divinci-ai/robot-avatar`** (light, no three.js): `AvatarState`,
  `RobotAvatarColors`, `blendHex`, `useRenderGate`. Safe for main bundles.
- **`@divinci-ai/robot-avatar/scene`** (heavy): `RobotScene`, `LogoRobot`,
  `AnimatedHeart`, `useRobotSignals`, `useGroupMotion`. **Always lazy-import**
  so three.js stays in its own chunk:

```tsx
import { lazy } from "react";
const RobotScene = lazy(() =>
  import("@divinci-ai/robot-avatar/scene").then((m) => ({ default: m.RobotScene }))
);
```

## Built-in hardening (every consumer gets these)

- `powerPreference: "low-power"` — never spins up the discrete GPU.
- `failIfMajorPerformanceCaveat: true` — refuses software WebGL (SwiftShader)
  instead of burning CPU; your error boundary shows the static fallback.
- `paused` prop → R3F `frameloop: "never"`. Pair with `useRenderGate` (pauses
  when scrolled off-screen, tab hidden, or user idle).
- `onContextLost` callback — `webglcontextlost` does not throw through React;
  listen here and swap to your static fallback.
- `prefers-reduced-motion` honored live: autonomous animation freezes to a
  rest pose; only the gentle cursor-driven gaze lean remains.
- `dpr` capped at `[1, 1.5]` by default (the mascot renders small).

## Consumer responsibilities

Each wrapper owns: color resolution (theme vars vs brand constants), the
static fallback image (Suspense placeholder + WebGL-failure fallback +
context-loss swap), and any surface-specific gaze target (`speakerTarget`).

## Version skew

Compiled against the lowest consumer versions (react 18 / three 0.169 /
r3f 8 / drei 9); peer ranges span through the docs site's react 19 / three
0.185 / r3f 9 / drei 10. Only skew-stable APIs are used (`Canvas`, `useFrame`,
`Environment`, `Lightformer`, core three geometry/materials) — check both
consumers when touching imports.
