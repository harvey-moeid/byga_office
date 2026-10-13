import { describe, expect, it } from "vitest";
import { stairFootTarget } from "../src/ui/stair-pose";
import { STAIR_LAYOUT, UPPER_FLOOR_Y } from "../src/ui/office-layout";
import { readFileSync } from "node:fs";
import { Group, Matrix4, Object3D, PropertyBinding, Vector3 } from "three";
import { createStairPose } from "../src/ui/stair-pose";

function agencySkeleton(name: string) {
  const bytes = readFileSync(
    new URL(`../public/avatars/${name}.glb`, import.meta.url),
  );
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(12, true);
  const gltf = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  );
  const nodes: Object3D[] = gltf.nodes.map(
    (node: {
      name?: string;
      matrix?: number[];
      translation?: [number, number, number];
      rotation?: [number, number, number, number];
      scale?: [number, number, number];
    }) => {
      const object = new Object3D();
      object.name = PropertyBinding.sanitizeNodeName(node.name ?? "");
      if (node.matrix)
        new Matrix4()
          .fromArray(node.matrix)
          .decompose(object.position, object.quaternion, object.scale);
      else {
        if (node.translation) object.position.fromArray(node.translation);
        if (node.rotation) object.quaternion.fromArray(node.rotation);
        if (node.scale) object.scale.fromArray(node.scale);
      }
      return object;
    },
  );
  gltf.nodes.forEach((node: { children?: number[] }, index: number) =>
    node.children?.forEach((child) => nodes[index].add(nodes[child])),
  );
  const root = new Group();
  gltf.scenes[gltf.scene ?? 0].nodes.forEach((index: number) =>
    root.add(nodes[index]),
  );
  const actor = new Group(),
    body = new Group();
  body.position.y = -0.2;
  body.scale.setScalar(0.93);
  actor.add(body);
  body.add(root);
  actor.rotation.y = Math.PI;
  return { actor, root, nodes };
}

describe("distance-driven stair feet", () => {
  it.each(
    ["aria", "nova", "kai", "leo", "iris"].flatMap((name) =>
      (["up", "down"] as const).map((direction) => [name, direction] as const),
    ),
  )(
    "finds and grounds the actual %s skeleton on %s stairs",
    (name, direction) => {
      const { actor, root, nodes } = agencySkeleton(name);
      const progress = 4.6;
      actor.rotation.y = direction === "up" ? Math.PI : 0;
      root.parent!.position.y = direction === "up" ? -0.2 : -0.12;
      actor.position.set(
        STAIR_LAYOUT.x,
        0.2 + progress * STAIR_LAYOUT.rise,
        STAIR_LAYOUT.startZ - progress * STAIR_LAYOUT.run,
      );
      const pose = createStairPose(root, true);
      const neutral = nodes.map((node) => node.quaternion.clone());
      for (let i = 0; i < 30; i++) {
        // The animation mixer supplies a fresh base pose before IK each frame.
        nodes.forEach((node, index) => node.quaternion.copy(neutral[index]));
        pose(direction, actor.position, 1 / 60, false);
      }
      const side = direction === "up" ? 0 : 1;
      const foot = root.getObjectByName(
        side ? "Bip01_R_Foot" : "Bip01_L_Foot",
      )!;
      expect(foot).toBeDefined();
      const actual = foot.getWorldPosition(new Vector3());
      const target = stairFootTarget(progress, side, direction);
      expect(Math.abs(actual.y - target.y - 0.055)).toBeLessThan(0.1);
      expect(Math.abs(actual.z - target.z)).toBeLessThan(0.1);
    },
  );
  it("plants the supporting foot on the same tread as the body moves", () => {
    const first = stairFootTarget(0.1, 0, "up");
    const later = stairFootTarget(0.9, 0, "up");
    expect(first.planted).toBe(true);
    expect(later).toEqual(first);
    expect(first.y).toBe(STAIR_LAYOUT.startY + STAIR_LAYOUT.stepThickness / 2);
    const descending = stairFootTarget(15.9, 0, "down");
    expect(stairFootTarget(15.1, 0, "down")).toEqual(descending);
    expect(descending.y).toBe(UPPER_FLOOR_Y);
  });
  it("alternates support feet and lifts the swinging foot over the riser", () => {
    const left = stairFootTarget(0.5, 0, "up");
    const right = stairFootTarget(0.5, 1, "up");
    expect(left.planted).toBe(true);
    expect(right.planted).toBe(false);
    expect(right.y).toBeGreaterThan(left.y);
    expect(stairFootTarget(2.1, 0, "up").z).toBeCloseTo(
      left.z - 2 * STAIR_LAYOUT.run,
    );
  });
  it("keeps targets finite at both landings in both directions", () => {
    for (const direction of ["up", "down"] as const)
      for (const progress of [-1, 0, 0.01, 7.5, 15, 16, 17])
        for (const side of [0, 1]) {
          const target = stairFootTarget(progress, side, direction);
          expect(Number.isFinite(target.y) && Number.isFinite(target.z)).toBe(
            true,
          );
          expect(target.y).toBeGreaterThanOrEqual(0);
        }
  });
});
