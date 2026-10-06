import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rig = JSON.parse(
  readFileSync(
    new URL("../public/models/byga/rigged-office-humanoid.gltf", import.meta.url),
    "utf8",
  ),
) as {
  asset: { version: string; generator: string };
  nodes: { name: string; children?: number[] }[];
  extras: { bygaRig: string; bones: string[]; license: string };
  buffers?: unknown[];
};

const requiredBones = [
  "Hips",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "LeftUpperArm",
  "LeftLowerArm",
  "LeftHand",
  "RightUpperArm",
  "RightLowerArm",
  "RightHand",
  "LeftUpperLeg",
  "LeftLowerLeg",
  "LeftFoot",
  "RightUpperLeg",
  "RightLowerLeg",
  "RightFoot",
];

describe("BYGA humanoid rig asset", () => {
  it("is a self-contained original glTF hierarchy", () => {
    expect(rig.asset.version).toBe("2.0");
    expect(rig.asset.generator).toContain("BYGA");
    expect(rig.extras.bygaRig).toBe("v1");
    expect(rig.extras.license).toContain("BYGA");
    expect(rig.buffers).toBeUndefined();
  });

  it("contains every transform animated by the office clip library", () => {
    const names = new Set(rig.nodes.map((node) => node.name));
    for (const bone of requiredBones) expect(names.has(bone)).toBe(true);
    for (const bone of requiredBones) expect(rig.extras.bones).toContain(bone);
  });

  it("contains only valid child indices", () => {
    rig.nodes.forEach((node) =>
      node.children?.forEach((child) => {
        expect(child).toBeGreaterThanOrEqual(0);
        expect(child).toBeLessThan(rig.nodes.length);
      }),
    );
  });
});
