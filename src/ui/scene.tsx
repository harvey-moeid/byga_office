import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TOUCH,
  Vector3,
  ACESFilmicToneMapping,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  LinearFilter,
  PMREMGenerator,
  SRGBColorSpace,
  type WebGLRenderer,
  type PerspectiveCamera,
} from "three";
import {
  fitOfficeCamera,
  fitMeetingCamera,
  meetingViewport,
  type CameraBounds,
} from "./office-camera";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  characterIds,
  type ScannerOutput,
  type AvatarPreset,
  type CharacterId,
} from "../core/contracts";
import { characterIdentity, groupIdentity } from "./group-identity";
import { desks } from "./navigation";
import { PhysicalSign } from "./physical-signs";
import { isMeeting } from "./navigation";
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
import { UpperFloorOffice } from "./office-upper-floor";
import { RoomSigns, ScannerDisplay } from "./physical-signs";
import {
  LOWER_BOSS_VIEW,
  LOWER_MEETING_VIEW,
  UPPER_BOSS_VIEW,
  UPPER_MEETING_VIEW,
} from "./office-layout";
import {
  chooseMeetingVenue,
  type MeetingFloor,
  type MeetingVenueRecord,
} from "./meeting-venue";
import { characterTarget } from "./multi-floor-navigation";
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
import type { PresentationTurn as MeetingTurn } from "../core/meeting";
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

type CharacterPositions = Partial<Record<CharacterId, Vector3>>;

type View = "overview" | "cinematic" | "floor" | "meeting" | "boss" | "upper";
const QUALITY_STORAGE_KEY = "byga:3d-quality";
const MEETING_VENUE_STORAGE_KEY = "byga:meeting-venue";
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
    camera: [-18, 18, 24],
    target: [0, 2.1, 0],
  },
  cinematic: {
    label: "Cinematic",
    camera: [-20, 12, 23],
    target: [0, 2.1, 0],
  },
  floor: {
    label: "Area analis",
    camera: [-11, 8, 10],
    target: [-3, 0.9, 0],
  },
  meeting: {
    label: "Ruang meeting",
    camera: LOWER_MEETING_VIEW.camera,
    target: LOWER_MEETING_VIEW.target,
  },
  boss: {
    label: "Ruang bos",
    camera: LOWER_BOSS_VIEW.camera,
    target: LOWER_BOSS_VIEW.target,
  },
  upper: {
    label: "Lantai 2",
    camera: [-7, 12, 13],
    target: [4.8, 4.8, 0.45],
  },
};
function SceneCadence({ fps }: { fps: number }) {
  const { invalidate } = useThree();
  useEffect(() => {
    let handle = 0,
      previous = 0;
    const frame = (now: number) => {
      if (!document.hidden && now - previous >= 1000 / fps) {
        previous = now;
        invalidate();
      }
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [fps, invalidate]);
  return null;
}

function CameraView({
  view,
  reset,
  controls,
  meetingFloor,
  upperFloorEnabled,
  follow,
  speaker,
  positions,
  reduced,
  interrupted,
}: {
  view: View;
  reset: number;
  controls: RefObject<ComponentRef<typeof OrbitControls> | null>;
  meetingFloor: MeetingFloor;
  upperFloorEnabled: boolean;
  follow: boolean;
  speaker?: CharacterId;
  positions: RefObject<CharacterPositions>;
  reduced: boolean;
  interrupted: RefObject<boolean>;
}) {
  const { camera, size, gl } = useThree();
  const goal = useRef<{ position: Vector3; target: Vector3 }>(undefined);
  const initialized = useRef(false);
  const recalculate = useRef(true);
  const layoutClock = useRef(0);
  useEffect(() => {
    goal.current = undefined;
    recalculate.current = follow || !initialized.current;
  }, [follow]);
  useEffect(() => {
    recalculate.current = true;
  }, [view, reset, meetingFloor, upperFloorEnabled, size.width, size.height]);
  useEffect(() => {
    if (follow) recalculate.current = true;
  }, [speaker, follow]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    if (interrupted.current) {
      goal.current = undefined;
      recalculate.current = false;
      interrupted.current = false;
    }
    // Manual interaction owns the camera until Follow is explicitly enabled.
    if (!follow && !recalculate.current && !goal.current) return;
    layoutClock.current += dt;
    if (recalculate.current || (follow && layoutClock.current >= 0.35)) {
      layoutClock.current = 0;
      recalculate.current = false;
      const upperMeeting =
        view === "meeting" && meetingFloor === 2 && upperFloorEnabled;
      const setting = upperMeeting
        ? UPPER_MEETING_VIEW
        : view === "boss" && upperFloorEnabled
          ? UPPER_BOSS_VIEW
          : views[view];
      const bounds: CameraBounds =
        view === "overview" || view === "cinematic"
          ? { min: [-9, -0.55, -8], max: [9, 6.6, 8] }
          : view === "floor"
            ? { min: [-7.5, 0, -3.5], max: [1.5, 2.3, 3.5] }
            : view === "upper"
              ? { min: [1.7, 3.55, -6.25], max: [8.4, 6.6, 7] }
              : view === "boss"
                ? upperFloorEnabled
                  ? { min: [2.05, 3.68, 3.35], max: [6.88, 6.1, 6.82] }
                  : { min: [4, 0, 4], max: [8, 2.5, 7.5] }
                : upperMeeting
                  ? { min: [2.85, 3.68, -3.65], max: [6.5, 5.55, -0.75] }
                  : { min: [3.3, 0, -0.45], max: [6.7, 1.85, 2.45] };
      const target = new Vector3(...setting.target);
      const seed = new Vector3(...setting.camera);
      const meetingView = view === "meeting";
      // Keep all seats in frame; bias the ensemble toward the actual speaker.
      const speakingPosition = speaker ? positions.current[speaker] : undefined;
      if (
        meetingView &&
        follow &&
        speakingPosition &&
        Math.abs(speakingPosition.y - bounds.min[1]) < 0.35
      ) {
        const center = new Vector3(
          (bounds.min[0] + bounds.max[0]) / 2,
          target.y,
          (bounds.min[2] + bounds.max[2]) / 2,
        );
        seed.x += (speakingPosition.x - center.x) * 1.2;
        seed.z += (speakingPosition.z - center.z) * 0.6;
        target
          .copy(center)
          .lerp(
            new Vector3(speakingPosition.x, target.y, speakingPosition.z),
            0.16,
          );
      }
      const perspective = camera as PerspectiveCamera;
      let occupancy: [number, number] = [0.76, 0.76];
      let meetingFrame: ReturnType<typeof fitMeetingCamera> | undefined;
      if (meetingView) {
        const canvas = gl.domElement.getBoundingClientRect();
        const hudElement = document.querySelector(".meeting-status");
        const hud =
          hudElement &&
          (!document.fullscreenElement ||
            document.fullscreenElement.contains(hudElement))
            ? hudElement.getBoundingClientRect()
            : undefined;
        const buttons = document
          .querySelector(".scene-controls")
          ?.getBoundingClientRect();
        const legend = document.querySelector(".scene-group-legend")?.getBoundingClientRect();
        const rect = meetingViewport(
          size.width,
          size.height,
          hud
            ? {
                left: hud.left - canvas.left,
                top: hud.top - canvas.top,
                width: hud.width,
                height: hud.height,
              }
            : undefined,
          Math.min(buttons?.top ?? canvas.bottom, legend?.top ?? canvas.bottom) - canvas.top - 12,
        );
        occupancy = [
          (0.72 * rect.width) / size.width,
          (0.72 * rect.height) / size.height,
        ];
        meetingFrame = fitMeetingCamera(
          [seed.x, seed.y, seed.z],
          [target.x, target.y, target.z],
          bounds,
          size.width / size.height,
          perspective.fov,
          occupancy,
        );
        perspective.setViewOffset(
          size.width,
          size.height,
          size.width / 2 -
            rect.left -
            rect.width / 2 +
            (meetingFrame.center[0] * size.width) / 2,
          size.height / 2 -
            rect.top -
            rect.height / 2 -
            (meetingFrame.center[1] * size.height) / 2,
          size.width,
          size.height,
        );
      } else perspective.clearViewOffset();
      const destination =
        meetingFrame?.position ??
        fitOfficeCamera(
          [seed.x, seed.y, seed.z],
          [target.x, target.y, target.z],
          bounds,
          size.width / size.height,
          perspective.fov,
          occupancy,
        );
      c.maxDistance = Math.max(48, destination.distanceTo(target) * 1.2);
      goal.current = { position: destination, target };
    }
    const destination = goal.current;
    if (!destination) return;
    const alpha =
      reduced || !initialized.current
        ? 1
        : 1 - Math.exp(-Math.min(dt, 0.1) * 3.5);
    camera.position.lerp(destination.position, alpha);
    c.target.lerp(destination.target, alpha);
    camera.lookAt(c.target);
    c.update();
    initialized.current = true;
    if (
      camera.position.distanceToSquared(destination.position) < 0.00001 &&
      c.target.distanceToSquared(destination.target) < 0.00001
    )
      goal.current = undefined;
  });
  return null;
}

function GroupMarkers({
  quality,
  meetingFloor,
}: {
  quality: Quality;
  meetingFloor: MeetingFloor;
}) {
  const representatives = [
    "structure",
    "trend",
    "volume",
    "derivatives",
  ] as const;
  return (
    <group name="analysis-group-markers">
      {characterIds.slice(0, 8).map((id, index) => (
        <mesh
          key={`desk-${id}`}
          position={[desks[index][0], 0.81, desks[index][1] + 0.35]}
        >
          <boxGeometry args={[1.45, 0.025, 0.055]} />
          <meshBasicMaterial
            color={characterIdentity(id).color}
            toneMapped={false}
          />
        </mesh>
      ))}
      {representatives.map((id) => {
        const identity = characterIdentity(id);
        const index = characterIds.indexOf(id);
        const desk = desks[index];
        return (
          <group key={id}>
            <PhysicalSign
              quality={quality}
              sign={{
                id: `group-${id}`,
                label: identity.label.toUpperCase(),
                width: 1.25,
                height: 0.23,
                position: [desk[0], 1.65, desk[1] - 0.38],
                mount: "stand",
                style: "plaque",
                floor: 1,
              }}
            />
          </group>
        );
      })}
      {/* Small, unlit seat accents keep group identity visible at both venues. */}
      {characterIds.map((id, index) => {
        const seat = characterTarget(
          index,
          "BOSS_DECISION",
          meetingFloor,
          true,
        );
        return (
          <mesh
            key={id}
            name={`meeting-seat-group:${id}`}
            position={[
              seat.position[0],
              seat.position[1] + 0.04,
              seat.position[2],
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.24, 0.29, 16]} />
            <meshBasicMaterial
              color={characterIdentity(id).color}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
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
  onSelect,
  timestamp,
}: {
  prices: number[];
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
  const screenTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 368;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#102128";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#dce9e5";
      context.font = "700 46px system-ui, sans-serif";
      context.fillText("BTCUSDT.P", 46, 62);
      context.fillStyle = "#83a8a1";
      context.font = "600 27px system-ui, sans-serif";
      context.fillText("M5 · CLOSED CANDLES", 46, 106);
      context.fillStyle = "#eff7f4";
      context.font = "700 42px system-ui, sans-serif";
      context.fillText(
        latest === undefined
          ? "WAITING FOR MARKET DATA"
          : latest.toLocaleString("id-ID", { maximumFractionDigits: 2 }),
        46,
        326,
      );
      if (marketTime) {
        context.textAlign = "right";
        context.fillStyle = "#9fb7b2";
        context.font = "600 26px system-ui, sans-serif";
        context.fillText(`${marketTime} WIB`, 978, 326);
        context.textAlign = "left";
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, [latest, marketTime]);
  useEffect(() => () => screenTexture.dispose(), [screenTexture]);
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
      <mesh position={[0, 0, 0.091]}>
        <planeGeometry args={[4.93, 1.78]} />
        <meshBasicMaterial map={screenTexture} toneMapped={false} />
      </mesh>
      {geometry && (
        <line>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial color="#80c3ae" />
        </line>
      )}
    </group>
  );
}
export default function OfficeScene({
  state,
  onSelect,
  prices,
  scanners = [],
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
  scanners?: ScannerOutput[];
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
  const [followSpeaker, setFollowSpeaker] = useState(
    () => window.localStorage.getItem("byga:camera-follow") !== "false",
  );
  const cameraInterrupted = useRef(false);
  useEffect(() => {
    window.localStorage.setItem("byga:camera-follow", String(followSpeaker));
  }, [followSpeaker]);
  const positions = useRef<CharacterPositions>({});
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [peekCharacter, setPeekCharacter] = useState<CharacterId>();
  const sceneRoot = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [meetingFloor, setMeetingFloor] = useState<MeetingFloor>(1);
  const meetingVenueCase = useRef<string | undefined>(undefined);
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
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
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
          return followSpeaker ? "meeting" : current;
        });
      }
      return;
    }
    if (meetingWasActive.current) {
      meetingWasActive.current = false;
      if (followSpeaker) {
        setView(beforeMeetingView.current);
        setReset((value) => value + 1);
      }
    }
  }, [meetingId, followSpeaker]);
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
  useEffect(() => {
    if (!meetingId) return;

    const parseStoredVenue = (): MeetingVenueRecord | undefined => {
      try {
        const raw = window.localStorage.getItem(MEETING_VENUE_STORAGE_KEY);
        if (!raw) return undefined;
        const value = JSON.parse(raw) as Partial<MeetingVenueRecord>;
        return typeof value.caseId === "string" &&
          (value.floor === 1 || value.floor === 2)
          ? { caseId: value.caseId, floor: value.floor }
          : undefined;
      } catch {
        return undefined;
      }
    };

    if (meetingVenueCase.current === meetingId) {
      if (!profile.upperFloor) {
        meetingVenueCase.current = meetingId;
        setMeetingFloor(1);
        window.localStorage.setItem(
          MEETING_VENUE_STORAGE_KEY,
          JSON.stringify({ caseId: meetingId, floor: 1 }),
        );
      }
      return;
    }

    const venue = chooseMeetingVenue(
      meetingId,
      profile.upperFloor,
      parseStoredVenue(),
    );
    meetingVenueCase.current = meetingId;
    setMeetingFloor(venue.floor);
    window.localStorage.setItem(
      MEETING_VENUE_STORAGE_KEY,
      JSON.stringify(venue),
    );
  }, [meetingId, profile.upperFloor]);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    if (!profile.upperFloor && view === "upper") {
      setView("overview");
      setReset((value) => value + 1);
    }
  }, [profile.upperFloor, view]);
  const [activities, setActivities] = useState<
    Partial<Record<CharacterId, OfficeActivity>>
  >({});
  const [motions, setMotions] = useState<
    Partial<Record<CharacterId, CharacterMotion>>
  >({});
  const handleMotionChange = useCallback(
    (character: CharacterId, motion: CharacterMotion) => {
      setMotions((current) =>
        current[character] === motion
          ? current
          : { ...current, [character]: motion },
      );
    },
    [],
  );
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
  const zoomCamera = (factor: number) => {
    cameraInterrupted.current = true;
    setFollowSpeaker(false);
    const c = controls.current;
    if (!c) return;
    const offset = c.object.position.clone().sub(c.target);
    const distance = Math.max(
      c.minDistance,
      Math.min(c.maxDistance, offset.length() * factor),
    );
    c.object.position.copy(c.target).add(offset.setLength(distance));
    c.update();
  };
  return (
    <div
      ref={sceneRoot}
      className={`office-scene${fullscreen ? " is-fullscreen" : ""}${meetingActive ? " meeting-active" : ""}`}
      aria-label="Kantor trading 3D interaktif"
      data-meeting-floor={meetingActive ? meetingFloor : undefined}
      data-boss-floor={profile.upperFloor ? 2 : 1}
      data-camera-view={view}
      data-camera-follow={meetingActive && followSpeaker ? "speaker" : "manual"}
      data-camera-speaker={
        meetingActive && followSpeaker ? speech?.character : undefined
      }
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
        aria-label={
          fullscreen ? "Keluar dari fullscreen 3D" : "Buka fullscreen 3D"
        }
        title={fullscreen ? "Keluar fullscreen" : "Fullscreen 3D"}
      >
        <span aria-hidden="true">{fullscreen ? "✕" : "⛶"}</span>
        <b>{fullscreen ? "Keluar" : "Fullscreen"}</b>
      </button>
      <Canvas
        frameloop="demand"
        shadows={profile.shadows}
        onPointerMissed={() => setPeekCharacter(undefined)}
        dpr={profile.dpr}
        camera={{
          position: views.overview.camera,
          fov: 40,
          near: 0.1,
          far: 300,
        }}
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
        }}
        onCreated={({ gl }) => {
          if (qualityMode === "auto" && softwareRendering(gl))
            setQuality("low");
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            window.dispatchEvent(new Event("byga:webgl-lost"));
          });
        }}
      >
        <SceneCadence
          fps={
            reduced || quality === "low" ? 30 : quality === "medium" ? 40 : 60
          }
        />
        <color attach="background" args={["#101f26"]} />
        <fog attach="fog" args={["#101f26", 180, 300]} />
        <hemisphereLight args={["#e4f2ff", "#bcae96", 1.65]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[-6, 13, -7]}
          intensity={2.5}
          color="#fff0dd"
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
          intensity={1.5}
          color="#dce8ef"
        />
        {profile.decorative ? (
          <>
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
          </>
        ) : (
          <directionalLight
            position={[-3, 10, 5]}
            intensity={0.45}
            color="#fff0df"
          />
        )}
        <OfficeEnvironment detail={profile.decorative} />
        {profile.shadows && (
          <ContactShadows
            position={[0, 0.015, 0]}
            opacity={quality === "ultra" ? 0.34 : 0.24}
            scale={22}
            blur={quality === "ultra" ? 2.8 : 2.2}
            far={8}
            resolution={quality === "ultra" ? 1024 : 512}
            frames={1}
          />
        )}
        {profile.upperFloor && (
          <UpperFloorOffice
            detail={profile.decorative}
            shadows={profile.shadows}
          />
        )}
        {profile.decorative && <HybridOfficeAssets />}
        {profile.decorative && (
          <PremiumOfficeAccents cinematic={quality === "ultra"} />
        )}
        {profile.decorative && <InteriorReflections />}
        <MarketWall
          prices={prices}
          timestamp={marketTimestamp}
          onSelect={() => onSelect("market-wall")}
        />
        <RoomSigns
          quality={quality}
          upperFloor={profile.upperFloor}
          onSelect={onSelect}
        />
        <ScannerDisplay scanners={scanners} />
        <GroupMarkers quality={quality} meetingFloor={meetingFloor} />
        <mesh
          name="server-room-select-zone"
          position={[-7.65, 1, 0]}
          onClick={(event) => {
            event.stopPropagation();
            onSelect("server-room");
          }}
        >
          <boxGeometry args={[0.75, 2, 2.6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {characterIds.map((id, index) => {
          const context = characterContexts[id];
          return (
            <OfficeCharacter
              key={id}
              index={index}
              positions={positions}
              speaker={speech?.character}
              motionReduced={reduced}
              avatar={avatars[id] ?? "professional"}
              state={state}
              activity={activities[id]}
              quality={quality}
              meetingFloor={meetingFloor}
              upperFloorEnabled={profile.upperFloor}
              onSelect={onSelect}
              onPeek={
                context
                  ? (character) =>
                      setPeekCharacter((current) =>
                        current === character ? undefined : character,
                      )
                  : undefined
              }
              labelHost={labelHost}
              onSpeechReady={onSpeechReady}
              onActivityArrive={(id, activity) =>
                activityArrivalHandler.current(id, activity)
              }
              onMotionChange={handleMotionChange}
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
        <CameraView
          view={view}
          reset={reset}
          controls={controls}
          meetingFloor={meetingFloor}
          upperFloorEnabled={profile.upperFloor}
          follow={meetingActive && followSpeaker}
          speaker={speech?.character}
          positions={positions}
          reduced={reduced}
          interrupted={cameraInterrupted}
        />
        <OrbitControls
          ref={controls}
          makeDefault
          onStart={() => {
            cameraInterrupted.current = true;
            setFollowSpeaker(false);
          }}
          touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
          target={views.overview.target}
          minDistance={4}
          maxDistance={48}
          minPolarAngle={0.3}
          maxPolarAngle={1.48}
          enableDamping
          onChange={() => {
            const c = controls.current;
            if (!c) return;
            const x = Math.max(-6, Math.min(6, c.target.x)),
              z = Math.max(-5, Math.min(6, c.target.z));
            c.object.position.x += x - c.target.x;
            c.object.position.z += z - c.target.z;
            c.target.set(
              x,
              Math.max(
                0.2,
                Math.min(profile.upperFloor ? 5.4 : 1.5, c.target.y),
              ),
              z,
            );
          }}
        />
      </Canvas>
      <div className="scene-group-legend" role="group" aria-label="Empat grup analisis">
        {Object.entries(groupIdentity).map(([key, identity]) => (
          <span key={key} style={{ borderColor: identity.color }}>
            <i style={{ background: identity.color }} />
            {identity.label}
          </span>
        ))}
      </div>
      <div className="scene-controls">
        <div
          className="scene-view-buttons"
          role="group"
          aria-label="Sudut kamera kantor"
        >
          {(Object.keys(views) as View[])
            .filter((key) => key !== "upper" || profile.upperFloor)
            .map((key) => (
              <button
                key={key}
                aria-pressed={view === key}
                onClick={() => {
                  setFollowSpeaker(false);
                  setView(key);
                  setReset((v) => v + 1);
                }}
              >
                {views[key].label}
              </button>
            ))}
        </div>
        <button
          className="scene-follow"
          aria-pressed={followSpeaker}
          onClick={() => {
            setFollowSpeaker((value) => !value);
            if (!followSpeaker && meetingActive) {
              setView("meeting");
              setReset((v) => v + 1);
            }
          }}
        >
          Ikuti pembicara
        </button>
        <div
          className="scene-camera-actions"
          role="group"
          aria-label="Zoom kamera"
        >
          <button aria-label="Perbesar kantor" onClick={() => zoomCamera(0.8)}>
            +
          </button>
          <button aria-label="Perkecil kantor" onClick={() => zoomCamera(1.25)}>
            −
          </button>
        </div>
        <button
          className="scene-reset"
          onClick={() => {
            setFollowSpeaker(false);
            setView("overview");
            setReset((v) => v + 1);
          }}
          aria-label="Reset View"
        >
          ↺
        </button>
      </div>
      <label className="scene-quality">
        <span>
          Kualitas 3D <small>2 lantai</small>
        </span>
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
