import { characterIdentity } from "./group-identity";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Group, Vector3, MathUtils, type Camera, type Object3D } from "three";
import type { OfficeActivity } from "./office-activity";
import {
  characterIds,
  type AvatarPreset,
  type CharacterId,
} from "../core/contracts";
import { desks, isAttendingMeeting } from "./navigation";
import {
  characterTarget,
  planWorldRoute,
  type CharacterTarget,
  type WorldPoint,
} from "./multi-floor-navigation";
import type { MeetingFloor } from "./meeting-venue";
import { RiggedOfficeCharacter } from "./rigged-character";
import type { Quality } from "./quality";
import { advanceCharacterRoute } from "./character-locomotion";
import { characterMotion, type CharacterMotion } from "./character-motion";

const appearances: Record<
  AvatarPreset,
  { suit: string; accent: string; skin: string; hair: string }
> = {
  professional: {
    suit: "#4b5960",
    accent: "#8b9b91",
    skin: "#bf9479",
    hair: "#302821",
  },
  emerald: {
    suit: "#294d43",
    accent: "#88a58c",
    skin: "#a7785d",
    hair: "#211d19",
  },
  navy: {
    suit: "#303f55",
    accent: "#8095ae",
    skin: "#d1a183",
    hair: "#40332a",
  },
  gold: {
    suit: "#6c5d47",
    accent: "#bba173",
    skin: "#8e624d",
    hair: "#211a18",
  },
  plum: {
    suit: "#544351",
    accent: "#a18b9d",
    skin: "#c58e74",
    hair: "#30262b",
  },
};

type OutfitStyle = "formal" | "smart" | "cool" | "casual" | "relaxed";
type CharacterOutfit = {
  style: OutfitStyle;
  jacket: string;
  accent: string;
  shirt: string;
  trousers: string;
  shoes: string;
  lapels: boolean;
  tie: boolean;
  shortSleeve: boolean;
};

const outfits: Record<CharacterId, CharacterOutfit> = {
  trend: {
    style: "formal",
    jacket: "#27343a",
    accent: "#9b554f",
    shirt: "#eef1ec",
    trousers: "#252d31",
    shoes: "#1b1e20",
    lapels: true,
    tie: true,
    shortSleeve: false,
  },
  structure: {
    style: "smart",
    jacket: "#52604a",
    accent: "#c2a86d",
    shirt: "#ece7dc",
    trousers: "#3d423b",
    shoes: "#2a2723",
    lapels: true,
    tie: false,
    shortSleeve: false,
  },
  momentum: {
    style: "cool",
    jacket: "#334b5c",
    accent: "#d27b49",
    shirt: "#e5e9e8",
    trousers: "#252a30",
    shoes: "#202226",
    lapels: false,
    tie: false,
    shortSleeve: false,
  },
  liquidity: {
    style: "casual",
    jacket: "#75624f",
    accent: "#d0a05f",
    shirt: "#2f3437",
    trousers: "#4c463f",
    shoes: "#2b2926",
    lapels: false,
    tie: false,
    shortSleeve: true,
  },
  volume: {
    style: "relaxed",
    jacket: "#4f6558",
    accent: "#9fb094",
    shirt: "#ded9cd",
    trousers: "#3a403c",
    shoes: "#342f2a",
    lapels: false,
    tie: false,
    shortSleeve: false,
  },
  quant: {
    style: "smart",
    jacket: "#273d59",
    accent: "#7ba6c7",
    shirt: "#dfe8ee",
    trousers: "#313942",
    shoes: "#1f252a",
    lapels: true,
    tie: false,
    shortSleeve: false,
  },
  derivatives: {
    style: "formal",
    jacket: "#564153",
    accent: "#c7a46c",
    shirt: "#f1e4e8",
    trousers: "#372f38",
    shoes: "#241f22",
    lapels: true,
    tie: true,
    shortSleeve: false,
  },
  positioning: {
    style: "cool",
    jacket: "#36556c",
    accent: "#a8b7bf",
    shirt: "#20272b",
    trousers: "#303840",
    shoes: "#27292c",
    lapels: false,
    tie: false,
    shortSleeve: false,
  },
  risk: {
    style: "formal",
    jacket: "#4b5058",
    accent: "#b65b55",
    shirt: "#edf1f3",
    trousers: "#2c3035",
    shoes: "#1e2023",
    lapels: true,
    tie: true,
    shortSleeve: false,
  },
  boss: {
    style: "formal",
    jacket: "#222a2d",
    accent: "#c9a96b",
    shirt: "#f7f4ea",
    trousers: "#1d2225",
    shoes: "#16191b",
    lapels: true,
    tie: true,
    shortSleeve: false,
  },
};

const speechProjection = new Vector3();

function speechScreenPosition(
  character: CharacterId,
  element: Object3D,
  camera: Camera,
  size: { width: number; height: number },
  avoidOtherBubbles: boolean,
): [number, number] {
  const projected = element.getWorldPosition(speechProjection).project(camera);
  const rawX = (projected.x * 0.5 + 0.5) * size.width;
  const rawY = (-projected.y * 0.5 + 0.5) * size.height;
  const compact = size.width <= 600;
  const landscape = size.height <= 480;
  const measured = document
    .querySelector(`[data-character="${character}"] .meeting-bubble`)
    ?.getBoundingClientRect();
  const bubbleWidth =
    measured?.width ?? (compact ? 220 : landscape ? 248 : 250);
  const bubbleHeight =
    measured?.height ?? (landscape ? 88 : compact ? 108 : 120);
  const halfWidth = Math.min(bubbleWidth / 2, Math.max(0, size.width / 2 - 14));
  const gap = 14;
  const bottomClearance = landscape ? 72 : compact ? 104 : 86;
  const clampPoint = ([x, y]: [number, number]): [number, number] => [
    MathUtils.clamp(x, halfWidth + 12, size.width - halfWidth - 12),
    MathUtils.clamp(
      y,
      bubbleHeight + gap + 8,
      Math.max(bubbleHeight + gap + 8, size.height - bottomClearance),
    ),
  ];
  const canvasBounds = document
    .querySelector(".office-scene canvas")
    ?.getBoundingClientRect();
  const offsetX = canvasBounds?.left ?? 0;
  const offsetY = canvasBounds?.top ?? 0;
  const reservedSelectors = [
    ".meeting-status",
    ".home-hud > div",
    ".home-hud .segmented",
    ".home-notices",
    ".scene-controls",
    ".scene-quality",
    ".scene-group-legend",
    ".scene-fullscreen",
    ".home-menu-button",
    ...(avoidOtherBubbles ? [".meeting-speech-anchor .meeting-bubble"] : []),
  ];
  const reserved = reservedSelectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter((node) => !node.closest(`[data-character="${character}"]`))
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left - offsetX,
        right: rect.right - offsetX,
        top: rect.top - offsetY,
        bottom: rect.bottom - offsetY,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
  const bubbleRect = ([x, y]: [number, number]) => ({
    left: x - bubbleWidth / 2,
    right: x + bubbleWidth / 2,
    top: y - gap - bubbleHeight,
    bottom: y - gap,
  });
  const clear = (point: [number, number]) => {
    const rect = bubbleRect(point);
    return reserved.every(
      (block) =>
        rect.right + 8 <= block.left ||
        rect.left - 8 >= block.right ||
        rect.bottom + 8 <= block.top ||
        rect.top - 8 >= block.bottom,
    );
  };
  const base = clampPoint([rawX, rawY]);
  const horizontal = Math.max(96, bubbleWidth * 0.72);
  const vertical = Math.max(90, bubbleHeight * 0.9);
  const candidates: [number, number][] = [
    base,
    clampPoint([base[0] + horizontal, base[1]]),
    clampPoint([base[0] - horizontal, base[1]]),
    clampPoint([base[0], base[1] - vertical]),
    clampPoint([base[0], base[1] + vertical]),
    clampPoint([base[0] + horizontal, base[1] - vertical]),
    clampPoint([base[0] - horizontal, base[1] - vertical]),
  ];
  return candidates.find(clear) ?? base;
}
export function OfficeCharacter({
  index,
  state,
  activity,
  quality,
  avatar,
  onSelect,
  onPeek,
  speech,
  peek,
  labelHost,
  onSpeechReady,
  onActivityArrive,
  onMotionChange,
  meetingFloor,
  upperFloorEnabled,
  positions,
  speaker,
  motionReduced: reduced,
}: {
  positions: RefObject<Partial<Record<CharacterId, Vector3>>>;
  speaker?: CharacterId;
  motionReduced: boolean;
  index: number;
  state: string;
  activity?: OfficeActivity;
  quality: Quality;
  avatar: AvatarPreset;
  onSelect: (id: string) => void;
  onPeek?: (id: CharacterId) => void;
  speech?: ReactNode;
  peek?: ReactNode;
  labelHost?: RefObject<HTMLDivElement>;
  onSpeechReady?: (id: CharacterId, visible: boolean) => void;
  onActivityArrive?: (id: CharacterId, activity: OfficeActivity) => void;
  onMotionChange?: (id: CharacterId, motion: CharacterMotion) => void;
  meetingFloor: MeetingFloor;
  upperFloorEnabled: boolean;
}) {
  const appearance = appearances[avatar];
  const outfit = outfits[characterIds[index]];
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const position = useRef(
    new Vector3(desks[index][0], 0, desks[index][1] + 0.72),
  );
  const [arrived, setArrived] = useState(false);
  const [speechOnScreen, setSpeechOnScreen] = useState(false);
  const speechOnScreenRef = useRef(false);
  const speechVisibilityProbe = useRef(new Vector3());
  const [motion, setMotion] = useState<CharacterMotion>("type");
  const motionRef = useRef<CharacterMotion>("type");
  useEffect(() => {
    onMotionChange?.(characterIds[index], motion);
  }, [index, motion, onMotionChange]);
  const arrivedRef = useRef(false);
  const activityArrivedRef = useRef<OfficeActivity | undefined>(undefined);
  const meeting = isAttendingMeeting(index, state);
  const activeActivity = meeting ? undefined : activity;
  const target = useMemo<CharacterTarget>(() => {
    if (activeActivity) {
      const [x, z] = activeActivity.destination;
      return {
        floor: 1,
        position: [x, 0, z],
        facing: activeActivity.facing ?? Math.PI,
      };
    }
    return characterTarget(index, state, meetingFloor, upperFloorEnabled);
  }, [activeActivity, index, meetingFloor, state, upperFloorEnabled]);
  const destination = useMemo(
    () => new Vector3(...target.position),
    [target.position],
  );
  const path = useRef<Vector3[]>([]);
  const direction = useRef(new Vector3());
  const floorTransitioning = useRef(false);
  const poseTime = useRef(0);
  const travelSpeed = useRef(0);
  const motionSpeed = useRef(0);
  const listenerYaw = useRef(0);
  useEffect(() => {
    arrivedRef.current = false;
    activityArrivedRef.current = undefined;
    setArrived(false);
    const current = position.current;
    const start: WorldPoint = [current.x, current.y, current.z];
    const route = planWorldRoute(start, target);
    floorTransitioning.current =
      Math.abs(current.y - destination.y) > 0.45 ||
      route.some((point) => Math.abs(point[1] - current.y) > 0.45);
    path.current = route.map(([x, y, z]) => new Vector3(x, y, z));
  }, [destination, target]);
  const speechVisible = !!speech && arrived && meeting && speechOnScreen;
  const peekVisible = !speech && !!peek && speechOnScreen;
  const speechPosition = useMemo(
    () =>
      (
        element: Object3D,
        camera: Camera,
        size: { width: number; height: number },
      ) =>
        speechScreenPosition(
          characterIds[index],
          element,
          camera,
          size,
          !speech,
        ),
    [index, speech],
  );
  useEffect(() => {
    onSpeechReady?.(characterIds[index], speechVisible);
    return () => onSpeechReady?.(characterIds[index], false);
  }, [index, speechVisible, onSpeechReady]);
  useFrame(({ camera }, dt) => {
    if (!root.current || !body.current || document.hidden) return;
    positions.current[characterIds[index]] = position.current;
    poseTime.current += dt;
    // Idle actors need fewer pose/projection updates; navigation remains live.
    const interval = path.current.length || speech || speaker ? 1 / 30 : 1 / 12;
    if (poseTime.current < interval) return;
    dt = poseTime.current;
    poseTime.current = 0;
    // Keep pose damping conservative, but let locomotion follow wall-clock time.
    // Otherwise low-FPS/software WebGL makes characters move in slow motion.
    const delta = Math.min(dt, 0.06);
    const movementDelta = Math.min(dt, reduced ? 0.25 : 0.5);
    if (speech || peek) {
      const probe = speechVisibilityProbe.current.set(0, 2.05, 0);
      root.current.localToWorld(probe);
      probe.project(camera);
      const onScreen =
        probe.z >= -1 &&
        probe.z <= 1 &&
        Math.abs(probe.x) <= 0.98 &&
        Math.abs(probe.y) <= 0.98;
      if (speechOnScreenRef.current !== onScreen) {
        speechOnScreenRef.current = onScreen;
        setSpeechOnScreen(onScreen);
      }
    } else if (speechOnScreenRef.current) {
      speechOnScreenRef.current = false;
      setSpeechOnScreen(false);
    }
    const cruiseSpeed = reduced
      ? 4
      : floorTransitioning.current
        ? 2.7
        : meeting
          ? 1.8
          : 1.25;
    const movement = advanceCharacterRoute(
      position.current,
      path.current,
      travelSpeed.current,
      movementDelta,
      cruiseSpeed,
      direction.current,
    );
    travelSpeed.current = movement.speed;
    motionSpeed.current = movement.traveled / Math.max(movementDelta, 0.001);
    const walking = path.current.length > 0;
    if (walking && movement.traveled > 0) {
      const facing = Math.atan2(direction.current.x, direction.current.z);
      const difference = Math.atan2(
        Math.sin(facing - root.current.rotation.y),
        Math.cos(facing - root.current.rotation.y),
      );
      root.current.rotation.y += difference * (1 - Math.exp(-dt * 10));
    }
    const atActivity = !!activeActivity && !walking && !path.current.length;
    if (
      atActivity &&
      activeActivity &&
      activityArrivedRef.current !== activeActivity
    ) {
      activityArrivedRef.current = activeActivity;
      onActivityArrive?.(characterIds[index], activeActivity);
    }
    const sitting = !walking && !path.current.length && !atActivity;
    if (arrivedRef.current !== sitting) {
      arrivedRef.current = sitting;
      setArrived(sitting);
    }
    if (!walking) {
      const facing = target.facing;
      const difference = Math.atan2(
        Math.sin(facing - root.current.rotation.y),
        Math.cos(facing - root.current.rotation.y),
      );
      root.current.rotation.y += difference * Math.min(1, delta * 7);
    }
    root.current.position.copy(position.current);
    const activityKind = activeActivity?.kind;
    const nextMotion = characterMotion({
      walking,
      sitting,
      meeting,
      speaking: !!speech,
      atActivity,
      activityKind,
    });
    if (motionRef.current !== nextMotion) {
      motionRef.current = nextMotion;
      setMotion(nextMotion);
    }
    const listener =
      meeting && sitting && speaker && speaker !== characterIds[index]
        ? positions.current[speaker]
        : undefined;
    const yaw = listener
      ? Math.atan2(
          listener.x - position.current.x,
          listener.z - position.current.z,
        ) - root.current.rotation.y
      : 0;
    listenerYaw.current = MathUtils.damp(
      listenerYaw.current,
      listener
        ? MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -0.55, 0.55)
        : 0,
      5,
      delta,
    );
  });
  const longHair = index === 1 || index === 4;
  return (
    <group
      ref={root}
      rotation={[0, Math.PI, 0]}
      name={`character-${characterIds[index]}`}
      onClick={(event) => {
        event.stopPropagation();
        const id = characterIds[index];
        if (onPeek) {
          onPeek(id);
          return;
        }
        onSelect(id);
      }}
    >
      {labelHost && (speech || peek) && (
        <Html
          portal={labelHost}
          position={[0, 2.05, 0]}
          calculatePosition={speechPosition}
          zIndexRange={speech ? [7, 6] : [4, 3]}
        >
          <div
            className="meeting-speech-anchor"
            data-character={characterIds[index]}
          >
            {speechVisible ? speech : peekVisible ? peek : null}
          </div>
        </Html>
      )}
      <group
        ref={body}
        scale={[index === 6 ? 1.05 : 1, index === 1 ? 0.98 : 1, 1]}
      >
        <mesh
          name={`character-group-badge:${characterIds[index]}`}
          position={[0.14, 1.03, 0.17]}
        >
          <boxGeometry args={[0.085, 0.045, 0.015]} />
          <meshBasicMaterial
            color={characterIdentity(characterIds[index]).color}
            toneMapped={false}
          />
        </mesh>
        <RiggedOfficeCharacter
          motion={motion}
          quality={quality}
          phase={index}
          motionSpeed={motionSpeed}
          motionReduced={reduced}
          listenerYaw={listenerYaw}
          showPhone={characterIds[index] === "boss" && state === "DISCORD"}
          style={{
            skin: appearance.skin,
            hair: appearance.hair,
            jacket: outfit.jacket,
            accent: characterIdentity(characterIds[index]).color,
            shirt: outfit.shirt,
            trousers: outfit.trousers,
            shoes: outfit.shoes,
            lapels: outfit.lapels,
            tie: outfit.tie,
            shortSleeve: outfit.shortSleeve,
            style: outfit.style,
            longHair,
            boss: characterIds[index] === "boss",
          }}
        />
      </group>
    </group>
  );
}
