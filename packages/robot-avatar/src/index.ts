/**
 * @divinci-ai/robot-avatar — light entry (NO three.js).
 *
 * Import this from main bundles; lazy-import "@divinci-ai/robot-avatar/scene"
 * for the WebGL chunk:
 *
 *   const RobotScene = lazy(() =>
 *     import("@divinci-ai/robot-avatar/scene").then((m) => ({ default: m.RobotScene }))
 *   );
 */

export type { AvatarState, RobotAvatarColors } from "./types.js";
export { blendHex } from "./blend.js";
export { useRenderGate, type RenderGate, type RenderGateOptions } from "./render-gate.js";
