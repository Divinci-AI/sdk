/**
 * Shared types for the RobotHero component.
 *
 * Kept in a standalone module (no React/three imports) so the light
 * wrapper can import them without pulling three.js into the main bundle.
 */

export type AvatarState = "idle" | "thinking" | "happy" | "wave";

export interface RobotAvatarColors {
  body: string;
  trim: string;
  heart: string;
  eye: string;
  shadow: string;
}
