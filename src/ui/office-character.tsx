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
import { Group, Vector2, Vector3, MathUtils, Shape } from "three";
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
type Triple = [number, number, number];
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
  coffee,
  decorative,
  avatar,
  onSelect,
  speech,
  labelHost,
  onSpeechReady,
}: {
  index: number;
  state: string;
  coffee: boolean;
  decorative: boolean;
  avatar: AvatarPreset;
  onSelect: (id: string) => void;
  speech?: ReactNode;
  labelHost?: RefObject<HTMLDivElement>;
  onSpeechReady?: (id: CharacterId, visible: boolean) => void;
}) {
  const appearance = appearances[avatar];
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
  const arrivedRef = useRef(false);
  const destination = useMemo(() => {
    const [x, z] = actorDestination(index, state, coffee);
    return new Vector3(x, 0, z);
  }, [index, state, coffee]);
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
  const meeting = isAttendingMeeting(index, state);
  const speechVisible = !!speech && arrived && meeting;
  useEffect(() => {
    onSpeechReady?.(characterIds[index], speechVisible);
    return () => onSpeechReady?.(characterIds[index], false);
  }, [index, speechVisible, onSpeechReady]);
  useFrame(({ clock }, dt) => {
    if (!root.current || !body.current) return;
    const delta = Math.min(dt, 0.06);
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
          Math.min(distance, delta * (reduced ? 4 : 1.25)),
        );
        const target = Math.atan2(direction.current.x, direction.current.z);
        const difference = Math.atan2(
          Math.sin(target - root.current.rotation.y),
          Math.cos(target - root.current.rotation.y),
        );
        root.current.rotation.y += difference * Math.min(1, delta * 10);
      }
    }
    const sitting = !walking && !path.current.length && !coffee;
    if (arrivedRef.current !== sitting) {
      arrivedRef.current = sitting;
      setArrived(sitting);
    }
    if (!walking) {
      const target = seatedFacing(index, state);
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
      MathUtils.damp(body.current.position.y, sitting ? -0.445 : 0, 9, delta) +
      breathe;
    const gait =
      walking && !reduced ? Math.sin(clock.elapsedTime * 8 + index) * 0.42 : 0;
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
      if (shoulder)
        shoulder.rotation.x = MathUtils.damp(
          shoulder.rotation.x,
          drinking
            ? -1.1
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
          drinking ? -1.65 : sitting ? (meeting ? -0.7 : -0.56) : -0.12,
          10,
          delta,
        );
    }
    if (head.current) {
      head.current.rotation.y =
        decorative && !reduced && !walking
          ? Math.sin(clock.elapsedTime * 0.5 + index * 3) * 0.08
          : 0;
      head.current.rotation.x =
        sitting && !meeting
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
          position={[0, 1.82, 0]}
          center
          zIndexRange={[4, 3]}
        >
          {speechVisible ? speech : null}
        </Html>
      )}
      <group
        ref={body}
        scale={[index === 6 ? 1.05 : 1, index === 1 ? 0.98 : 1, 1]}
      >
        <mesh position={[0, 0.96, 0]} scale={[1, 1, 0.66]} castShadow>
          <latheGeometry args={[coatProfile, decorative ? 24 : 12]} />
          <meshStandardMaterial color={appearance.suit} roughness={0.9} />
        </mesh>
        <Oval
          at={[0, 0.925, -0.015]}
          size={[0.145, 0.105, 0.102]}
          color="#2b3037"
          detail={decorative}
        />
        <Panel at={[0, 1.31, 0.115]} points={shirt} color="#e8e6df" />
        <Panel
          at={[0, 1.31, 0.123]}
          points={leftLapel}
          color={appearance.accent}
        />
        <Panel
          at={[0, 1.31, 0.124]}
          points={rightLapel}
          color={appearance.accent}
        />
        {!longHair && (
          <Panel
            at={[0, 1.28, 0.131]}
            points={[
              [-0.017, 0.07],
              [0.017, 0.07],
              [0.022, -0.14],
              [0, -0.16],
              [-0.022, -0.14],
            ]}
            color={appearance.suit}
          />
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
                color="#30353d"
                detail={decorative}
              />
              <group ref={knees[limb]} position={[0, -0.42, 0]}>
                <Oval
                  at={[0, 0, 0]}
                  size={[0.056, 0.06, 0.054]}
                  color="#30353d"
                  detail={decorative}
                />
                <Limb
                  length={0.41}
                  top={0.055}
                  bottom={0.038}
                  color="#30353d"
                  detail={decorative}
                />
                <Oval
                  at={[0, -0.43, 0.048]}
                  size={[0.053, 0.045, 0.11]}
                  color="#24262a"
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
                color={appearance.suit}
                detail={decorative}
              />
              <Limb
                length={0.265}
                top={0.06}
                bottom={0.045}
                color={appearance.suit}
                detail={decorative}
              />
              <group ref={elbows[limb]} position={[0, -0.265, 0]}>
                <Oval
                  at={[0, 0, 0]}
                  size={[0.045, 0.047, 0.045]}
                  color={appearance.suit}
                  detail={decorative}
                />
                <Limb
                  length={0.235}
                  top={0.045}
                  bottom={0.032}
                  color={appearance.suit}
                  detail={decorative}
                />
                <mesh position={[0, -0.23, 0]}>
                  <cylinderGeometry args={[0.034, 0.034, 0.024, 10]} />
                  <meshStandardMaterial color="#e8e6df" />
                </mesh>
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
                {index === 7 && state === "DISCORD" && limb === 1 && (
                  <mesh position={[0, -0.28, 0.024]}>
                    <boxGeometry args={[0.06, 0.115, 0.012]} />
                    <meshStandardMaterial color="#1d252a" roughness={0.28} />
                  </mesh>
                )}
              </group>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}
