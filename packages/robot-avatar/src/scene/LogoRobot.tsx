/**
 * LogoRobot — the Divinci mascot, hand-built in code and fully rigged.
 *
 * Structure mirrors the flat logo (open frame, NO torso):
 *  - rounded-corner head with two dark eyes + two ball-tipped antennae
 *  - two "4"-shaped arm/leg forms (mirrored): diagonal + crossbar + vertical
 *    stem, one sphere hand; a foot floats below each
 *  - the AnimatedHeart floating in the chest center
 *
 * Every part is rigged and animates independently off shared interaction
 * signals (page-wide gaze, keystroke reactions, idle fidgets).
 */

import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGroupMotion } from "./useGroupMotion.js";
import { useRobotSignals, BASE_BODY_YAW, type RobotSignals, type SpeakerTarget } from "./useRobotSignals.js";
import { AnimatedHeart } from "./AnimatedHeart.js";
import type { AvatarState, RobotAvatarColors } from "../types.js";
import type { MutableRefObject } from "react";

const { damp } = THREE.MathUtils;

function roundedRectGeometry(w: number, h: number, depth: number, r: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x, y);
  s.lineTo(x + w, y);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.26,
    bevelSize: 0.3,
    bevelSegments: 10,
    curveSegments: 24,
  });
  geo.center();
  return geo;
}

function roundedAllGeometry(w: number, h: number, depth: number, r: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.center();
  return geo;
}

function footShapeGeometry(w: number, h: number, depth: number, r: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x, y);
  s.lineTo(x + w, y);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x, y + h);
  s.lineTo(x, y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 4,
    curveSegments: 14,
  });
  geo.center();
  return geo;
}

function makeNoiseNormalMap(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128 + Math.round((Math.random() * 2 - 1) * 14);
    data[i * 4 + 1] = 128 + Math.round((Math.random() * 2 - 1) * 14);
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.needsUpdate = true;
  return tex;
}

function taperedStemGeometry(topW: number, botW: number, h: number, depth: number): THREE.ExtrudeGeometry {
  const ht = topW / 2;
  const hb = botW / 2;
  const top = h / 2;
  const bot = -h / 2;
  const hipHi = 0.0;
  const hipLo = -0.16;
  const s = new THREE.Shape();
  s.moveTo(-hb, bot);
  s.lineTo(hb, bot);
  s.lineTo(hb, hipLo);
  s.lineTo(ht, hipHi);
  s.lineTo(ht, top);
  s.lineTo(-ht, top);
  s.lineTo(-ht, hipHi);
  s.lineTo(-hb, hipLo);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.center();
  return geo;
}

function handFilletGeometry(cx: number, cy: number, rIn: number, aStart: number, aEnd: number): THREE.ExtrudeGeometry {
  const rOut = rIn + 0.08;
  const s = new THREE.Shape();
  s.moveTo(cx + Math.cos(aStart) * rOut, cy + Math.sin(aStart) * rOut);
  for (let a = aStart; a <= aEnd; a += 0.1) s.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
  for (let a = aEnd; a >= aStart; a -= 0.1) s.lineTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.36,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -0.18);
  return geo;
}

interface LimbProps {
  side: 1 | -1;
  material: THREE.Material;
  sig: MutableRefObject<RobotSignals>;
}

function FourLimb({ side, material, sig }: LimbProps): React.ReactElement {
  const arm = useRef<THREE.Group>(null);
  const foot = useRef<THREE.Mesh>(null);

  const footGeo = useMemo(() => footShapeGeometry(0.42, 0.26, 0.6, 0.13), []);
  const rightBarGeo = useMemo(() => taperedStemGeometry(0.23, 0.23, 0.96, 0.32), []);
  const prongGeo = useMemo(() => taperedStemGeometry(0.2, 0.2, 0.46, 0.28), []);
  const crossGeo = useMemo(() => roundedAllGeometry(0.68, 0.26, 0.32, 0.06), []);
  const filletGeo = useMemo(() => handFilletGeometry(-0.115, -0.359, 0.18, -0.1, Math.PI / 2 + 0.15), []);

  useFrame((_, delta) => {
    const t = performance.now() / 1000;
    const dt = Math.min(delta, 0.05);
    const s = sig.current;
    if (s.reduced) {
      if (arm.current) arm.current.rotation.z = damp(arm.current.rotation.z, 0, 9, dt);
      if (foot.current) {
        foot.current.position.y = -0.92;
        foot.current.rotation.x = 0;
      }
      return;
    }
    const reacting = t < s.reactUntil;
    const fidgeting = t < s.fidgetUntil;
    const rs = s.reactSeed;
    const fs = s.fidgetSeed;
    const reactStyle = Math.floor(rs * 3);
    const fidgetStyle = Math.floor(fs * 4);

    if (arm.current) {
      let target = Math.sin(t * 1.4 + side) * 0.05;
      if (reacting) {
        const w = reactStyle === 0 ? 1.3 : reactStyle === 1 ? 0.4 : 0.95;
        target = Math.sin(t * (8 + rs * 5) + rs * 7 + side) * (0.3 + rs * 0.25) * w;
      } else if (fidgeting) {
        const w = fidgetStyle === 3 ? 1 : 0.3;
        target = Math.sin(t * (2.4 + fs * 2) + fs * 6 + side) * (0.12 + fs * 0.15) * w;
      }
      arm.current.rotation.z = damp(arm.current.rotation.z, target, 9, dt);
    }
    if (foot.current) {
      const phase = side > 0 ? 0 : Math.PI;
      let tap = 0;
      if (reacting) {
        const w = reactStyle === 1 ? 1.4 : reactStyle === 0 ? 0.4 : 0.95;
        tap = Math.max(0, Math.sin(t * (9 + rs * 5) + phase + rs * 4)) * (0.1 + rs * 0.08) * w;
      } else if (fidgeting) {
        const w = fidgetStyle === 2 ? 1 : 0.25;
        tap = Math.max(0, Math.sin(t * (3.5 + fs * 2) + phase)) * (0.06 + fs * 0.05) * w;
      }
      foot.current.position.y = -0.92 + tap;
      foot.current.rotation.x = -tap * 1.2;
    }
  });

  return (
    <group position={[side * 0.97, 0.05, 0]} scale={[-side, 1, 1]}>
      <group ref={arm} position={[0, 0.45, 0]}>
        <group position={[0, -0.45, 0]}>
          <mesh geometry={rightBarGeo} material={material} position={[0.21, -0.02, 0]} castShadow />
          <mesh geometry={crossGeo} material={material} position={[0.01, -0.05, 0]} castShadow />
          <mesh geometry={prongGeo} material={material} position={[-0.19, 0.23, 0]} castShadow />
          <mesh geometry={filletGeo} material={material} castShadow />
          <mesh material={material} position={[-0.2, -0.48, 0]} castShadow>
            <sphereGeometry args={[0.17, 20, 20]} />
          </mesh>
        </group>
      </group>
      <mesh ref={foot} geometry={footGeo} material={material} position={[0.3, -0.92, 0.04]} castShadow />
    </group>
  );
}

function Antenna({ side, material, sig }: LimbProps): React.ReactElement {
  const grp = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = performance.now() / 1000;
    const s = sig.current;
    if (s.reduced) {
      if (grp.current) grp.current.rotation.z = 0;
      return;
    }
    const reacting = t < s.reactUntil;
    const fidgeting = t < s.fidgetUntil;
    if (grp.current) {
      const amp = reacting
        ? 0.32 + s.reactSeed * 0.3
        : fidgeting
        ? (Math.floor(s.fidgetSeed * 4) === 1 ? 0.3 : 0.12) + s.fidgetSeed * 0.08
        : 0.13;
      const spd = 2.2 + (reacting ? s.reactSeed * 3 : 0);
      const phase = side + (reacting ? s.reactSeed * 6 : 0);
      grp.current.rotation.z = Math.sin(t * spd + phase) * amp;
    }
  });
  return (
    <group ref={grp} position={[side * 0.82, 0.49, 0]}>
      <mesh material={material} position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.5, 12]} />
      </mesh>
      <mesh material={material} position={[0, 0.54, 0]}>
        <sphereGeometry args={[0.17, 18, 18]} />
      </mesh>
    </group>
  );
}

export interface LogoRobotProps {
  state: AvatarState;
  colors: RobotAvatarColors;
  autoRotate?: boolean;
  /** Optional extra gaze target (see useRobotSignals). */
  speakerTarget?: SpeakerTarget;
}

export function LogoRobot({ state, colors, autoRotate = false, speakerTarget }: LogoRobotProps): React.ReactElement {
  const sig = useRobotSignals(speakerTarget);
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);
  useGroupMotion(root, state, autoRotate, sig);

  const headGeo = useMemo(() => roundedRectGeometry(1.28, 0.71, 0.64, 0.34), []);
  const eyeGeo = useMemo(() => roundedAllGeometry(0.19, 0.3, 0.08, 0.06), []);
  const normalMap = useMemo(makeNoiseNormalMap, []);
  const bodyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: colors.body,
        roughness: 0.34,
        metalness: 0.06,
        normalMap,
        normalScale: new THREE.Vector2(0.12, 0.12),
        envMapIntensity: 0.85,
      }),
    [colors.body, normalMap]
  );

  useFrame((_, delta) => {
    const t = performance.now() / 1000;
    const dt = Math.min(delta, 0.05);
    const s = sig.current;
    const reduced = s.reduced;
    const thinking = !reduced && state === "thinking";
    const fidgeting = !reduced && t < s.fidgetUntil;

    if (head.current) {
      const nod = thinking ? Math.sin(t * 5) * 0.07 : 0;
      const glance = fidgeting && Math.floor(s.fidgetSeed * 4) === 0
        ? (s.fidgetSeed - 0.5) * 0.2 * Math.sin(t * 1.4)
        : 0;
      const gaze = Math.max(-0.6, Math.min(0.6, s.lookX)) * 0.34;
      head.current.rotation.y = damp(head.current.rotation.y, -BASE_BODY_YAW + gaze + glance, 6, dt);
      head.current.rotation.x = damp(head.current.rotation.x, 0.09 - s.lookY * 0.24 + nod, 6, dt);
    }
    // Keep the eyes open (no blink) under reduced motion; gaze dart still tracks.
    const bt = t % 3.6;
    const blink = reduced || bt >= 0.13 ? 1 : 1 - Math.sin((bt / 0.13) * Math.PI) * 0.92;
    const dartX = s.lookX * 0.045;
    const dartY = -s.lookY * 0.03;
    if (eyeL.current) {
      eyeL.current.position.x = -0.27 + dartX;
      eyeL.current.position.y = dartY;
      eyeL.current.scale.y = blink;
    }
    if (eyeR.current) {
      eyeR.current.position.x = 0.27 + dartX;
      eyeR.current.position.y = dartY;
      eyeR.current.scale.y = blink;
    }
  });

  return (
    <group ref={root}>
      <group scale={0.92} position={[0, -0.78, 0]}>
        <group ref={head} position={[0, 1.37, 0]} scale={0.85}>
          <mesh geometry={headGeo} material={bodyMaterial} castShadow />
          <mesh ref={eyeL} geometry={eyeGeo} position={[-0.27, 0.0, 0.7]}>
            <meshStandardMaterial color={colors.eye} roughness={0.25} metalness={0.2} />
          </mesh>
          <mesh ref={eyeR} geometry={eyeGeo} position={[0.27, 0.0, 0.7]}>
            <meshStandardMaterial color={colors.eye} roughness={0.25} metalness={0.2} />
          </mesh>
          <Antenna side={-1} material={bodyMaterial} sig={sig} />
          <Antenna side={1} material={bodyMaterial} sig={sig} />
        </group>

        <FourLimb side={-1} material={bodyMaterial} sig={sig} />
        <FourLimb side={1} material={bodyMaterial} sig={sig} />

        <AnimatedHeart position={[0, -0.06, 0.2]} scale={0.45} stretchY={1.18} sig={sig} />
      </group>
    </group>
  );
}
