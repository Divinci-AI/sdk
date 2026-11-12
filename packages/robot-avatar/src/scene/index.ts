/**
 * @divinci-ai/robot-avatar/scene — the heavy WebGL entry (three.js et al).
 *
 * Lazy-import this from consumers so three.js stays out of the main bundle:
 *
 *   const RobotScene = lazy(() =>
 *     import("@divinci-ai/robot-avatar/scene").then((m) => ({ default: m.RobotScene }))
 *   );
 */

export { RobotScene, type RobotSceneProps } from "./RobotScene.js";
export { LogoRobot, type LogoRobotProps } from "./LogoRobot.js";
export { AnimatedHeart } from "./AnimatedHeart.js";
export { useRobotSignals, BASE_BODY_YAW, type RobotSignals, type SpeakerTarget } from "./useRobotSignals.js";
export { useGroupMotion } from "./useGroupMotion.js";
export type { AvatarState, RobotAvatarColors } from "../types.js";
