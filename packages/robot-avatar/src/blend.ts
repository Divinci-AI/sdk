/**
 * Tiny hex-color blend used by consumers to derive the robot's palette from a
 * theme (web client) or brand constants (docs hero). Lives in the light entry
 * so wrappers can compute colors without touching three.js.
 */

/** Blend two hex colors; t=0 → a, t=1 → b. */
export function blendHex(a: string, b: string, t: number): string {
  const m = a.replace("#", "").trim();
  const n = b.replace("#", "").trim();
  if (m.length < 6 || n.length < 6) return a;
  const ra = [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  const rb = [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  const mix = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
  return "#" + mix.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}
