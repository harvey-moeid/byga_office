import { expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { characterIds } from "../src/core/contracts";
import {
  agencyOutfitColor,
  dressAgencyCharacter,
} from "../src/ui/agency-clothing";

it("gives every office character a distinct, stable clothing color", () => {
  const colors = characterIds.map((_, index) => agencyOutfitColor(index));
  expect(new Set(colors).size).toBe(characterIds.length);
  expect(characterIds.map((_, index) => agencyOutfitColor(index))).toEqual(
    colors,
  );
});

it("owns each actor's clothing material while preserving skin, hair and source textures", () => {
  const body = new MeshStandardMaterial({
    name: "f008_body",
    map: new Texture(),
  });
  const head = new MeshStandardMaterial({ name: "f008_head" });
  const hair = new MeshStandardMaterial({ name: "f008_opacity" });
  const makeActor = () => {
    const root = new Group();
    root.add(
      new Mesh(undefined, [body, head, hair]),
      new Mesh(undefined, body),
    );
    return root;
  };
  const first = makeActor(),
    second = makeActor();
  const mask = new Texture();
  const firstMaterials = dressAgencyCharacter(
    first,
    mask,
    agencyOutfitColor(0),
  );
  const secondMaterials = dressAgencyCharacter(
    second,
    mask,
    agencyOutfitColor(5),
  );
  expect(firstMaterials).toHaveLength(1);
  expect(secondMaterials).toHaveLength(1);
  expect(firstMaterials[0]).not.toBe(body);
  expect(firstMaterials[0]).not.toBe(secondMaterials[0]);
  expect(firstMaterials[0].map).toBe(body.map);
  expect((first.children[0] as Mesh).material).toEqual([
    firstMaterials[0],
    head,
    hair,
  ]);
  expect((first.children[1] as Mesh).material).toBe(firstMaterials[0]);
  expect(body.color.getHexString()).toBe("ffffff");
  firstMaterials[0].dispose();
  expect(secondMaterials[0].map).toBe(body.map);
});
