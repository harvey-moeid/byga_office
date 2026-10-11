import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D } from "three";
import {
  BOSS_OFFICE_LAYOUT,
  STAIR_LAYOUT,
  UPPER_EAST_WALL_X,
  UPPER_MEETING_LAYOUT,
  UPPER_MEETING_SEATS,
  UPPER_Y,
} from "./office-layout";

type Triple = [number, number, number];
type Shape = "box" | "cylinder" | "sphere";
type Finish =
  | "floor"
  | "wood"
  | "darkWood"
  | "metal"
  | "fabric"
  | "screen"
  | "glass"
  | "leaf"
  | "ceramic"
  | "paper"
  | "light"
  | "rug";

type Part = {
  shape: Shape;
  at: Triple;
  scale: Triple;
  finish: Finish;
  rotation: Triple;
};

const finishes: Record<
  Finish,
  {
    color: string;
    roughness: number;
    metalness?: number;
    opacity?: number;
    emissive?: string;
  }
> = {
  floor: { color: "#c9b79b", roughness: 0.84 },
  wood: { color: "#a67d55", roughness: 0.7 },
  darkWood: { color: "#604331", roughness: 0.58 },
  metal: { color: "#343b40", roughness: 0.42, metalness: 0.58 },
  fabric: { color: "#395f58", roughness: 0.96 },
  screen: {
    color: "#13272f",
    roughness: 0.38,
    metalness: 0.1,
    emissive: "#16313a",
  },
  glass: { color: "#b8d7d3", roughness: 0.18, opacity: 0.22 },
  leaf: { color: "#3d6748", roughness: 0.94 },
  ceramic: { color: "#d1c3ad", roughness: 0.5 },
  paper: { color: "#ebe5d8", roughness: 0.9 },
  light: {
    color: "#f7dfad",
    roughness: 0.45,
    emissive: "#c48b45",
  },
  rug: { color: "#405955", roughness: 1 },
};


function buildUpperFloor(detail: boolean): Part[] {
  const parts: Part[] = [];
  const add = (
    shape: Shape,
    at: Triple,
    scale: Triple,
    finish: Finish,
    rotation: Triple = [0, 0, 0],
  ) => parts.push({ shape, at, scale, finish, rotation });
  const box = (
    at: Triple,
    scale: Triple,
    finish: Finish,
    rotation: Triple = [0, 0, 0],
  ) => add("box", at, scale, finish, rotation);
  const cylinder = (
    at: Triple,
    radius: number,
    height: number,
    finish: Finish,
  ) => add("cylinder", at, [radius, height, radius], finish);
  const sphere = (at: Triple, scale: Triple, finish: Finish) =>
    add("sphere", at, scale, finish);

  const deck = (at: Triple, scale: Triple) => {
    box(at, scale, "floor");
    box(
      [at[0], at[1] + 0.105, at[2]],
      [Math.max(0.05, scale[0] - 0.05), 0.035, Math.max(0.05, scale[2] - 0.05)],
      "wood",
    );
  };

  // Split the upper slab around a real internal stairwell. The long opening
  // keeps the staircase visible from the cutaway instead of clipping through
  // the mezzanine or sitting outside the office panel.
  deck([4.36, UPPER_Y, 0.45], [5.32, 0.18, 13.4]);
  deck([7.635, UPPER_Y, -2.45], [1.23, 0.18, 7.6]);
  deck([7.635, UPPER_Y, 6.85], [1.23, 0.18, 0.6]);

  // A low cutaway wall exposes the stairwell and upstairs furniture.
  box([UPPER_EAST_WALL_X, UPPER_Y + 0.45, 0.45], [0.14, 0.9, 13.25], "darkWood");
  box([5.0, UPPER_Y + 1.48, -6.1], [6.45, 2.96, 0.14], "darkWood");

  // Internal staircase occupies the former floor-one Boss Office edge. It is
  // fully inside the east wall and lands on the upper corridor.
  const totalRise = (STAIR_LAYOUT.stepCount - 1) * STAIR_LAYOUT.rise;
  const totalRun = (STAIR_LAYOUT.stepCount - 1) * STAIR_LAYOUT.run;
  const stairLength = Math.hypot(totalRise, totalRun);
  const stairAngle = Math.atan2(totalRise, totalRun);
  const stairMidY = STAIR_LAYOUT.startY + totalRise / 2;
  const stairMidZ = STAIR_LAYOUT.startZ - totalRun / 2;
  const railX = STAIR_LAYOUT.width / 2 - 0.045;

  for (let i = 0; i < STAIR_LAYOUT.stepCount; i++) {
    const y = STAIR_LAYOUT.startY + i * STAIR_LAYOUT.rise;
    const z = STAIR_LAYOUT.startZ - i * STAIR_LAYOUT.run;
    box(
      [STAIR_LAYOUT.x, y, z],
      [STAIR_LAYOUT.width, STAIR_LAYOUT.stepThickness, STAIR_LAYOUT.stepDepth],
      "wood",
    );
    if (i % 2 === 0 || i === STAIR_LAYOUT.stepCount - 1)
      for (const side of [-1, 1])
        box(
          [STAIR_LAYOUT.x + side * railX, y + 0.46, z],
          [0.055, 0.92, 0.055],
          "metal",
        );
  }
  for (const side of [-1, 1]) {
    box(
      [STAIR_LAYOUT.x + side * railX, stairMidY - 0.1, stairMidZ],
      [0.075, 0.12, stairLength],
      "metal",
      [-stairAngle, 0, 0],
    );
    box(
      [STAIR_LAYOUT.x + side * railX, stairMidY + 0.9, stairMidZ],
      [0.06, 0.06, stairLength + 0.15],
      "metal",
      [-stairAngle, 0, 0],
    );
  }

  box(
    [STAIR_LAYOUT.landingX, UPPER_Y + 0.04, STAIR_LAYOUT.landingZ],
    [
      STAIR_LAYOUT.landingWidth,
      STAIR_LAYOUT.landingThickness,
      STAIR_LAYOUT.landingDepth,
    ],
    "floor",
  );
  box(
    [STAIR_LAYOUT.landingX, UPPER_Y + 0.13, STAIR_LAYOUT.landingZ],
    [STAIR_LAYOUT.landingWidth - 0.05, 0.035, STAIR_LAYOUT.landingDepth - 0.05],
    "wood",
  );

  // Guard the open stairwell edge while leaving the landing/corridor entrance
  // clear. The rails are intentionally sparse on Medium to keep the geometry
  // cheap while still reading as a real stairwell.
  const guardStartZ = STAIR_LAYOUT.openingMinZ + 0.55;
  const guardEndZ = STAIR_LAYOUT.openingMaxZ - 0.15;
  for (let z = guardStartZ; z <= guardEndZ; z += 0.9)
    box(
      [STAIR_LAYOUT.openingWestX, UPPER_Y + 0.62, z],
      [0.055, 1.05, 0.055],
      "metal",
    );
  box(
    [
      STAIR_LAYOUT.openingWestX,
      UPPER_Y + 1.1,
      (guardStartZ + guardEndZ) / 2,
    ],
    [0.065, 0.06, guardEndZ - guardStartZ + 0.1],
    "metal",
  );

  const chair = (x: number, z: number, facing = Math.PI, executive = false) => {
    cylinder([x, UPPER_Y + 0.25, z], 0.04, 0.36, "metal");
    box(
      [x, UPPER_Y + 0.48, z],
      [executive ? 0.58 : 0.5, 0.08, executive ? 0.5 : 0.46],
      executive ? "darkWood" : "fabric",
      [0, facing, 0],
    );
    box(
      [x, UPPER_Y + (executive ? 0.87 : 0.82), z - 0.2 * Math.cos(facing)],
      [executive ? 0.56 : 0.48, executive ? 0.68 : 0.58, 0.07],
      executive ? "fabric" : "fabric",
      [0, facing, 0],
    );
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      box(
        [x + Math.sin(a) * 0.16, UPPER_Y + 0.11, z + Math.cos(a) * 0.16],
        [0.035, 0.035, 0.34],
        "metal",
        [0, a, 0],
      );
    }
  };

  const monitor = (x: number, z: number, width = 0.72) => {
    box([x, UPPER_Y + 1.22, z], [width, 0.48, 0.055], "screen");
    box([x, UPPER_Y + 0.98, z + 0.01], [0.05, 0.38, 0.05], "metal");
  };

  const plant = (x: number, z: number, height: number) => {
    cylinder([x, UPPER_Y + 0.22, z], 0.24, 0.42, "ceramic");
    cylinder([x, UPPER_Y + 0.44, z], 0.2, 0.03, "darkWood");
    cylinder([x, UPPER_Y + 0.48 + height / 2, z], 0.025, height, "darkWood");
    for (let i = 0; i < (detail ? 10 : 6); i++) {
      const a = i * 2.33;
      sphere(
        [
          x + Math.cos(a) * 0.15,
          UPPER_Y + 0.75 + (i % 4) * height * 0.16,
          z + Math.sin(a) * 0.15,
        ],
        [0.13, 0.3, 0.065],
        "leaf",
      );
    }
  };

  // L2 Strategy Room: ten seats so every analyst, Risk Manager, and Boss has
  // a deterministic position. The east aisle stays clear for stair traffic.
  box(
    [UPPER_MEETING_LAYOUT.x, UPPER_Y + 0.13, UPPER_MEETING_LAYOUT.z],
    [UPPER_MEETING_LAYOUT.rugWidth, 0.02, UPPER_MEETING_LAYOUT.rugDepth],
    "rug",
  );
  box(
    [UPPER_MEETING_LAYOUT.x, UPPER_Y + 0.76, UPPER_MEETING_LAYOUT.z],
    [UPPER_MEETING_LAYOUT.tableWidth, 0.1, UPPER_MEETING_LAYOUT.tableDepth],
    "darkWood",
  );
  for (const x of [3.25, 6.05])
    box(
      [x, UPPER_Y + 0.38, UPPER_MEETING_LAYOUT.z],
      [0.09, 0.72, 0.85],
      "metal",
    );
  UPPER_MEETING_SEATS.forEach(({ position, facing }, index) =>
    chair(position[0], position[1], facing, index === UPPER_MEETING_SEATS.length - 1),
  );
  for (const x of [3.2, 4.15, 5.1, 6.05]) {
    monitor(x, -5.96, 0.8);
    box([x, UPPER_Y + 2.16, -5.94], [0.72, 0.025, 0.02], "light");
  }
  // Glass front with a doorway on the east side.
  box([3.55, UPPER_Y + 1.14, 0.05], [2.5, 2.05, 0.06], "glass");
  box([5.72, UPPER_Y + 1.14, 0.05], [0.95, 2.05, 0.06], "glass");

  // L2 Boss Office: private glass room, larger executive desk, triple market
  // monitors, guest seating, credenza, plants, and a warm feature wall.
  box(
    [BOSS_OFFICE_LAYOUT.x, UPPER_Y + 0.135, BOSS_OFFICE_LAYOUT.z],
    [BOSS_OFFICE_LAYOUT.rugWidth, 0.02, BOSS_OFFICE_LAYOUT.rugDepth],
    "rug",
  );
  box(
    [
      BOSS_OFFICE_LAYOUT.x,
      UPPER_Y + BOSS_OFFICE_LAYOUT.featureWallHeight / 2,
      BOSS_OFFICE_LAYOUT.featureWallZ,
    ],
    [
      BOSS_OFFICE_LAYOUT.featureWallWidth,
      BOSS_OFFICE_LAYOUT.featureWallHeight,
      0.11,
    ],
    "darkWood",
  );
  box(
    [BOSS_OFFICE_LAYOUT.x, UPPER_Y + 1.62, BOSS_OFFICE_LAYOUT.featureWallZ - 0.065],
    [2.2, 0.72, 0.025],
    "screen",
  );
  box(
    [BOSS_OFFICE_LAYOUT.x, UPPER_Y + 2.35, BOSS_OFFICE_LAYOUT.featureWallZ - 0.07],
    [2.8, 0.04, 0.025],
    "light",
  );

  // Glass enclosure and door gap.
  const officeMidZ =
    (BOSS_OFFICE_LAYOUT.roomMinZ + BOSS_OFFICE_LAYOUT.roomMaxZ) / 2;
  box(
    [
      BOSS_OFFICE_LAYOUT.roomMinX,
      UPPER_Y + 1.18,
      officeMidZ,
    ],
    [0.06, 2.15, BOSS_OFFICE_LAYOUT.roomMaxZ - BOSS_OFFICE_LAYOUT.roomMinZ],
    "glass",
  );
  box(
    [
      BOSS_OFFICE_LAYOUT.roomMaxX,
      UPPER_Y + 1.18,
      officeMidZ + 0.45,
    ],
    [0.06, 2.15, 2.55],
    "glass",
  );
  const leftFrontWidth =
    BOSS_OFFICE_LAYOUT.doorMinX - BOSS_OFFICE_LAYOUT.roomMinX;
  const rightFrontWidth =
    BOSS_OFFICE_LAYOUT.roomMaxX - BOSS_OFFICE_LAYOUT.doorMaxX;
  box(
    [
      BOSS_OFFICE_LAYOUT.roomMinX + leftFrontWidth / 2,
      UPPER_Y + 1.18,
      BOSS_OFFICE_LAYOUT.roomMinZ,
    ],
    [leftFrontWidth, 2.15, 0.06],
    "glass",
  );
  box(
    [
      BOSS_OFFICE_LAYOUT.doorMaxX + rightFrontWidth / 2,
      UPPER_Y + 1.18,
      BOSS_OFFICE_LAYOUT.roomMinZ,
    ],
    [rightFrontWidth, 2.15, 0.06],
    "glass",
  );

  box(
    [BOSS_OFFICE_LAYOUT.deskX, UPPER_Y + 0.76, BOSS_OFFICE_LAYOUT.deskZ],
    [BOSS_OFFICE_LAYOUT.deskWidth, 0.09, BOSS_OFFICE_LAYOUT.deskDepth],
    "darkWood",
  );
  for (const side of [-1, 1])
    box(
      [
        BOSS_OFFICE_LAYOUT.deskX + side * 0.95,
        UPPER_Y + 0.38,
        BOSS_OFFICE_LAYOUT.deskZ,
      ],
      [0.055, 0.72, 0.78],
      "metal",
    );
  for (const offset of [-0.68, 0, 0.68])
    monitor(
      BOSS_OFFICE_LAYOUT.deskX + offset,
      BOSS_OFFICE_LAYOUT.deskZ - 0.29,
      0.62,
    );
  box(
    [BOSS_OFFICE_LAYOUT.deskX, UPPER_Y + 0.81, BOSS_OFFICE_LAYOUT.deskZ + 0.23],
    [1.32, 0.025, 0.36],
    "metal",
  );
  chair(
    BOSS_OFFICE_LAYOUT.seatX,
    BOSS_OFFICE_LAYOUT.seatZ,
    BOSS_OFFICE_LAYOUT.facing,
    true,
  );

  // Guest sofa and coffee table keep the room useful without blocking the
  // corridor from the stair landing.
  box([3.0, UPPER_Y + 0.42, 4.22], [1.55, 0.48, 0.78], "fabric");
  box([3.0, UPPER_Y + 0.79, 4.52], [1.55, 0.62, 0.12], "fabric");
  box([3.0, UPPER_Y + 0.42, 5.05], [0.9, 0.08, 0.55], "darkWood");
  for (const x of [2.68, 3.32])
    box([x, UPPER_Y + 0.22, 5.05], [0.055, 0.4, 0.42], "metal");

  box([2.55, UPPER_Y + 0.65, 6.2], [0.82, 1.05, 0.48], "darkWood");
  for (let shelf = 0; shelf < 3; shelf++)
    box([2.55, UPPER_Y + 0.33 + shelf * 0.34, 5.94], [0.7, 0.035, 0.05], "wood");

  plant(6.35, 6.08, 1.25);
  plant(2.55, 3.78, 1.0);
  plant(6.35, -5.2, 1.15);

  // Small strategy console outside the private room.
  box([3.15, UPPER_Y + 0.76, 1.75], [1.65, 0.08, 0.72], "wood");
  monitor(3.15, 1.48, 0.82);
  chair(3.15, 2.35);

  for (const z of [-4.8, -1.8, 1.6, 5.15])
    box([4.85, UPPER_Y + 2.72, z], [4.25, 0.045, 0.1], "light");

  return parts;
}

function Batch({
  parts,
  detail,
  shadows,
}: {
  parts: Part[];
  detail: boolean;
  shadows: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const first = parts[0];
  const finish = finishes[first.finish];

  useLayoutEffect(() => {
    if (!ref.current) return;
    const object = new Object3D();
    parts.forEach((part, index) => {
      object.position.set(...part.at);
      object.rotation.set(...part.rotation);
      object.scale.set(...part.scale);
      object.updateMatrix();
      ref.current!.setMatrixAt(index, object.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, parts.length]}
      castShadow={shadows && first.finish !== "glass"}
      receiveShadow={shadows}
    >
      {first.shape === "box" ? (
        <boxGeometry />
      ) : first.shape === "cylinder" ? (
        <cylinderGeometry args={[1, 1, 1, detail ? 14 : 8]} />
      ) : (
        <sphereGeometry args={[1, detail ? 12 : 7, detail ? 9 : 5]} />
      )}
      <meshStandardMaterial
        color={finish.color}
        roughness={finish.roughness}
        metalness={finish.metalness ?? 0}
        transparent={finish.opacity !== undefined}
        opacity={finish.opacity ?? 1}
        depthWrite={finish.opacity === undefined}
        emissive={finish.emissive ?? "#000000"}
        emissiveIntensity={
          first.finish === "light"
            ? detail
              ? 1.8
              : 1.15
            : first.finish === "screen"
              ? 0.35
              : 0
        }
      />
    </instancedMesh>
  );
}

export function UpperFloorOffice({
  detail,
  shadows,
}: {
  detail: boolean;
  shadows: boolean;
}) {
  const batches = useMemo(() => {
    const grouped = new Map<string, Part[]>();
    for (const part of buildUpperFloor(detail)) {
      const key = `${part.shape}:${part.finish}`;
      const batch = grouped.get(key) ?? [];
      batch.push(part);
      grouped.set(key, batch);
    }
    return [...grouped.entries()];
  }, [detail]);

  return (
    <group name="upper-floor-office">
      {batches.map(([key, parts]) => (
        <Batch
          key={key}
          parts={parts}
          detail={detail}
          shadows={shadows}
        />
      ))}
    </group>
  );
}
