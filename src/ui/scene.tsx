import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Vector3, TOUCH, Matrix4, InstancedMesh } from "three";
import { characterIds } from "../core/contracts";
import {
  rooms,
  desks,
  destination as actorDestination,
  planRoute,
} from "./navigation";
import {
  initialQuality,
  adaptQuality,
  profiles,
  type Quality,
} from "./quality";
import type { ComponentRef, RefObject } from "react";
function Box({
  at,
  size,
  color,
  metalness = 0,
}: {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  metalness?: number;
}) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={metalness ? 0.35 : 0.75}
      />
    </mesh>
  );
}
function Desk({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <Box at={[x, 0.85, z]} size={[1.6, 0.12, 0.85]} color="#665341" />
      <Box at={[x, 1.18, z - 0.26]} size={[0.85, 0.48, 0.04]} color="#1a322b" />
      <Box at={[x, 1.18, z - 0.23]} size={[0.75, 0.38, 0.02]} color="#6b9d80" />
      <Box at={[x, 0.45, z + 0.6]} size={[0.55, 0.15, 0.55]} color="#293a35" />
      <Box at={[x, 0.75, z + 0.84]} size={[0.55, 0.55, 0.08]} color="#293a35" />
    </group>
  );
}
function DeskLegs() {
  const ref = useRef<InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    desks.forEach(([x, z], i) => {
      mesh.setMatrixAt(i * 2, matrix.makeTranslation(x - 0.65, 0.4, z));
      mesh.setMatrixAt(i * 2 + 1, matrix.makeTranslation(x + 0.65, 0.4, z));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, desks.length * 2]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[0.08, 0.8, 0.6]} />
      <meshStandardMaterial color="#35413d" metalness={0.5} roughness={0.35} />
    </instancedMesh>
  );
}
function Person({
  index,
  state,
  prayer,
  coffee,
  decorative,
  onSelect,
}: {
  index: number;
  state: string;
  prayer: boolean;
  coffee: boolean;
  decorative: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<Group>(null);
  const position = useRef(
    new Vector3(desks[index][0], 0, desks[index][1] + 0.65),
  );
  const destination = useMemo(() => {
    const [x, z] = actorDestination(index, state, prayer, coffee);
    return new Vector3(x, 0, z);
  }, [index, state, prayer, coffee]);
  const path = useRef<Vector3[]>([]);
  const moving = useRef(false);
  const leftLeg = useRef<Group>(null),
    rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null),
    rightArm = useRef<Group>(null);
  const [reduced, setReduced] = useState(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const current = position.current;
    path.current = planRoute(
      [current.x, current.z],
      [destination.x, destination.z],
    ).map(([x, z]) => new Vector3(x, 0, z));
    // A blocked destination leaves the character at its last valid location.
  }, [destination]);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const point = path.current[0];
    moving.current = !!point && position.current.distanceTo(point) > 0.05;
    if (point) {
      const distance = position.current.distanceTo(point);
      if (distance < 0.05) path.current.shift();
      else {
        const dir = point.clone().sub(position.current).normalize();
        position.current.addScaledVector(
          dir,
          Math.min(distance, Math.min(delta, 0.1) * (reduced ? 5 : 1.6)),
        );
        ref.current.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
    ref.current.position.copy(position.current);
    ref.current.position.y =
      reduced || !decorative
        ? 0
        : moving.current
          ? Math.sin(clock.elapsedTime * 11 + index) * 0.035
          : Math.sin(clock.elapsedTime * 1.8 + index) * 0.009;
    const walk =
      !reduced && decorative && moving.current
        ? Math.sin(clock.elapsedTime * 10 + index) * 0.5
        : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = walk;
    if (rightLeg.current) rightLeg.current.rotation.x = -walk;
    const gesture =
      !reduced && decorative && !moving.current
        ? Math.sin(clock.elapsedTime * 4 + index) * 0.08
        : 0;
    if (leftArm.current)
      leftArm.current.rotation.x = moving.current ? -walk * 0.7 : gesture;
    if (rightArm.current)
      rightArm.current.rotation.x =
        index === 7 && state === "DISCORD"
          ? -1.5
          : moving.current
            ? walk * 0.7
            : gesture;
  });
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(characterIds[index]);
      }}
    >
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.35, 4, 8]} />
        <meshStandardMaterial
          color={
            index === 7
              ? "#b1a087"
              : index === 6
                ? "#677d70"
                : [
                    "#627f89",
                    "#788369",
                    "#807060",
                    "#696983",
                    "#768e80",
                    "#837a66",
                  ][index]
          }
        />
      </mesh>
      <mesh position={[0, 1.32, 0]} castShadow>
        <sphereGeometry
          args={[0.15, decorative ? 12 : 8, decorative ? 12 : 6]}
        />
        <meshStandardMaterial color="#c29b7c" />
      </mesh>
      <mesh position={[0, 1.42, -0.02]}>
        <sphereGeometry args={[0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#352a23" />
      </mesh>
      <group ref={leftLeg} position={[-0.085, 0.54, 0]}>
        <Box at={[0, -0.24, 0]} size={[0.12, 0.48, 0.13]} color="#26302e" />
      </group>
      <group ref={rightLeg} position={[0.085, 0.54, 0]}>
        <Box at={[0, -0.24, 0]} size={[0.12, 0.48, 0.13]} color="#26302e" />
      </group>
      <group ref={leftArm} position={[-0.22, 1.05, 0]}>
        <Box at={[0, -0.2, 0]} size={[0.08, 0.4, 0.1]} color="#7c8f83" />
      </group>
      <group ref={rightArm} position={[0.22, 1.05, 0]}>
        <Box at={[0, -0.2, 0]} size={[0.08, 0.4, 0.1]} color="#7c8f83" />
        {coffee && (
          <mesh position={[0, -0.38, 0.05]}>
            <cylinderGeometry args={[0.06, 0.05, 0.12, 8]} />
            <meshStandardMaterial color="#ddd0ad" />
          </mesh>
        )}
        {index === 7 && state === "DISCORD" && (
          <Box at={[0, -0.4, 0]} size={[0.07, 0.14, 0.03]} color="#101b19" />
        )}
      </group>
    </group>
  );
}
function CameraReset({
  reset,
  controls,
}: {
  reset: number;
  controls: RefObject<ComponentRef<typeof OrbitControls> | null>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(16, 18, 22);
    controls.current?.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.current?.update();
  }, [reset, camera, controls]);
  return null;
}
function PerformanceMonitor({
  quality,
  onQuality,
}: {
  quality: Quality;
  onQuality: (q: Quality) => void;
}) {
  const sample = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    if (document.hidden || delta > 1) {
      sample.current = { frames: 0, time: 0 };
      return;
    }
    sample.current.frames++;
    sample.current.time += delta;
    if (sample.current.time >= 2) {
      const next = adaptQuality(
        quality,
        sample.current.frames / sample.current.time,
      );
      if (next !== quality) onQuality(next);
      sample.current = { frames: 0, time: 0 };
    }
  });
  return null;
}
function MarketScreen({
  prices,
  labelHost,
  onSelect,
}: {
  prices: number[];
  labelHost: RefObject<HTMLDivElement>;
  onSelect: () => void;
}) {
  const bars = prices.slice(-28),
    lo = Math.min(...bars),
    span = Math.max(...bars) - lo || 1;
  return (
    <group
      position={[0, 2.2, -6.2]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <Box at={[0, 0, 0]} size={[5, 1.8, 0.15]} color="#101f1c" />
      {bars.map((p, i) => (
        <Box
          key={i}
          at={[-2.2 + i * 0.16, ((p - lo) / span) * 0.9 - 0.45, 0.09]}
          size={[0.12, 0.035, 0.03]}
          color="#b6d4a2"
        />
      ))}
      <Html portal={labelHost} position={[0, 0.75, 0.13]} center>
        <span className="room-label">BTCUSDT · CLOSED CANDLES</span>
      </Html>
    </group>
  );
}
export default function OfficeScene({
  state,
  prayer,
  onSelect,
  prices,
}: {
  state: string;
  prayer: boolean;
  onSelect: (id: string) => void;
  prices: number[];
}) {
  const [reset, setReset] = useState(0);
  const labelHost = useRef<HTMLDivElement>(null!);
  const [quality, setQuality] = useState<Quality>(() =>
    initialQuality(
      navigator.hardwareConcurrency ?? 4,
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    ),
  );
  const profile = profiles[quality];
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [idleSlot, setIdleSlot] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIdleSlot((s) => (s + 1) % 8), 12000);
    return () => clearInterval(timer);
  }, []);
  const low = quality === "low";
  const antialias = useRef(!low);
  return (
    <div className="office-scene">
      <div ref={labelHost} className="scene-label-layer" />
      <Canvas
        shadows={profile.shadows}
        dpr={profile.dpr}
        camera={{ position: [16, 18, 22], fov: 40 }}
        gl={{ antialias: antialias.current }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            window.dispatchEvent(new Event("byga:webgl-lost"));
          });
        }}
      >
        <color attach="background" args={["#1c2627"]} />
        <ambientLight intensity={1.2} />
        <directionalLight
          position={[8, 15, 8]}
          intensity={2.5}
          castShadow={profile.shadows}
          shadow-mapSize={[profile.shadowSize, profile.shadowSize]}
        />
        <pointLight position={[-5, 4, 2]} intensity={14} color="#d8b68b" />
        <Box at={[0, -0.35, 0]} size={[18, 0.6, 16]} color="#2f3733" />
        <Box at={[0, -0.02, 0]} size={[17.5, 0.1, 15.5]} color="#57574b" />
        {rooms.map((r) => (
          <group
            key={r.label}
            onClick={
              r.label === "Server / Data"
                ? (e) => {
                    e.stopPropagation();
                    onSelect("server-room");
                  }
                : undefined
            }
          >
            <Box
              at={[r.x, 0.06, r.z]}
              size={[r.w, 0.04, r.d]}
              color={
                r.label === "Musolla"
                  ? "#61715d"
                  : r.label === "War Room"
                    ? "#5d594b"
                    : "#4a5046"
              }
            />
            <Box
              at={[r.x, 0.8, r.z - r.d / 2]}
              size={[r.w, 1.6, 0.08]}
              color="#263b34"
            />
            <Html
              portal={labelHost}
              position={[r.x, 0.12, r.z + r.d / 2 - 0.25]}
              rotation={[-Math.PI / 2, 0, 0]}
              transform
              center
            >
              <span className="room-label">{r.label}</span>
            </Html>
          </group>
        ))}
        <DeskLegs />
        {desks.map(([x, z], i) => (
          <Desk key={i} x={x} z={z} />
        ))}
        <Box at={[5, 0.7, 1]} size={[3, 0.18, 1.4]} color="#836747" />
        {[4.1, 5, 5.9].map((x) => (
          <Box
            key={x}
            at={[x, 0.35, 1]}
            size={[0.1, 0.7, 0.1]}
            color="#303a35"
          />
        ))}
        <MarketScreen
          prices={prices}
          labelHost={labelHost}
          onSelect={() => onSelect("market-wall")}
        />
        <Html portal={labelHost} position={[-6, 2.3, 5]} center>
          <span
            className="room-label"
            style={{ fontSize: 13, color: "#c9daba" }}
          >
            BG / BYGA
          </span>
        </Html>
        {[-7.7, 7.8].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.4, 3.6]}>
              <cylinderGeometry args={[0.3, 0.22, 0.6, 12]} />
              <meshStandardMaterial color="#887e67" />
            </mesh>
            <mesh position={[x, 1, 3.6]}>
              <sphereGeometry args={[0.55, low ? 6 : 12, low ? 5 : 10]} />
              <meshStandardMaterial color="#506f44" />
            </mesh>
          </group>
        ))}
        {characterIds.map((_, i) => (
          <Person
            key={i}
            index={i}
            state={state}
            prayer={prayer}
            coffee={
              !prayer &&
              state === "MONITORING" &&
              profile.decorative &&
              i === idleSlot
            }
            decorative={profile.decorative}
            onSelect={onSelect}
          />
        ))}
        <PerformanceMonitor quality={quality} onQuality={setQuality} />
        <CameraReset reset={reset} controls={controls} />
        <OrbitControls
          ref={controls}
          onChange={() => {
            const c = controls.current;
            if (!c) return;
            const x = Math.max(-4, Math.min(4, c.target.x)),
              z = Math.max(-3, Math.min(3, c.target.z));
            c.object.position.x += x - c.target.x;
            c.object.position.z += z - c.target.z;
            c.target.set(x, 0, z);
          }}
          makeDefault
          touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }}
          target={[0, 0, 0]}
          minDistance={14}
          maxDistance={38}
          minPolarAngle={0.4}
          maxPolarAngle={1.15}
          minAzimuthAngle={-0.4}
          maxAzimuthAngle={1.3}
          enableDamping
        />
      </Canvas>
      <div className="scene-controls">
        <span className="badge">Auto · {quality}</span>
        <button onClick={() => setReset((v) => v + 1)}>↺ Reset View</button>
      </div>
    </div>
  );
}
