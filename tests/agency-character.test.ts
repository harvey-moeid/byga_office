import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("bundles the licensed agency models with intact textures, rigs and motion clips", () => {
  const base = new URL("../public/avatars/", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", base), "utf8"),
  );
  expect(
    readFileSync(new URL("LICENSE-Rocketbox.txt", base), "utf8"),
  ).toContain("Permission is hereby granted");
  for (const avatar of manifest.avatars) {
    const bytes = readFileSync(new URL(`${avatar.name}.glb`, base));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      avatar.sha256,
    );
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
    const gltf = JSON.parse(
      new TextDecoder().decode(
        bytes.subarray(
          20,
          20 +
            new DataView(
              bytes.buffer,
              bytes.byteOffset,
              bytes.byteLength,
            ).getUint32(12, true),
        ),
      ),
    );
    expect(gltf.skins.length).toBeGreaterThan(0);
    expect(
      gltf.images.every(
        (image: { bufferView?: number }) => image.bufferView !== undefined,
      ),
    ).toBe(true);
    expect(gltf.animations.map((clip: { name: string }) => clip.name)).toEqual(
      avatar.clips,
    );
  }
});
