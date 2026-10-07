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
import {
  Group,
  Vector2,
  Vector3,
  MathUtils,
  Shape,
  type Camera,
  type Object3D,
} from "three";
import type { OfficeActivity } from "./office-activity";
import {
  characterIds,
  type AvatarPreset,
  type CharacterId,
} from "../core/contracts";
import {
  desks,
  destination as actorDestination,
  planMovement,
  isAttendingMeeting,
  seatedFacing,
} from "./navigation";
import { RiggedOfficeCharacter } from "./rigged-character";
import {
  characterMotion,
  type CharacterMotion,
} from "./character-motion";

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

type Triple = [number, number, number];

const speechProjection = new Vector3();

function speechScreenPosition(
  element: Object3D,
  camera: Camera,
  size: { width: number; height: number },
): [number, number] {
  const projected = element
    .getWorldPosition(speechProjection)
    .project(camera);
  const rawX = (projected.x * 0.5 + 0.5) * size.width;
  const rawY = (-projected.y * 0.5 + 0.5) * size.height;
  const compact = size.width <= 600;
  const landscape = size.height <= 480;
  const halfWidth = Math.min(
    compact ? 108 : landscape ? 124 : 136,
    Math.max(0, size.width / 2 - 14),
  );
  const bubbleHeight = landscape ? 88 : compact ? 108 : 120;
  const bottomClearance = landscape ? 72 : compact ? 104 : 86;
  const minAnchorY = bubbleHeight + 14;
  const maxAnchorY = Math.max(minAnchorY, size.height - bottomClearance);

  return [
    MathUtils.clamp(rawX, halfWidth + 12, size.width - halfWidth - 12),
    MathUtils.clamp(rawY, minAnchorY, maxAnchorY),
  ];
}
function Oval({
  at,
  size,
  color,
  detail,
  roughness = 0.8,
}: {
  at: Triple;
  size: Triple;
  color: string;
  detail: boolean;
  roughness?: number;
}) {
  return (
    <mesh position={at} scale={size} castShadow>
      <sphereGeometry args={[1, detail ? 20 : 10, detail ? 14 : 8]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}
function Limb({
  length,
  top,
  bottom,
  color,
  detail,
}: {
  length: number;
  top: number;
  bottom: number;
  color: string;
  detail: boolean;
}) {
  return (
    <mesh position={[0, -length / 2, 0]} castShadow>
      <cylinderGeometry args={[top, bottom, length, detail ? 16 : 8]} />
      <meshStandardMaterial color={color} roughness={0.88} />
    </mesh>
  );
}
function Panel({
  points,
  at,
  color,
}: {
  points: [number, number][];
  at: Triple;
  color: string;
}) {
  const shape = useMemo(() => {
    const value = new Shape();
    points.forEach(([x, y], i) =>
      i ? value.lineTo(x, y) : value.moveTo(x, y),
    );
    value.closePath();
    return value;
  }, [points]);
  return (
    <mesh position={at} castShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}
const coatProfile = [
  [0.001, 0],
  [0.151, 0.005],
  [0.145, 0.12],
  [0.165, 0.27],
  [0.205, 0.355],
  [0.19, 0.395],
  [0.07, 0.455],
  [0.001, 0.455],
].map(([x, y]) => new Vector2(x, y));
const headProfile = [
  [0.001, 0],
  [0.053, 0.014],
  [0.079, 0.036],
  [0.099, 0.088],
  [0.098, 0.162],
  [0.065, 0.217],
  [0.001, 0.24],
].map(([x, y]) => new Vector2(x, y));
const leftLapel: [number, number][] = [
  [-0.045, 0.13],
  [-0.13, 0.095],
  [-0.09, -0.055],
  [-0.018, -0.16],
  [-0.064, 0.005],
];
const rightLapel = leftLapel
  .map(([x, y]) => [-x, y] as [number, number])
  .reverse();
const shirt: [number, number][] = [
  [-0.052, 0.1],
  [0.052, 0.1],
  [0.025, -0.08],
  [-0.025, -0.08],
];

export function OfficeCharacter({
  index,
  state,
  activity,
  decorative,
  avatar,
  onSelect,
  speech,
  labelHost,
  onSpeechReady,
  onActivityArrive,
}: {
  index: number;
  state: string;
  activity?: OfficeActivity;
  decorative: boolean;
  avatar: AvatarPreset;
  onSelect: (id: string) => void;
  speech?: ReactNode;
  labelHost?: RefObject<HTMLDivElement>;
  onSpeechReady?: (id: CharacterId, visible: boolean) => void;
  onActivityArrive?: (id: CharacterId, activity: OfficeActivity) => void;
}) {
  const appearance = appearances[avatar];
  const outfit = outfits[characterIds[index]];
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const hips = [useRef<Group>(null), useRef<Group>(null)];
  const knees = [useRef<Group>(null), useRef<Group>(null)];
  const shoulders = [useRef<Group>(null), useRef<Group>(null)];
  const elbows = [useRef<Group>(null), useRef<Group>(null)];
  const position = useRef(
    new Vector3(desks[index][0], 0, desks[index][1] + 0.72),
  );
  const [arrived, setArrived] = useState(false);
  const [motion, setMotion] = useState<CharacterMotion>("type");
  const motionRef = useRef<CharacterMotion>("type");
  const arrivedRef = useRef(false);
  const activityArrivedRef = useRef<OfficeActivity | undefined>(undefined);
  const meeting = isAttendingMeeting(index, state);
  const activeActivity = meeting ? undefined : activity;
  const coffee =
    activeActivity?.kind === "coffee" || activeActivity?.kind === "coffee-break";
  const destination = useMemo(() => {
    if (activeActivity) {
      const [x, z] = activeActivity.destination;
      return new Vector3(x, 0, z);
    }
    const [x, z] = actorDestination(index, state);
    return new Vector3(x, 0, z);
  }, [activeActivity, index, state]);
  const path = useRef<Vector3[]>([]);
  const direction = useRef(new Vector3());
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
    arrivedRef.current = false;
    activityArrivedRef.current = undefined;
    setArrived(false);
    const current = position.current;
    const movement = planMovement(
      [current.x, current.z],
      [destination.x, destination.z],
    );
    path.current =
      movement.mode === "walk"
        ? movement.route.map(([x, z]) => new Vector3(x, 0, z))
        : [];
    if (movement.mode === "teleport")
      position.current.set(
        ...([movement.destination[0], 0, movement.destination[1]] as Triple),
      );
  }, [destination]);
  const speechVisible = !!speech && arrived && meeting;
  useEffect(() => {
    onSpeechReady?.(characterIds[index], speechVisible);
    return () => onSpeechReady?.(characterIds[index], false);
  }, [index, speechVisible, onSpeechReady]);
  useFrame(({ clock }, dt) => {
    if (!root.current || !body.current) return;
    // Keep pose damping conservative, but let locomotion follow wall-clock time.
    // Otherwise low-FPS/software WebGL makes characters move in slow motion.
    const delta = Math.min(dt, 0.06);
    const movementDelta = Math.min(dt, reduced ? 0.25 : 0.5);
    const point = path.current[0];
    let walking = false;
    if (point) {
      const distance = position.current.distanceTo(point);
      if (distance < 0.035) path.current.shift();
      else {
        walking = true;
        direction.current.copy(point).sub(position.current).normalize();
        position.current.addScaledVector(
          direction.current,
          Math.min(distance, movementDelta * (reduced ? 4 : 1.25)),
        );
        const target = Math.atan2(direction.current.x, direction.current.z);
        const difference = Math.atan2(
          Math.sin(target - root.current.rotation.y),
          Math.cos(target - root.current.rotation.y),
        );
        root.current.rotation.y += difference * Math.min(1, delta * 10);
      }
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
      const target = activeActivity?.facing ?? seatedFacing(index, state);
      const difference = Math.atan2(
        Math.sin(target - root.current.rotation.y),
        Math.cos(target - root.current.rotation.y),
      );
      root.current.rotation.y += difference * Math.min(1, delta * 7);
    }
    root.current.position.copy(position.current);
    const breathe =
      decorative && !reduced
        ? Math.sin(clock.elapsedTime * 1.6 + index) * 0.003
        : 0;
    body.current.position.y =
      MathUtils.damp(
        body.current.position.y,
        decorative ? 0 : sitting ? -0.445 : 0,
        9,
        delta,
      ) + (decorative ? 0 : breathe);
    const gait =
      walking && !reduced ? Math.sin(clock.elapsedTime * 8 + index) * 0.42 : 0;
    const activityKind = activeActivity?.kind;
    const stretching =
      atActivity &&
      (activityKind === "stretch" || activityKind === "desk-break");
    const gesturing =
      atActivity &&
      (activityKind === "chat" ||
        activityKind === "group-chat" ||
        activityKind === "briefing");
    const reviewing =
      atActivity &&
      (activityKind === "market-review" ||
        activityKind === "group-market-review");
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
    for (let side = 0; side < 2; side++) {
      const swing = side ? -gait : gait;
      const hip = hips[side].current,
        knee = knees[side].current,
        shoulder = shoulders[side].current,
        elbow = elbows[side].current;
      if (hip)
        hip.rotation.x = MathUtils.damp(
          hip.rotation.x,
          sitting ? -Math.PI / 2 : swing,
          12,
          delta,
        );
      if (knee)
        knee.rotation.x = MathUtils.damp(
          knee.rotation.x,
          sitting ? Math.PI / 2 : Math.max(0, -swing) * 1.4,
          12,
          delta,
        );
      const typing =
        decorative && !reduced && sitting && !meeting
          ? Math.sin(clock.elapsedTime * 4 + index + side) * 0.025
          : 0;
      const drinking = coffee && side === 1 && !walking;
      const activityShoulder = stretching
        ? side
          ? -2.25
          : -2.05
        : gesturing
          ? -0.45 +
            (reduced
              ? 0
              : Math.sin(clock.elapsedTime * 2.4 + index + side) * 0.22)
          : reviewing
            ? -0.32
            : undefined;
      if (shoulder)
        shoulder.rotation.x = MathUtils.damp(
          shoulder.rotation.x,
          drinking
            ? -1.1
            : activityShoulder !== undefined
              ? activityShoulder
              : sitting
                ? (meeting ? -0.5 : -0.96) +
                  typing +
                  (speech && !reduced && side === 1
                    ? Math.sin(clock.elapsedTime * 3) * 0.12
                    : 0)
                : -swing * 0.6,
          10,
          delta,
        );
      if (elbow)
        elbow.rotation.x = MathUtils.damp(
          elbow.rotation.x,
          drinking
            ? -1.65
            : stretching
              ? -0.2
              : gesturing
                ? -0.85
                : reviewing
                  ? -0.38
                  : sitting
                    ? meeting
                      ? -0.7
                      : -0.56
                    : -0.12,
          10,
          delta,
        );
    }
    if (head.current) {
      head.current.rotation.y =
        decorative && !reduced && !walking
          ? Math.sin(
              clock.elapsedTime * (gesturing ? 1.1 : 0.5) + index * 3,
            ) * (gesturing ? 0.16 : 0.08)
          : 0;
      head.current.rotation.x = reviewing
        ? -0.04
        : stretching && !reduced
          ? Math.sin(clock.elapsedTime * 1.4) * 0.06
          : sitting && !meeting
            ? 0.08
            : speech && !reduced && sitting
              ? Math.sin(clock.elapsedTime * 2) * 0.03
              : 0;
    }
  });
  const longHair = index === 1 || index === 4;
  return (
    <group
      ref={root}
      rotation={[0, Math.PI, 0]}
      name={`character-${characterIds[index]}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(characterIds[index]);
      }}
    >
      {labelHost && (
        <Html
          portal={labelHost}
          position={[0, 2.05, 0]}
          calculatePosition={speechScreenPosition}
          zIndexRange={[4, 3]}
        >
          <div
            className="meeting-speech-anchor"
            data-character={characterIds[index]}
          >
            {speechVisible ? speech : null}
          </div>
        </Html>
      )}
      <group
        ref={body}
        scale={[index === 6 ? 1.05 : 1, index === 1 ? 0.98 : 1, 1]}
      >
        {decorative ? (
          <RiggedOfficeCharacter
            motion={motion}
            motionReduced={reduced}
            showPhone={characterIds[index] === "boss" && state === "DISCORD"}
            style={{
              skin: appearance.skin,
              hair: appearance.hair,
              jacket: outfit.jacket,
              accent: outfit.accent,
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
        ) : (
          <>
        <mesh position={[0, 0.96, 0]} scale={[1, 1, 0.66]} castShadow>
          <latheGeometry args={[coatProfile, decorative ? 24 : 12]} />
          <meshStandardMaterial color={outfit.jacket} roughness={0.9} />
        </mesh>
        <Oval
          at={[0, 0.925, -0.015]}
          size={[0.145, 0.105, 0.102]}
          color={outfit.trousers}
          detail={decorative}
        />
        <Panel at={[0, 1.31, 0.115]} points={shirt} color={outfit.shirt} />
        {outfit.lapels && (
          <>
            <Panel
              at={[0, 1.31, 0.123]}
              points={leftLapel}
              color={outfit.accent}
            />
            <Panel
              at={[0, 1.31, 0.124]}
              points={rightLapel}
              color={outfit.accent}
            />
          </>
        )}
        {outfit.tie && !longHair && (
          <Panel
            at={[0, 1.28, 0.131]}
            points={[
              [-0.017, 0.07],
              [0.017, 0.07],
              [0.022, -0.14],
              [0, -0.16],
              [-0.022, -0.14],
            ]}
            color={outfit.accent}
          />
        )}
        {(outfit.style === "cool" || outfit.style === "casual") && (
          <mesh position={[0, 1.17, 0.13]} castShadow>
            <boxGeometry args={[0.012, 0.3, 0.01]} />
            <meshStandardMaterial color={outfit.accent} roughness={0.5} />
          </mesh>
        )}
        {outfit.style === "relaxed" && (
          <Oval
            at={[0, 1.345, 0.119]}
            size={[0.078, 0.017, 0.015]}
            color={outfit.accent}
            detail={false}
          />
        )}
        {characterIds[index] === "boss" && (
          <mesh position={[0.115, 1.31, 0.132]} rotation={[0, 0, -0.08]}>
            <boxGeometry args={[0.048, 0.018, 0.008]} />
            <meshStandardMaterial color={outfit.accent} roughness={0.45} />
          </mesh>
        )}
        <Oval
          at={[0.023, 1.115, 0.109]}
          size={[0.009, 0.009, 0.006]}
          color="#22282c"
          detail={false}
        />
        <mesh position={[0, 1.46, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.13, 12]} />
          <meshStandardMaterial color={appearance.skin} roughness={0.78} />
        </mesh>
        <group ref={head} position={[0, 1.51, 0]}>
          <mesh scale={[1, 1, 0.86]} castShadow>
            <latheGeometry args={[headProfile, decorative ? 28 : 16]} />
            <meshStandardMaterial color={appearance.skin} roughness={0.76} />
          </mesh>
          <Oval
            at={[0, 0.107, 0.091]}
            size={[0.019, 0.03, 0.025]}
            color={appearance.skin}
            detail={decorative}
          />
          <Oval
            at={[0, 0.045, 0.071]}
            size={[0.041, 0.022, 0.02]}
            color={appearance.skin}
            detail={decorative}
          />
          <Oval
            at={[0, 0.066, 0.089]}
            size={[0.026, 0.004, 0.006]}
            color="#9a6658"
            detail={false}
          />
          {[-1, 1].map((side) => (
            <group key={side}>
              <Oval
                at={[side * 0.096, 0.12, 0]}
                size={[0.016, 0.033, 0.02]}
                color={appearance.skin}
                detail={decorative}
              />
              <Oval
                at={[side * 0.043, 0.143, 0.078]}
                size={[0.021, 0.008, 0.009]}
                color="#e4dcd1"
                detail={decorative}
              />
              <Oval
                at={[side * 0.043, 0.143, 0.087]}
                size={[0.006, 0.006, 0.003]}
                color="#342e2a"
                detail={false}
              />
              <Oval
                at={[side * 0.043, 0.163, 0.077]}
                size={[0.026, 0.005, 0.008]}
                color={appearance.hair}
                detail={false}
              />
            </group>
          ))}
          <mesh position={[0, 0.169, -0.009]} scale={[1, 0.8, 0.94]} castShadow>
            <sphereGeometry
              args={[
                0.101,
                decorative ? 24 : 12,
                12,
                0,
                Math.PI * 2,
                0,
                Math.PI * 0.57,
              ]}
            />
            <meshStandardMaterial color={appearance.hair} roughness={0.96} />
          </mesh>
          {longHair && (
            <Oval
              at={[0, 0.045, -0.066]}
              size={[0.105, 0.14, 0.05]}
              color={appearance.hair}
              detail={decorative}
            />
          )}
        </group>
        {[-1, 1].map((side, limb) => (
          <group key={side}>
            <group ref={hips[limb]} position={[side * 0.078, 0.925, 0]}>
              <Limb
                length={0.42}
                top={0.075}
                bottom={0.055}
                color={outfit.trousers}
                detail={decorative}
              />
              <group ref={knees[limb]} position={[0, -0.42, 0]}>
                <Oval
                  at={[0, 0, 0]}
                  size={[0.056, 0.06, 0.054]}
                  color={outfit.trousers}
                  detail={decorative}
                />
                <Limb
                  length={0.41}
                  top={0.055}
                  bottom={0.038}
                  color={outfit.trousers}
                  detail={decorative}
                />
                <Oval
                  at={[0, -0.43, 0.048]}
                  size={[0.053, 0.045, 0.11]}
                  color={outfit.shoes}
                  detail={decorative}
                  roughness={0.38}
                />
              </group>
            </group>
            <group
              ref={shoulders[limb]}
              position={[side * 0.203, 1.345, 0]}
              rotation={[0, 0, side * 0.04]}
            >
              <Oval
                at={[0, -0.025, 0]}
                size={[0.063, 0.08, 0.065]}
                color={outfit.shortSleeve ? outfit.shirt : outfit.jacket}
                detail={decorative}
              />
              <Limb
                length={0.265}
                top={0.06}
                bottom={0.045}
                color={outfit.shortSleeve ? outfit.shirt : outfit.jacket}
                detail={decorative}
              />
              <group ref={elbows[limb]} position={[0, -0.265, 0]}>
                <Oval
                  at={[0, 0, 0]}
                  size={[0.045, 0.047, 0.045]}
                  color={outfit.shortSleeve ? appearance.skin : outfit.jacket}
                  detail={decorative}
                />
                <Limb
                  length={0.235}
                  top={0.045}
                  bottom={0.032}
                  color={outfit.shortSleeve ? appearance.skin : outfit.jacket}
                  detail={decorative}
                />
                {!outfit.shortSleeve && (
                  <mesh position={[0, -0.23, 0]}>
                    <cylinderGeometry args={[0.034, 0.034, 0.024, 10]} />
                    <meshStandardMaterial color={outfit.shirt} />
                  </mesh>
                )}
                <Oval
                  at={[0, -0.282, 0.006]}
                  size={[0.033, 0.055, 0.019]}
                  color={appearance.skin}
                  detail={decorative}
                />
                <Oval
                  at={[-side * 0.026, -0.27, 0.014]}
                  size={[0.013, 0.024, 0.012]}
                  color={appearance.skin}
                  detail={decorative}
                />
                {coffee && limb === 1 && (
                  <mesh position={[0, -0.29, 0.055]}>
                    <cylinderGeometry args={[0.044, 0.039, 0.08, 12]} />
                    <meshStandardMaterial color="#e2d4bf" roughness={0.4} />
                  </mesh>
                )}
                {index === characterIds.indexOf("boss") && state === "DISCORD" && limb === 1 && (
                  <mesh position={[0, -0.28, 0.024]}>
                    <boxGeometry args={[0.06, 0.115, 0.012]} />
                    <meshStandardMaterial color="#1d252a" roughness={0.28} />
                  </mesh>
                )}
              </group>
            </group>
          </group>
        ))}
          </>
        )}
      </group>
    </group>
  );
}
