import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D } from "three";

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

const UPPER_Y = 3.55;

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

  box([5.0, UPPER_Y, 0.45], [6.6, 0.18, 13.4], "floor");
  box([5.0, UPPER_Y + 0.105, 0.45], [6.28, 0.035, 13.05], "wood");
  box([4.9, UPPER_Y + 0.13, -3.7], [5.5, 0.02, 4.25], "rug");
  box([4.65, UPPER_Y + 0.13, 4.85], [4.2, 0.02, 2.7], "rug");

  box([8.25, UPPER_Y + 1.48, 0.45], [0.14, 2.96, 13.25], "darkWood");
  box([5.0, UPPER_Y + 1.48, -6.1], [6.45, 2.96, 0.14], "darkWood");
  for (let z = -5.5; z <= 6.1; z += 1.45) {
    box([1.75, UPPER_Y + 0.72, z], [0.055, 1.35, 0.055], "metal");
    box([1.75, UPPER_Y + 1.37, z], [0.09, 0.055, 1.35], "metal");
  }
  box([1.75, UPPER_Y + 1.38, 0.4], [0.08, 0.06, 12.9], "metal");

  // External stair placement keeps existing floor-one character routing intact.
  for (let i = 0; i < 14; i++) {
    const y = 0.18 + i * 0.245;
    const z = 6.3 - i * 0.39;
    box([9.05, y, z], [1.15, 0.16, 0.42], "wood");
    box([8.55, y - 0.08, z], [0.08, Math.max(0.18, y * 0.95), 0.08], "metal");
    box([9.55, y - 0.08, z], [0.08, Math.max(0.18, y * 0.95), 0.08], "metal");
  }
  box([8.78, UPPER_Y + 0.02, 0.98], [1.75, 0.15, 1.3], "floor");

  const desk = (x: number, z: number) => {
    box([x, UPPER_Y + 0.76, z], [1.55, 0.08, 0.78], "wood");
    for (const dx of [-0.63, 0.63])
      box([x + dx, UPPER_Y + 0.39, z], [0.055, 0.72, 0.62], "metal");
    box([x, UPPER_Y + 1.18, z - 0.22], [0.78, 0.48, 0.055], "screen");
    box([x, UPPER_Y + 0.96, z - 0.21], [0.05, 0.37, 0.05], "metal");
    box([x, UPPER_Y + 0.8, z + 0.18], [0.72, 0.025, 0.27], "metal");
    if (detail)
      for (let row = 0; row < 3; row++)
        for (let key = 0; key < 8; key++)
          box(
            [x - 0.19 + key * 0.052, UPPER_Y + 0.825, z + 0.13 + row * 0.04],
            [0.038, 0.008, 0.024],
            "paper",
          );
  };

  const chair = (x: number, z: number, facing = Math.PI) => {
    cylinder([x, UPPER_Y + 0.25, z], 0.04, 0.36, "metal");
    box([x, UPPER_Y + 0.48, z], [0.5, 0.08, 0.46], "fabric", [0, facing, 0]);
    box(
      [x, UPPER_Y + 0.82, z - 0.2 * Math.cos(facing)],
      [0.48, 0.58, 0.07],
      "fabric",
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

  [
    [3.2, -4.6],
    [5.25, -4.6],
    [7.0, -4.6],
  ].forEach(([x, z]) => {
    desk(x, z);
    chair(x, z + 0.72);
  });

  box([5.25, UPPER_Y + 0.76, -1.25], [3.5, 0.1, 1.2], "darkWood");
  for (const x of [4.05, 5.25, 6.45]) {
    chair(x, -0.25, Math.PI);
    chair(x, -2.25, 0);
  }
  for (const x of [4.35, 5.05, 5.75, 6.45])
    box([x, UPPER_Y + 0.82, -1.25], [0.25, 0.018, 0.34], "paper");

  for (let i = 0; i < 4; i++) {
    const x = 3.05 + i * 1.35;
    box([x, UPPER_Y + 1.78, -6.0], [1.15, 0.72, 0.06], "screen");
    box([x, UPPER_Y + 2.15, -5.96], [1.0, 0.025, 0.02], "light");
    if (detail)
      for (let row = 0; row < 4; row++)
        box(
          [x - 0.28 + row * 0.18, UPPER_Y + 1.66 + (row % 2) * 0.14, -5.955],
          [0.12, 0.018, 0.015],
          row % 2 ? "paper" : "light",
        );
  }

  box([4.25, UPPER_Y + 0.38, 5.25], [2.25, 0.44, 0.88], "fabric");
  box([4.25, UPPER_Y + 0.82, 5.62], [2.25, 0.62, 0.14], "fabric");
  for (const x of [3.2, 5.3])
    box([x, UPPER_Y + 0.54, 5.25], [0.16, 0.58, 0.86], "fabric");
  box([4.25, UPPER_Y + 0.4, 4.05], [1.35, 0.08, 0.65], "darkWood");
  for (const x of [3.72, 4.78])
    box([x, UPPER_Y + 0.2, 4.05], [0.055, 0.38, 0.5], "metal");

  box([7.25, UPPER_Y + 0.58, 5.25], [1.25, 1.05, 0.62], "darkWood");
  box([7.25, UPPER_Y + 1.12, 5.25], [1.32, 0.06, 0.68], "ceramic");
  box([7.0, UPPER_Y + 1.32, 5.12], [0.36, 0.42, 0.34], "metal");
  box([7.0, UPPER_Y + 1.42, 4.93], [0.24, 0.12, 0.02], "screen");
  for (const x of [7.42, 7.62])
    cylinder([x, UPPER_Y + 1.22, 5.05], 0.05, 0.12, "ceramic");

  for (const z of [1.7, 3.1]) {
    box([7.85, UPPER_Y + 1.0, z], [0.55, 1.85, 1.15], "darkWood");
    for (let shelf = 0; shelf < 4; shelf++)
      box([7.53, UPPER_Y + 0.35 + shelf * 0.45, z], [0.04, 0.04, 1.02], "wood");
    for (let book = 0; book < (detail ? 10 : 6); book++)
      box(
        [7.48, UPPER_Y + 0.48 + (book % 4) * 0.45, z - 0.42 + (book % 5) * 0.18],
        [0.04, 0.24, 0.1],
        book % 3 === 0 ? "paper" : "fabric",
      );
  }

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

  [
    [2.25, -5.35, 1.25],
    [7.55, -5.2, 1.35],
    [2.35, 2.85, 1.15],
    [7.45, 4.05, 1.3],
    [2.45, 6.25, 1.2],
    [6.2, 6.2, 1.15],
  ].forEach(([x, z, height]) => plant(x, z, height));

  for (const z of [-4.8, -1.6, 1.7, 5.1])
    box([5.0, UPPER_Y + 2.72, z], [4.6, 0.045, 0.1], "light");

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
