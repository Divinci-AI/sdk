/**
 * AnimatedHeart — the Divinci heart rendered in code (not baked into the GLB)
 * so it can be alive: it slowly phases through brand colors, is slightly
 * transparent, and gently pulses.
 */

import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MutableRefObject } from "react";
import type { RobotSignals } from "./useRobotSignals.js";

export interface AnimatedHeartProps {
  position?: [number, number, number];
  scale?: number;
  cycleSeconds?: number;
  opacity?: number;
  stretchY?: number;
  sig?: MutableRefObject<RobotSignals>;
}

function makeHeartGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.3);
  s.bezierCurveTo(0, 0.3, -0.2, 0, -0.5, 0);
  s.bezierCurveTo(-0.95, 0, -0.95, 0.5, -0.95, 0.5);
  s.bezierCurveTo(-0.95, 0.78, -0.6, 1.05, 0, 1.35);
  s.bezierCurveTo(0.6, 1.05, 0.95, 0.78, 0.95, 0.5);
  s.bezierCurveTo(0.95, 0.5, 0.95, 0, 0.5, 0);
  s.bezierCurveTo(0.2, 0, 0, 0.3, 0, 0.3);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.55,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.14,
    bevelSegments: 5,
    curveSegments: 28,
  });
  geo.center();
  geo.rotateZ(Math.PI);
  return geo;
}

export function AnimatedHeart({
  position = [0, 0.2, 0.45],
  scale = 0.5,
  cycleSeconds = 6,
  opacity = 0.8,
  stretchY = 1,
  sig,
}: AnimatedHeartProps): React.ReactElement {
  const geometry = useMemo(makeHeartGeometry, []);
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const t = performance.now() / 1000;
    const s = sig?.current;
    const reduced = s?.reduced ?? false;
    // Reduced motion: hold a static mid-cycle color, no hue drift / pulse / bob.
    const phase = reduced ? 0 : Math.sin((t * 2 * Math.PI) / cycleSeconds);
    const hue = (0.89 + 0.11 * phase) % 1;
    color.setHSL(hue, 0.7, 0.56);
    if (material.current) {
      material.current.color.copy(color);
      material.current.emissive.copy(color);
    }
    if (mesh.current) {
      if (reduced) {
        mesh.current.scale.set(scale, scale * stretchY, scale);
        mesh.current.position.y = position[1];
      } else {
        const reacting = s ? t < s.reactUntil : false;
        const pulse = 1 + (reacting ? 0.2 : 0.05) * Math.sin(t * (reacting ? 9 : 2.4));
        mesh.current.scale.set(scale * pulse, scale * stretchY * pulse, scale * pulse);
        mesh.current.position.y = position[1] + (reacting ? Math.abs(Math.sin(t * 9)) * 0.06 : 0);
      }
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry} position={position} scale={scale}>
      <meshStandardMaterial
        ref={material}
        transparent
        opacity={opacity}
        roughness={0.2}
        metalness={0.0}
        emissiveIntensity={0.35}
        depthWrite={false}
      />
    </mesh>
  );
}
