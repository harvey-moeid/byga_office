import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TOUCH,
  ACESFilmicToneMapping,
  BufferGeometry,
  Float32BufferAttribute,
  PMREMGenerator,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  characterIds,
  type AvatarPreset,
  type CharacterId,
} from "../core/contracts";
import { rooms } from "./navigation";
import {
  initialQuality,
  adaptQuality,
  profiles,
  type Quality,
} from "./quality";
import { OfficeEnvironment } from "./office-environment";
import { OfficeCharacter } from "./office-character";
import type { ComponentRef, RefObject } from "react";

// Generate reflection lighting locally; no external HDR download is needed.
function softwareRendering(gl: WebGLRenderer) {
  const context = gl.getContext();
  const info = context.getExtension("WEBGL_debug_renderer_info");
  return info
    ? /swiftshader|llvmpipe|software/i.test(
        String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)),
      )
    : false;
}
function InteriorReflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (softwareRendering(gl)) return;
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    const previous = scene.environment;
    scene.environment = target.texture;
    return () => {
      scene.environment = previous;
      target.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene]);
  return null;
}

type View = "overview" | "floor" | "meeting";
const views: Record<
  View,
  {
    label: string;
    camera: [number, number, number];
    target: [number, number, number];
  }
> = {
  overview: {
    label: "Seluruh kantor",
    camera: [14, 16, 20],
    target: [0, 0.5, 0],
  },
  floor: {
    label: "Area analis",
    camera: [-6.3, 4.9, -1],
    target: [-2.8, 0.8, 0.3],
  },
  meeting: {
    label: "Ruang meeting",
    camera: [9.3, 5.2, 8.8],
    target: [5, 0.8, 1],
  },
};
function CameraView({
  view,
  reset,
  controls,
}: {
  view: View;
  reset: number;
  controls: RefObject<ComponentRef<typeof OrbitControls> | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const setting = views[view];
    const factor =
      view === "overview" ? Math.max(1, 1.3 / (size.width / size.height)) : 1;
    camera.position.set(
      ...(setting.camera.map(
        (n, i) => setting.target[i] + (n - setting.target[i]) * factor,
      ) as [number, number, number]),
    );
    controls.current?.target.set(...setting.target);
    // A portrait overview needs more camera distance than a landscape scene.
    // Keep orbit limits from clamping that fitted camera and cropping the floor.
    if (controls.current)
      controls.current.maxDistance = Math.max(
        48,
        camera.position.distanceTo(controls.current.target) * 1.2,
      );
    camera.lookAt(...setting.target);
    controls.current?.update();
  }, [camera, controls, view, reset, size.width, size.height]);
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
function MarketWall({
  prices,
  labelHost,
  onSelect,
}: {
  prices: number[];
  labelHost: RefObject<HTMLDivElement>;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => {
    const bars = prices.filter(Number.isFinite).slice(-70);
    if (bars.length < 2) return null;
    const lo = Math.min(...bars),
      span = Math.max(...bars) - lo || 1;
    const vertices = bars.flatMap((p, i) => [
      -2.15 + (i / (bars.length - 1)) * 4.3,
      ((p - lo) / span) * 1.12 - 0.62,
      0.102,
    ]);
    const value = new BufferGeometry();
    value.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    return value;
  }, [prices]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return (
    <group
      position={[0, 1.94, -6.6]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh castShadow>
        <boxGeometry args={[5.1, 1.95, 0.16]} />
        <meshStandardMaterial
          color="#293336"
          roughness={0.35}
          metalness={0.4}
        />
      </mesh>
      <mesh position={[0, 0, 0.087]}>
        <boxGeometry args={[4.93, 1.78, 0.012]} />
        <meshStandardMaterial
          color="#12212a"
          emissive="#152c36"
          emissiveIntensity={0.25}
          roughness={0.4}
        />
      </mesh>
      {geometry && (
        <line>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial color="#80c3ae" />
        </line>
      )}
      <Html portal={labelHost} position={[-2.15, 0.67, 0.13]}>
        <span className="screen-label">
          BTCUSDT <small>· CLOSED CANDLES</small>
        </span>
      </Html>
      {!geometry && (
        <Html portal={labelHost} position={[0, -0.1, 0.13]} center>
          <span className="screen-empty">Menunggu data market</span>
        </Html>
      )}
    </group>
  );
}
export default function OfficeScene({
  state,
  onSelect,
  prices,
  avatars = {},
}: {
  state: string;
  onSelect: (id: string) => void;
  prices: number[];
  avatars?: Partial<Record<CharacterId, AvatarPreset>>;
}) {
  const [view, setView] = useState<View>("overview");
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
    const timer = setInterval(() => setIdleSlot((s) => (s + 1) % 8), 22000);
    return () => clearInterval(timer);
  }, []);
  const antialias = useRef(quality !== "low");
  return (
    <div className="office-scene" aria-label="Kantor trading 3D interaktif">
      <div ref={labelHost} className="scene-label-layer" />
      <div className="scene-title">
        <span className="scene-live-dot" /> BYGA OFFICE{" "}
        <small>TRADING FLOOR</small>
      </div>
      <Canvas
        shadows={profile.shadows}
        dpr={profile.dpr}
        camera={{
          position: views.overview.camera,
          fov: 40,
          near: 0.1,
          far: 150,
        }}
        gl={{
          antialias: antialias.current,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.12,
        }}
        onCreated={({ gl }) => {
          if (softwareRendering(gl)) setQuality("low");
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            window.dispatchEvent(new Event("byga:webgl-lost"));
          });
        }}
      >
        <color attach="background" args={["#101e26"]} />
        <fog attach="fog" args={["#101e26", 120, 240]} />
        <hemisphereLight args={["#edf4ff", "#85745d", 1.7]} />
        <ambientLight intensity={0.3} />
        <directionalLight
          position={[-5, 12, -6]}
          intensity={3.3}
          color="#fff1d9"
          castShadow={profile.shadows}
          shadow-mapSize={[profile.shadowSize, profile.shadowSize]}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-camera-near={0.5}
          shadow-camera-far={40}
          shadow-bias={-0.0003}
          shadow-normalBias={0.025}
          shadow-radius={3}
        />
        <directionalLight
          position={[4, 7, 12]}
          intensity={1.3}
          color="#e5edf4"
        />
        <pointLight
          position={[5, 3, 1]}
          intensity={9}
          distance={9}
          decay={2}
          color="#ffe2bb"
        />
        <OfficeEnvironment detail={profile.decorative} />
        {quality !== "low" && <InteriorReflections />}
        <MarketWall
          prices={prices}
          labelHost={labelHost}
          onSelect={() => onSelect("market-wall")}
        />
        {rooms
          .filter(
            (room) => !["Market Wall", "Scanner Command"].includes(room.label),
          )
          .map((room) => (
            <group
              key={room.label}
              onClick={
                room.label === "Server / Data"
                  ? (event) => {
                      event.stopPropagation();
                      onSelect("server-room");
                    }
                  : undefined
              }
            >
              <Html
                portal={labelHost}
                position={[room.x, 0.1, room.z + room.d / 2 - 0.15]}
                center
              >
                <span className="room-label">{room.label}</span>
              </Html>
              {room.label === "Server / Data" && (
                <mesh position={[-7.65, 1, 0]}>
                  <boxGeometry args={[0.75, 2, 2.6]} />
                  <meshBasicMaterial
                    transparent
                    opacity={0}
                    depthWrite={false}
                  />
                </mesh>
              )}
            </group>
          ))}
        {characterIds.map((id, index) => (
          <OfficeCharacter
            key={id}
            index={index}
            avatar={avatars[id] ?? "professional"}
            state={state}
            coffee={
              state === "MONITORING" && profile.decorative && index === idleSlot
            }
            decorative={profile.decorative}
            onSelect={onSelect}
          />
        ))}
        <PerformanceMonitor quality={quality} onQuality={setQuality} />
        <CameraView view={view} reset={reset} controls={controls} />
        <OrbitControls
          ref={controls}
          makeDefault
          touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
          target={views.overview.target}
          minDistance={4}
          maxDistance={48}
          minPolarAngle={0.3}
          maxPolarAngle={1.4}
          enableDamping
          onChange={() => {
            const c = controls.current;
            if (!c) return;
            const x = Math.max(-6, Math.min(6, c.target.x)),
              z = Math.max(-5, Math.min(6, c.target.z));
            c.object.position.x += x - c.target.x;
            c.object.position.z += z - c.target.z;
            c.target.set(x, Math.max(0.2, Math.min(1.5, c.target.y)), z);
          }}
        />
      </Canvas>
      <div className="scene-controls">
        <div
          className="scene-view-buttons"
          role="group"
          aria-label="Sudut kamera kantor"
        >
          {(Object.keys(views) as View[]).map((key) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() => {
                setView(key);
                setReset((v) => v + 1);
              }}
            >
              {views[key].label}
            </button>
          ))}
        </div>
        <button
          className="scene-reset"
          onClick={() => {
            setView("overview");
            setReset((v) => v + 1);
          }}
          aria-label="Reset View"
        >
          ↺
        </button>
      </div>
      <span className="scene-quality">Auto · {quality}</span>
    </div>
  );
}
