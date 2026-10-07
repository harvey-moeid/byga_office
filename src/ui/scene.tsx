import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
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
import { isMeeting, rooms } from "./navigation";
import {
  initialQuality,
  adaptQuality,
  parseQualityMode,
  profiles,
  qualityModes,
  type Quality,
  type QualityMode,
} from "./quality";
import { OfficeEnvironment } from "./office-environment";
import { HybridOfficeAssets } from "./office-assets";
import { PremiumOfficeAccents } from "./office-premium";
import { OfficeCharacter } from "./office-character";
import type { CharacterMotion } from "./character-motion";
import {
  ACTIVITY_TRAVEL_TIMEOUT_MS,
  activityDelayMs,
  advanceRoamActivity,
  createOfficeActivityEvent,
  type OfficeActivity,
  type OfficeActivityKind,
} from "./office-activity";
import type { ComponentRef, RefObject } from "react";
import type { MeetingTurn } from "../core/meeting";
import type { CharacterPresence } from "./character-state";
import { CharacterPeekBubble, SpeechBubble } from "./meeting-view";

type CharacterBubbleContext = {
  presence: CharacterPresence;
  group: string;
  turn?: MeetingTurn;
};

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

type View = "overview" | "cinematic" | "floor" | "meeting" | "boss";
const QUALITY_STORAGE_KEY = "byga:3d-quality";
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
    camera: [15.2, 14.6, 19.4],
    target: [0, 0.55, 0.15],
  },
  cinematic: {
    label: "Cinematic",
    camera: [17.8, 8.9, 15.8],
    target: [0.9, 0.78, 0.9],
  },
  floor: {
    label: "Area analis",
    camera: [-6.2, 4.6, 0.2],
    target: [-2.8, 0.9, 0.5],
  },
  meeting: {
    label: "Ruang meeting",
    camera: [10.4, 6.4, 10.5],
    target: [5, 1.05, 1],
  },
  boss: {
    label: "Ruang bos",
    camera: [10.7, 4.5, 9.6],
    target: [6, 0.9, 5.75],
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
    const aspect = size.width / size.height;
    const factor =
      view === "overview"
        ? Math.max(1, 1.3 / aspect)
        : view === "meeting"
          ? Math.min(2.1, Math.max(1, 1.05 / aspect))
          : 1;
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
  timestamp,
}: {
  prices: number[];
  labelHost: RefObject<HTMLDivElement>;
  onSelect: () => void;
  timestamp?: number;
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
  const latest = prices.filter(Number.isFinite).at(-1);
  const marketTime = timestamp
    ? new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(timestamp)
    : "";
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
          BTCUSDT.P <small>· M5 · CLOSED CANDLES</small>
        </span>
      </Html>
      {latest !== undefined && (
        <Html portal={labelHost} position={[-2.15, 0.48, 0.13]}>
          <span className="screen-market-meta">
            {latest.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
            {marketTime ? ` · ${marketTime} WIB` : ""}
          </span>
        </Html>
      )}
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
  meetingId,
  speech,
  onSpeechDetails,
  onSpeechReady,
  onActivityChange,
  marketTimestamp,
  characterContexts = {},
}: {
  state: string;
  onSelect: (id: string) => void;
  prices: number[];
  avatars?: Partial<Record<CharacterId, AvatarPreset>>;
  meetingId?: string;
  speech?: MeetingTurn;
  onSpeechDetails?: (turn: MeetingTurn) => void;
  onSpeechReady?: (id: CharacterId, visible: boolean) => void;
  onActivityChange?: (
    activities: Partial<Record<CharacterId, OfficeActivityKind>>,
  ) => void;
  marketTimestamp?: number;
  characterContexts?: Partial<Record<CharacterId, CharacterBubbleContext>>;
}) {
  const [view, setView] = useState<View>("overview");
  const [reset, setReset] = useState(0);
  const [peekCharacter, setPeekCharacter] = useState<CharacterId>();
  const sceneRoot = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const beforeMeetingView = useRef<View>("overview");
  const meetingWasActive = useRef(false);
  useEffect(() => {
    const syncFullscreen = () => {
      if (document.fullscreenElement) {
        setFullscreen(document.fullscreenElement === sceneRoot.current);
        return;
      }
      if ("fullscreenEnabled" in document && document.fullscreenEnabled)
        setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);
  const toggleFullscreen = async () => {
    const element = sceneRoot.current;
    if (!element) return;
    if (fullscreen) {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      setFullscreen(false);
      return;
    }
    setFullscreen(true);
    if (element.requestFullscreen) {
      await element.requestFullscreen().catch(() => undefined);
    }
  };
  useEffect(() => {
    setPeekCharacter(undefined);
  }, [meetingId, state]);

  useEffect(() => {
    if (meetingId) {
      if (!meetingWasActive.current) {
        meetingWasActive.current = true;
        setView((current) => {
          beforeMeetingView.current = current;
          return "meeting";
        });
      }
      return;
    }
    if (meetingWasActive.current) {
      meetingWasActive.current = false;
      setView(beforeMeetingView.current);
      setReset((value) => value + 1);
    }
  }, [meetingId]);
  const labelHost = useRef<HTMLDivElement>(null!);
  const deviceQuality = useMemo(
    () =>
      initialQuality(
        navigator.hardwareConcurrency ?? 4,
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      ),
    [],
  );
  const [qualityMode, setQualityMode] = useState<QualityMode>(() =>
    parseQualityMode(window.localStorage.getItem(QUALITY_STORAGE_KEY)),
  );
  const [quality, setQuality] = useState<Quality>(() => {
    const stored = parseQualityMode(
      window.localStorage.getItem(QUALITY_STORAGE_KEY),
    );
    return stored === "auto" ? deviceQuality : stored;
  });
  useEffect(() => {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, qualityMode);
    setQuality(qualityMode === "auto" ? deviceQuality : qualityMode);
  }, [deviceQuality, qualityMode]);
  const profile = profiles[quality];
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [activities, setActivities] = useState<
    Partial<Record<CharacterId, OfficeActivity>>
  >({});
  const [motions, setMotions] = useState<
    Partial<Record<CharacterId, CharacterMotion>>
  >({});
  const firstActivity = useRef(true);
  const activityArrivalHandler = useRef<
    (id: CharacterId, activity: OfficeActivity) => void
  >(() => {});
  const meetingActive = !!meetingId || isMeeting(state);
  useEffect(() => {
    let disposed = false;
    const timers: number[] = [];
    const schedule = (first: boolean) => {
      const timer = window.setTimeout(() => {
        if (disposed) return;
        if (document.hidden) {
          schedule(false);
          return;
        }
        const event = createOfficeActivityEvent();
        const pending = new Set(
          Object.keys(event.assignments) as CharacterId[],
        );
        const started = new Set<CharacterId>();
        let cycleFinished = false;
        const finishIfDone = () => {
          if (cycleFinished || pending.size) return;
          cycleFinished = true;
          activityArrivalHandler.current = () => {};
          schedule(false);
        };
        setActivities(event.assignments);
        activityArrivalHandler.current = (id, activity) => {
          if (disposed || event.assignments[id] !== activity) return;

          if (activity.kind === "roam") {
            if (!started.has(id)) {
              started.add(id);
              timers.push(
                window.setTimeout(() => {
                  if (disposed) return;
                  const currentRoam = event.assignments[id];
                  setActivities((current) => {
                    if (!currentRoam || current[id] !== currentRoam)
                      return current;
                    const updated = { ...current };
                    delete updated[id];
                    return updated;
                  });
                  delete event.assignments[id];
                  pending.delete(id);
                  finishIfDone();
                }, activity.durationMs),
              );
            }

            const occupied = Object.entries(event.assignments)
              .filter(([otherId, current]) => otherId !== id && !!current)
              .map(([, current]) => current!.destination);
            const next = advanceRoamActivity(activity, occupied);
            event.assignments[id] = next;
            setActivities((current) =>
              current[id] === activity ? { ...current, [id]: next } : current,
            );
            return;
          }

          if (started.has(id)) return;
          started.add(id);
          timers.push(
            window.setTimeout(() => {
              if (disposed) return;
              setActivities((current) => {
                if (current[id] !== activity) return current;
                const updated = { ...current };
                delete updated[id];
                return updated;
              });
              pending.delete(id);
              finishIfDone();
            }, activity.durationMs),
          );
        };
        timers.push(
          window.setTimeout(() => {
            if (disposed) return;
            setActivities((current) => {
              const updated = { ...current };
              for (const id of pending) {
                if (started.has(id)) continue;
                if (updated[id] === event.assignments[id]) delete updated[id];
                pending.delete(id);
              }
              return updated;
            });
            finishIfDone();
          }, ACTIVITY_TRAVEL_TIMEOUT_MS),
        );
      }, activityDelayMs(first));
      timers.push(timer);
    };
    if (meetingActive) {
      firstActivity.current = false;
      activityArrivalHandler.current = () => {};
      setActivities({});
    } else {
      const first = firstActivity.current;
      firstActivity.current = false;
      schedule(first);
    }
    return () => {
      disposed = true;
      activityArrivalHandler.current = () => {};
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [meetingActive]);
  useEffect(() => {
    if (!onActivityChange) return;
    onActivityChange(
      Object.fromEntries(
        Object.entries(activities).flatMap(([id, activity]) =>
          activity ? [[id, activity.kind]] : [],
        ),
      ) as Partial<Record<CharacterId, OfficeActivityKind>>,
    );
  }, [activities, onActivityChange]);
  useEffect(
    () => () => {
      onActivityChange?.({});
    },
    [onActivityChange],
  );
  const antialias = useRef(quality !== "low");
  return (
    <div
      ref={sceneRoot}
      className={`office-scene${fullscreen ? " is-fullscreen" : ""}${meetingActive ? " meeting-active" : ""}`}
      aria-label="Kantor trading 3D interaktif"
    >
      <div ref={labelHost} className="scene-label-layer" />
      <div className="scene-title">
        <span className="scene-live-dot" /> BYGA OFFICE{" "}
        <small>TRADING FLOOR</small>
      </div>
      <button
        type="button"
        className="scene-fullscreen"
        onClick={toggleFullscreen}
        aria-pressed={fullscreen}
        aria-label={fullscreen ? "Keluar dari fullscreen 3D" : "Buka fullscreen 3D"}
        title={fullscreen ? "Keluar fullscreen" : "Fullscreen 3D"}
      >
        <span aria-hidden="true">{fullscreen ? "✕" : "⛶"}</span>
        <b>{fullscreen ? "Keluar" : "Fullscreen"}</b>
      </button>
      <Canvas
        shadows={profile.shadows}
        onPointerMissed={() => setPeekCharacter(undefined)}
        dpr={profile.dpr}
        camera={{
          position: views.overview.camera,
          fov: 37,
          near: 0.1,
          far: 150,
        }}
        gl={{
          antialias: antialias.current,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: quality === "ultra" ? 1.16 : 1.08,
        }}
        onCreated={({ gl }) => {
          if (qualityMode === "auto" && softwareRendering(gl)) setQuality("low");
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            window.dispatchEvent(new Event("byga:webgl-lost"));
          });
        }}
      >
        <color attach="background" args={["#0b1518"]} />
        <fog attach="fog" args={["#0b1518", 90, 190]} />
        <hemisphereLight args={["#dfeaf0", "#7d6950", 1.35]} />
        <ambientLight intensity={0.2} />
        <directionalLight
          position={[-6, 13, -7]}
          intensity={2.75}
          color="#ffe8c7"
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
          position={[5, 8, 13]}
          intensity={1.05}
          color="#dce8ef"
        />
        <pointLight
          position={[5, 3.2, 1]}
          intensity={6.5}
          distance={10}
          decay={2}
          color="#ffd8a6"
        />
        <pointLight
          position={[-3, 2.8, 2]}
          intensity={3.4}
          distance={8}
          decay={2}
          color="#ffe2b8"
        />
        <OfficeEnvironment detail={profile.decorative} />
        {quality !== "low" && (
          <ContactShadows
            position={[0, 0.015, 0]}
            opacity={quality === "ultra" ? 0.34 : 0.24}
            scale={22}
            blur={quality === "ultra" ? 2.8 : 2.2}
            far={8}
            resolution={quality === "ultra" ? 1024 : 512}
            frames={quality === "ultra" ? Infinity : 1}
          />
        )}
        {profile.decorative && <HybridOfficeAssets />}
        {profile.decorative && (
          <PremiumOfficeAccents
            labelHost={labelHost}
            cinematic={quality === "ultra"}
          />
        )}
        {quality !== "low" && <InteriorReflections />}
        <MarketWall
          prices={prices}
          labelHost={labelHost}
          timestamp={marketTimestamp}
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
                position={[
                  room.labelPosition?.[0] ?? room.x,
                  0.1,
                  room.labelPosition?.[1] ?? room.z + room.d / 2 - 0.15,
                ]}
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
        {characterIds.map((id, index) => {
          const context = characterContexts[id];
          return (
            <OfficeCharacter
              key={id}
              index={index}
              avatar={avatars[id] ?? "professional"}
              state={state}
              activity={activities[id]}
              decorative={profile.decorative}
              onSelect={onSelect}
              onPeek={(character) =>
                setPeekCharacter((current) =>
                  current === character ? undefined : character,
                )
              }
              labelHost={labelHost}
              onSpeechReady={onSpeechReady}
              onActivityArrive={(id, activity) =>
                activityArrivalHandler.current(id, activity)
              }
              onMotionChange={(character, motion) =>
                setMotions((current) =>
                  current[character] === motion
                    ? current
                    : { ...current, [character]: motion },
                )
              }
              speech={
                speech?.character === id && onSpeechDetails ? (
                  <SpeechBubble turn={speech} onDetails={onSpeechDetails} />
                ) : undefined
              }
              peek={
                peekCharacter === id && context ? (
                  <CharacterPeekBubble
                    character={id}
                    presence={context.presence}
                    group={context.group}
                    motion={motions[id]}
                    turn={context.turn}
                    onDetails={() => {
                      setPeekCharacter(undefined);
                      onSelect(id);
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
        {qualityMode === "auto" && (
          <PerformanceMonitor quality={quality} onQuality={setQuality} />
        )}
        <CameraView view={view} reset={reset} controls={controls} />
        <OrbitControls
          ref={controls}
          makeDefault
          touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
          target={views.overview.target}
          minDistance={4}
          maxDistance={48}
          minPolarAngle={0.3}
          maxPolarAngle={1.34}
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
      <label className="scene-quality">
        <span>Kualitas 3D</span>
        <select
          aria-label="Kualitas 3D"
          value={qualityMode}
          onChange={(event) =>
            setQualityMode(event.target.value as QualityMode)
          }
        >
          {qualityModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "auto"
                ? `Auto · ${quality}`
                : mode[0].toUpperCase() + mode.slice(1)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
