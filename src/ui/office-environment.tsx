import { useLayoutEffect, useMemo, useRef, useEffect } from "react";
import {
  CanvasTexture,
  InstancedMesh,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { desks, partitions, meetingSeats } from "./navigation";

type Triple = [number, number, number];
type Finish =
  | "plaster"
  | "oak"
  | "walnut"
  | "metal"
  | "fabric"
  | "leather"
  | "screen"
  | "paper"
  | "glass"
  | "leaf"
  | "ceramic"
  | "light"
  | "led"
  | "rug"
  | "soil";
type Part = {
  shape: "box" | "sphere" | "cylinder";
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
  plaster: { color: "#e6e1d6", roughness: 0.94 },
  oak: { color: "#b59166", roughness: 0.65 },
  walnut: { color: "#705039", roughness: 0.5 },
  metal: { color: "#343b40", roughness: 0.35, metalness: 0.72 },
  fabric: { color: "#2b675c", roughness: 0.98 },
  leather: { color: "#343e3d", roughness: 0.72 },
  screen: { color: "#142a34", roughness: 0.3, emissive: "#152b35" },
  paper: { color: "#f3f1e8", roughness: 0.9 },
  glass: { color: "#bfd6d3", roughness: 0.12, metalness: 0.15, opacity: 0.17 },
  leaf: { color: "#365d42", roughness: 0.9 },
  ceramic: { color: "#d2c5b1", roughness: 0.42 },
  light: { color: "#fff4d7", roughness: 0.35, emissive: "#fff2d6" },
  led: { color: "#58d9be", roughness: 0.3, emissive: "#46bba2" },
  rug: { color: "#405b57", roughness: 1 },
  soil: { color: "#332921", roughness: 1 },
};

// Repeated furniture is batched by material/shape rather than creating a draw
// call for every desk leg, key, floorboard or server indicator.
function buildOffice(detail: boolean): Part[] {
  const parts: Part[] = [];
  const add = (
    shape: Part["shape"],
    at: Triple,
    scale: Triple,
    finish: Finish,
    rotation: Triple = [0, 0, 0],
  ) => parts.push({ shape, at, scale, finish, rotation });
  const box = (at: Triple, size: Triple, finish: Finish, rotation?: Triple) =>
    add("box", at, size, finish, rotation);
  const cylinder = (
    at: Triple,
    radius: number,
    height: number,
    finish: Finish,
    rotation?: Triple,
  ) => add("cylinder", at, [radius, height, radius], finish, rotation);
  const oval = (at: Triple, scale: Triple, finish: Finish, rotation?: Triple) =>
    add("sphere", at, scale, finish, rotation);
  const plant = (x: number, z: number, height = 1.5) => {
    cylinder([x, 0.22, z], 0.22, 0.44, "ceramic");
    cylinder([x, 0.44, z], 0.2, 0.012, "soil");
    cylinder([x, height / 2 + 0.25, z], 0.025, height - 0.3, "walnut");
    for (let i = 0; i < (detail ? 9 : 5); i++) {
      const angle = i * 2.4;
      oval(
        [
          x + Math.cos(angle) * 0.15,
          0.65 + (i % 4) * height * 0.16,
          z + Math.sin(angle) * 0.15,
        ],
        [0.12, 0.32, 0.065],
        "leaf",
        [0.3, angle, 0.65],
      );
    }
  };
  const chair = (x: number, z: number, facing = Math.PI) => {
    const local = (at: Triple): Triple => [
      x + at[0] * Math.cos(facing) + at[2] * Math.sin(facing),
      at[1],
      z - at[0] * Math.sin(facing) + at[2] * Math.cos(facing),
    ];
    cylinder([x, 0.25, z], 0.045, 0.37, "metal");
    box(local([0, 0.47, 0]), [0.52, 0.09, 0.47], "leather", [0, facing, 0]);
    box(local([0, 0.81, -0.21]), [0.49, 0.6, 0.07], "leather", [
      -0.12,
      facing,
      0,
    ]);
    for (const side of [-1, 1]) {
      box(local([side * 0.3, 0.62, -0.05]), [0.06, 0.05, 0.34], "metal", [
        0,
        facing,
        0,
      ]);
      box(local([side * 0.3, 0.52, -0.1]), [0.04, 0.2, 0.04], "metal");
    }
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      box(
        [x + Math.sin(a) * 0.15, 0.1, z + Math.cos(a) * 0.15],
        [0.035, 0.04, 0.35],
        "metal",
        [0, a, 0],
      );
      oval(
        [x + Math.sin(a) * 0.3, 0.055, z + Math.cos(a) * 0.3],
        [0.045, 0.05, 0.045],
        "leather",
      );
    }
  };
  const monitor = (x: number, z: number, width = 0.73) => {
    box([x, 0.795, z], [0.28, 0.025, 0.19], "metal");
    box([x, 0.97, z], [0.045, 0.34, 0.045], "metal");
    box([x, 1.17, z], [width, 0.46, 0.045], "metal");
    box([x, 1.17, z + 0.027], [width - 0.035, 0.415, 0.005], "screen");
    // Abstract application chrome, not simulated market data.
    box([x, 1.35, z + 0.032], [width - 0.07, 0.015, 0.005], "led");
    if (detail) {
      for (let i = 0; i < 4; i++)
        box(
          [x - width * 0.24, 1.27 - i * 0.055, z + 0.033],
          [width * 0.3, 0.007, 0.005],
          "paper",
        );
      box(
        [x + width * 0.2, 1.18, z + 0.033],
        [width * 0.22, 0.17, 0.005],
        "glass",
      );
    }
  };
  box([0, -0.28, 0], [18, 0.48, 16], "plaster");
  box([0, -0.055, 0], [17.6, 0.08, 15.6], "walnut");
  for (let row = 0; row < 39; row++) {
    for (let col = 0; col < 7; col++) {
      const start = -8.8 + col * 2.94 - (row % 2) * 1.47;
      const left = Math.max(-8.8, start),
        right = Math.min(8.8, start + 2.94);
      if (right <= left) continue;
      box(
        [(left + right) / 2, 0, -7.55 + row * 0.395],
        [right - left - 0.01, 0.04, 0.386],
        "oak",
      );
    }
  }
  // An open architectural cutaway: the front and roof stay out of the view.
  box([0, 0.48, -7.55], [17.7, 0.96, 0.18], "plaster");
  box([0, 3.18, -7.55], [17.7, 0.34, 0.18], "plaster");
  box([8.7, 1.55, 0], [0.18, 3.1, 15.3], "plaster");
  box([-8.7, 0.35, 0], [0.18, 0.7, 15.3], "plaster");
  for (let i = 0; i < 8; i++) {
    const x = -7.65 + i * 2.18;
    box([x, 2.06, -7.52], [2.08, 2.16, 0.03], "glass");
    box([x - 1.06, 2.06, -7.49], [0.045, 2.2, 0.07], "metal");
    box([x, 1.04, -7.47], [2.12, 0.045, 0.13], "metal");
    box([x, 3.05, -7.47], [2.12, 0.045, 0.13], "metal");
  }
  partitions.forEach((p) => {
    box([p.x, 1.1, p.z], [p.w, 2.2, p.d], "glass");
    box(
      [p.x, 0.045, p.z],
      [Math.max(p.w, 0.055), 0.06, Math.max(p.d, 0.055)],
      "metal",
    );
    box(
      [p.x, 2.2, p.z],
      [Math.max(p.w, 0.055), 0.035, Math.max(p.d, 0.055)],
      "metal",
    );
    box([p.x, 1, p.z], [p.w, 0.09, p.d], "paper");
    for (const end of [-1, 1])
      box(
        [
          p.x + (p.w > p.d ? (end * p.w) / 2 : 0),
          1.1,
          p.z + (p.d > p.w ? (end * p.d) / 2 : 0),
        ],
        [0.04, 2.2, 0.04],
        "metal",
      );
  });
  box([-2.65, 0.035, 0.65], [7.4, 0.012, 6.6], "rug");
  box([5, 0.035, 1], [4.8, 0.015, 4.5], "rug");
  desks.forEach(([x, z], index) => {
    const executive = index > 5;
    box([x, 0.76, z], [1.6, 0.065, 0.85], executive ? "walnut" : "oak");
    for (const side of [-1, 1]) {
      box([x + side * 0.67, 0.38, z], [0.035, 0.72, 0.72], "metal");
      box([x + side * 0.67, 0.035, z], [0.09, 0.025, 0.8], "metal");
    }
    box([x, 0.6, z - 0.3], [1.35, 0.08, 0.06], "metal");
    monitor(x - 0.38, z - 0.22);
    monitor(x + 0.38, z - 0.22);
    box([x, 0.8, z + 0.2], [0.75, 0.008, 0.31], "leather");
    box([x - 0.06, 0.815, z + 0.18], [0.4, 0.021, 0.13], "metal");
    oval([x + 0.29, 0.818, z + 0.19], [0.033, 0.015, 0.05], "metal");
    if (detail) {
      for (let row = 0; row < 3; row++)
        for (let key = 0; key < 9; key++)
          box(
            [x - 0.23 + key * 0.042, 0.829, z + 0.135 + row * 0.04],
            [0.032, 0.006, 0.022],
            "paper",
          );
      box(
        [x - 0.6, 0.801, z + 0.14],
        [0.17, 0.017, 0.22],
        "paper",
        [0, -0.12, 0],
      );
      cylinder([x + 0.62, 0.85, z + 0.13], 0.044, 0.1, "ceramic");
      box([x - 0.75, 0.4, z - 0.25], [0.14, 0.52, 0.45], "metal");
    }
    if (!detail) chair(x, z + 0.72);
  });
  box([5, 0.76, 1], [3, 0.09, 1.4], "walnut");
  for (const x of [4, 6]) box([x, 0.38, 1], [0.08, 0.72, 0.8], "metal");
  if (!detail)
    meetingSeats.forEach(({ position: [x, z], facing }) =>
      chair(x, z, facing),
    );
  for (let i = 0; i < 4; i++) {
    if (detail)
      box(
        [4 + i * 0.65, 0.812, i % 2 ? 1.3 : 0.65],
        [0.19, 0.014, 0.27],
        "paper",
        [0, 0.12, 0],
      );
  }
  // Lobby seating. Detailed profiles use the local GLTF sofa asset; the
  // procedural fallback keeps low-quality/WebGL-software devices lightweight.
  if (!detail) {
    box([-6.2, 0.24, 5.7], [2.1, 0.38, 0.8], "fabric");
    box([-6.2, 0.68, 6.05], [2.1, 0.5, 0.13], "fabric");
    for (const x of [-7.19, -5.21])
      box([x, 0.5, 5.7], [0.14, 0.48, 0.8], "fabric");
    for (const x of [-6.68, -5.72])
      box([x, 0.46, 5.7], [0.87, 0.075, 0.62], "fabric");
  }
  box([-6.2, 0.34, 4.7], [1.3, 0.055, 0.45], "walnut");
  for (const x of [-6.7, -5.7])
    box([x, 0.16, 4.7], [0.055, 0.3, 0.35], "metal");
  box([-6.4, 0.383, 4.7], [0.28, 0.025, 0.22], "paper");
  // Pantry cabinetry, handles, sink, coffee machine and a small fridge.
  box([-2, 0.46, 7], [3, 0.85, 0.6], "walnut");
  box([-2, 0.9, 7], [3.1, 0.055, 0.66], "ceramic");
  for (let i = 0; i < 5; i++) {
    box([-3.2 + i * 0.6, 0.46, 6.69], [0.574, 0.77, 0.015], "oak");
    box([-3.2 + i * 0.6, 0.72, 6.665], [0.2, 0.015, 0.025], "metal");
  }
  box([-2.65, 0.931, 7], [0.45, 0.009, 0.35], "metal");
  cylinder([-2.65, 1.04, 7.19], 0.017, 0.22, "metal");
  box([-1.15, 1.13, 7], [0.32, 0.42, 0.32], "metal");
  box([-1.15, 1.22, 6.83], [0.23, 0.12, 0.012], "screen");
  box([-1.15, 0.96, 6.86], [0.25, 0.035, 0.21], "metal");
  cylinder([-1.15, 1.02, 6.82], 0.04, 0.1, "ceramic");
  for (const x of [-0.85, -0.68]) cylinder([x, 0.98, 7], 0.04, 0.1, "ceramic");
  // Ventilated server racks: doors, shelves and indicators, no remote assets.
  for (const z of [-0.83, 0, 0.83]) {
    box([-7.65, 1.03, z], [0.7, 2.06, 0.75], "metal");
    box([-7.285, 1.05, z], [0.015, 1.9, 0.65], "screen");
    for (let row = 0; row < (detail ? 10 : 5); row++) {
      const y = 0.25 + row * (detail ? 0.17 : 0.34);
      box([-7.265, y, z], [0.02, 0.12, 0.57], "leather");
      box([-7.25, y, z + 0.22], [0.025, 0.025, 0.04], "led");
    }
  }
  // Storage in back offices and framed acoustic/art panels on the right wall.
  for (const z of [-4, 6]) {
    box([8.25, 0.52, z], [0.62, 1.0, 2.3], "walnut");
    box([8.25, 1.045, z], [0.68, 0.045, 2.35], "oak");
    for (let i = 0; i < 5; i++)
      box([7.928, 0.52, z - 0.9 + i * 0.45], [0.016, 0.89, 0.426], "oak");
    box([8.585, 2.1, z], [0.05, 1.05, 1.8], "walnut");
    box([8.55, 2.1, z], [0.01, 0.94, 1.66], "rug");
  }
  // Wall sconces and hidden warm linear lighting.
  for (const z of [-5.8, -0.6, 3.3, 6.7]) {
    box([8.55, 2.8, z], [0.15, 0.12, 0.4], "metal");
    box([8.48, 2.77, z], [0.12, 0.04, 0.32], "light");
  }
  box([0, 3.025, -7.35], [16.7, 0.035, 0.045], "light");
  plant(-7.9, -5.5, 1.8);
  plant(-7.8, 6.7, 1.5);
  plant(7.9, -6.1, 1.7);
  plant(7.9, 3.1, 1.5);
  return parts;
}

function grainTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#c8b797";
    ctx.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 180; i++) {
      ctx.strokeStyle = `rgba(66,42,24,${0.04 + (i % 7) * 0.009})`;
      ctx.lineWidth = i % 9 === 0 ? 1.2 : 0.45;
      ctx.beginPath();
      for (let y = 0; y <= 512; y += 8) {
        const x = ((i * 0.713) % 128) + Math.sin(y / 90 + i) * 2;
        if (!y) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 2;
  return texture;
}

function Batch({
  parts,
  detail,
  texture,
}: {
  parts: Part[];
  detail: boolean;
  texture: CanvasTexture;
}) {
  const ref = useRef<InstancedMesh>(null);
  const first = parts[0];
  const finish = finishes[first.finish];
  useLayoutEffect(() => {
    if (!ref.current) return;
    const object = new Object3D();
    parts.forEach((part, i) => {
      object.position.set(...part.at);
      object.scale.set(...part.scale);
      object.rotation.set(...part.rotation);
      object.updateMatrix();
      ref.current!.setMatrixAt(i, object.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, parts.length]}
      castShadow={first.finish !== "glass"}
      receiveShadow
    >
      {first.shape === "box" ? (
        <boxGeometry />
      ) : first.shape === "cylinder" ? (
        <cylinderGeometry args={[1, 1, 1, detail ? 16 : 10]} />
      ) : (
        <sphereGeometry args={[1, detail ? 14 : 8, detail ? 10 : 6]} />
      )}
      <meshPhysicalMaterial
        color={finish.color}
        roughness={finish.roughness}
        metalness={finish.metalness ?? 0}
        transparent={!!finish.opacity}
        opacity={finish.opacity ?? 1}
        depthWrite={!finish.opacity}
        emissive={finish.emissive ?? "#000000"}
        emissiveIntensity={
          first.finish === "light" ? 2.2 : first.finish === "screen" ? 0.5 : 0.3
        }
        map={
          first.finish === "oak" || first.finish === "walnut" ? texture : null
        }
        clearcoat={
          first.finish === "leather" || first.finish === "ceramic" ? 0.24 : 0.05
        }
        clearcoatRoughness={first.finish === "leather" ? 0.55 : 0.35}
        transmission={first.finish === "glass" && detail ? 0.42 : 0}
        thickness={first.finish === "glass" ? 0.08 : 0}
        ior={first.finish === "glass" ? 1.44 : 1.5}
        envMapIntensity={first.finish === "glass" ? 1.3 : 0.85}
      />
    </instancedMesh>
  );
}

export function OfficeEnvironment({ detail }: { detail: boolean }) {
  const texture = useMemo(grainTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const batches = useMemo(() => {
    const map = new Map<string, Part[]>();
    buildOffice(detail).forEach((part) => {
      const key = `${part.shape}:${part.finish}`;
      const group = map.get(key) ?? [];
      group.push(part);
      map.set(key, group);
    });
    return [...map.entries()];
  }, [detail]);
  return (
    <group name="furnished-office">
      {batches.map(([key, parts]) => (
        <Batch key={key} parts={parts} detail={detail} texture={texture} />
      ))}
    </group>
  );
}
