import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Box3,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
} from "three";
import {
  buildCharacterVisual,
  type RiggedCharacterStyle,
} from "../src/ui/rigged-character-visual";
import type { Quality } from "../src/ui/quality";

const rig = JSON.parse(
  readFileSync(
    new URL(
      "../public/models/byga/rigged-office-humanoid.gltf",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  nodes: {
    name: string;
    translation?: [number, number, number];
    children?: number[];
  }[];
};
const style: RiggedCharacterStyle = {
  skin: "#bf9479",
  hair: "#302821",
  jacket: "#27343a",
  accent: "#c9a96b",
  shirt: "#eef1ec",
  trousers: "#252d31",
  shoes: "#1b1e20",
  lapels: true,
  tie: true,
  shortSleeve: false,
  style: "formal",
  longHair: true,
  boss: true,
};

function character(quality: Quality) {
  const root = new Group();
  const nodes = rig.nodes.map((node) => {
    const object = new Object3D();
    object.name = node.name;
    if (node.translation) object.position.set(...node.translation);
    return object;
  });
  rig.nodes.forEach((node, index) =>
    node.children?.forEach((child) => nodes[index].add(nodes[child])),
  );
  nodes.filter((node) => !node.parent).forEach((node) => root.add(node));
  const build = buildCharacterVisual(root, style, quality);
  return { root, ...build };
}

function triangleCount(root: Object3D) {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof Mesh)
      count +=
        (object.geometry.index?.count ??
          object.geometry.attributes.position.count) / 3;
  });
  return count;
}

describe("new avatar quality levels", () => {
  it.each(["low", "medium", "high", "ultra"] as const)(
    "keeps the new face, outfit and expressive hands at %s",
    (quality) => {
      const avatar = character(quality);
      for (const name of [
        "HeadMesh",
        "HairCap",
        "HairLong",
        "Torso",
        "OptionalTie",
        "LeftBrow",
        "RightBrow",
        "LeftUpperLid",
        "RightUpperLid",
        "AccessoryCoffeeCup",
        "AccessoryPhone",
      ])
        expect(avatar.root.getObjectByName(name), name).toBeDefined();
      expect(avatar.eyes).toHaveLength(4);
      expect(avatar.fingers).toHaveLength(8);
      expect(avatar.mouth.parent?.name).toBe("Head");
      avatar.fingers.forEach((finger, i) =>
        expect(finger.parent?.name).toBe(i < 4 ? "LeftHand" : "RightHand"),
      );
      expect(avatar.root.getObjectByName("AccessoryCoffeeCup")?.visible).toBe(
        false,
      );
      avatar.materials.forEach((material) => material.dispose());
    },
  );

  it("reduces geometry cost while preserving body proportions and joint placement", () => {
    const avatars = [character("low"), character("medium"), character("high")];
    const triangles = avatars.map((avatar) => triangleCount(avatar.root));
    expect(triangles[0]).toBeLessThan(triangles[2] * 0.4);
    expect(triangles[1]).toBeLessThan(triangles[2] * 0.7);
    expect(triangles[0]).toBeLessThan(triangles[1]);
    const bounds = avatars.map((avatar) =>
      new Box3().setFromObject(avatar.root),
    );
    for (const avatar of avatars.slice(0, 2)) {
      for (const name of [
        "Hips",
        "Head",
        "LeftHand",
        "RightHand",
        "LeftFoot",
        "RightFoot",
      ])
        expect(avatar.root.getObjectByName(name)?.position.toArray()).toEqual(
          avatars[2].root.getObjectByName(name)?.position.toArray(),
        );
    }
    bounds.slice(0, 2).forEach((box) => {
      expect(box.min.distanceTo(bounds[2].min)).toBeLessThan(0.025);
      expect(box.max.distanceTo(bounds[2].max)).toBeLessThan(0.025);
    });
    avatars.forEach((avatar) =>
      avatar.materials.forEach((material) => material.dispose()),
    );
  });

  it("keeps Low and Medium free of expensive physical materials and shadow passes", () => {
    for (const quality of ["low", "medium"] as const) {
      const avatar = character(quality);
      avatar.materials.forEach((material) => {
        expect(material).toBeInstanceOf(MeshStandardMaterial);
        expect(material).not.toBeInstanceOf(MeshPhysicalMaterial);
        if (quality === "low")
          expect((material as MeshStandardMaterial).bumpMap).toBeNull();
      });
      avatar.root.traverse((object) => {
        if (object instanceof Mesh) {
          expect(object.castShadow).toBe(false);
          expect(object.receiveShadow).toBe(false);
        }
      });
      avatar.materials.forEach((material) => material.dispose());
    }
  });

  it("shares geometry across actors without sharing disposable material instances", () => {
    const first = character("low"),
      second = character("low"),
      high = character("high");
    expect((first.root.getObjectByName("HeadMesh") as Mesh).geometry).toBe(
      (second.root.getObjectByName("HeadMesh") as Mesh).geometry,
    );
    expect((first.root.getObjectByName("HeadMesh") as Mesh).geometry).not.toBe(
      (high.root.getObjectByName("HeadMesh") as Mesh).geometry,
    );
    expect(first.materials[0]).not.toBe(second.materials[0]);
    [first, second, high].forEach((avatar) =>
      avatar.materials.forEach((material) => material.dispose()),
    );
  });
});
