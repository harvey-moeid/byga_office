import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  RepeatWrapping,
  Vector2,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

import type { Quality } from "./quality";

type OutfitStyle = "formal" | "smart" | "cool" | "casual" | "relaxed";

export type RiggedCharacterStyle = {
  skin: string;
  hair: string;
  jacket: string;
  accent: string;
  shirt: string;
  trousers: string;
  shoes: string;
  lapels: boolean;
  tie: boolean;
  shortSleeve: boolean;
  style: OutfitStyle;
  longHair: boolean;
  boss: boolean;
};

function createMaterial(
  name: string,
  color: string,
  roughness: number,
  options: { metalness?: number; clearcoat?: number } = {},
  physical = true,
) {
  if (!physical)
    return new MeshStandardMaterial({
      name,
      color,
      roughness,
      metalness: options.metalness ?? 0,
    });
  return new MeshPhysicalMaterial({
    name,
    color,
    roughness,
    metalness: options.metalness ?? 0,
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: 0.5,
  });
}

function sculptedHead(width: number, height: number) {
  const head = new SphereGeometry(1, width, height);
  const vertices = head.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i);
    // Cheekbones taper into a jaw and chin instead of a spherical face.
    vertices.setX(
      i,
      vertices.getX(i) * (y < -0.18 ? 1 + (y + 0.18) * 0.27 : 1),
    );
    if (vertices.getZ(i) > 0 && y < -0.3)
      vertices.setZ(i, vertices.getZ(i) * 0.92 + 0.07);
  }
  head.computeVertexNormals();
  return head;
}

// Shared tiny maps add cloth/skin micro-surface variation without downloads.
function surfaceTexture(woven: boolean) {
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const value = woven
        ? 150 + ((x + y) % 2) * 38
        : 166 + ((x * 17 + y * 31 + x * y * 7) % 23);
      pixels.set([value, value, value, 255], i);
    }
  const texture = new DataTexture(pixels, 32, 32);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(woven ? 8 : 3, woven ? 8 : 3);
  texture.needsUpdate = true;
  return texture;
}
const clothTexture = surfaceTexture(true);
const skinTexture = surfaceTexture(false);

function createGeometry(quality: Quality) {
  const width = quality === "low" ? 10 : quality === "medium" ? 16 : 28;
  const height = quality === "low" ? 8 : quality === "medium" ? 12 : 20;
  const smallWidth = quality === "low" ? 6 : quality === "medium" ? 8 : 14;
  const smallHeight = quality === "low" ? 4 : quality === "medium" ? 6 : 10;
  const radial = quality === "low" ? 6 : quality === "medium" ? 10 : 14;
  const caps = quality === "low" ? 3 : quality === "medium" ? 4 : 6;
  return {
    torso: new LatheGeometry(
      [
        [0.15, -0.3],
        [0.165, -0.28],
        [0.155, -0.14],
        [0.17, 0.02],
        [0.215, 0.17],
        [0.205, 0.23],
        [0.16, 0.275],
        [0.075, 0.29],
      ].map(([x, y]) => new Vector2(x, y)),
      width,
    ),
    pelvis: new SphereGeometry(1, width, height),
    head: sculptedHead(width, height),
    hair: new SphereGeometry(
      1,
      width,
      height,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.43,
    ),
    hairLong: new SphereGeometry(1, width, height),
    eye: new SphereGeometry(1, smallWidth, smallHeight),
    pupil: new SphereGeometry(1, smallWidth, smallHeight),
    nose: new SphereGeometry(1, smallWidth, smallHeight),
    mouth: new SphereGeometry(1, smallWidth, smallHeight),
    ear: new SphereGeometry(1, smallWidth, smallHeight),
    upperArm: new CapsuleGeometry(0.055, 0.23, caps, radial),
    lowerArm: new CapsuleGeometry(0.045, 0.22, caps, radial),
    upperLeg: new CapsuleGeometry(0.073, 0.304, caps, radial),
    lowerLeg: new CapsuleGeometry(0.052, 0.306, caps, radial),
    hand: new SphereGeometry(1, smallWidth, smallHeight),
    finger: new CapsuleGeometry(0.007, 0.023, 2, quality === "low" ? 4 : 6),
    brow: new CapsuleGeometry(0.0045, 0.027, 2, quality === "low" ? 4 : 8),
    button: new SphereGeometry(0.006, 8, 6),
    shoe: new SphereGeometry(1, smallWidth, smallHeight),
    neck: new CylinderGeometry(0.047, 0.052, 0.13, radial),
    lapel: new BoxGeometry(0.075, 0.22, 0.014),
    tie: new BoxGeometry(0.034, 0.23, 0.012),
    zipper: new BoxGeometry(0.012, 0.32, 0.01),
    collar: new BoxGeometry(0.17, 0.035, 0.018),
    badge: new BoxGeometry(0.05, 0.02, 0.01),
    phone: new BoxGeometry(0.065, 0.12, 0.015),
    cup: new CylinderGeometry(0.043, 0.038, 0.085, radial),
    cupHandle: new TorusGeometry(
      0.031,
      0.008,
      quality === "low" ? 4 : 8,
      radial,
      Math.PI * 1.45,
    ),
  };
}

// Geometry belongs to the shared LOD cache; individual characters only own materials.
const geometryCache = new Map<Quality, ReturnType<typeof createGeometry>>();
function characterGeometry(quality: Quality) {
  const level = quality === "ultra" ? "high" : quality;
  let geometry = geometryCache.get(level);
  if (!geometry) {
    geometry = createGeometry(level);
    geometryCache.set(level, geometry);
  }
  return geometry;
}

type CharacterBuild = {
  materials: Material[];
  eyes: Mesh[];
  fingers: Group[];
  mouth: Mesh;
};

function attachMesh(
  root: Object3D,
  boneName: string,
  name: string,
  meshGeometry: BufferGeometry,
  meshMaterial: Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const bone = root.getObjectByName(boneName);
  if (!bone) throw new Error(`BYGA humanoid rig is missing ${boneName}`);
  const mesh = new Mesh(meshGeometry, meshMaterial);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  bone.add(mesh);
  return mesh;
}

export function buildCharacterVisual(
  root: Object3D,
  style: RiggedCharacterStyle,
  quality: Quality = "high",
): CharacterBuild {
  const geometry = characterGeometry(quality);
  const detailed = quality === "high" || quality === "ultra";
  const material = (
    name: string,
    color: string,
    roughness: number,
    options: { metalness?: number; clearcoat?: number } = {},
  ) => createMaterial(name, color, roughness, options, detailed);
  const rigDriver = root.getObjectByName("RigDriver");
  if (rigDriver) rigDriver.visible = false;

  const skin = material("Skin", style.skin, 0.72, { clearcoat: 0.03 });
  const hair = material("Hair", style.hair, 0.9);
  const jacket = material("Jacket", style.jacket, 0.78, { clearcoat: 0.04 });
  const shirt = material("Shirt", style.shirt, 0.86);
  const trousers = material("Trousers", style.trousers, 0.82);
  const shoes = material("Shoes", style.shoes, 0.34, { clearcoat: 0.2 });
  const accent = material("Accent", style.accent, 0.62, { clearcoat: 0.08 });
  const eyeWhite = material("EyeWhite", "#e9e4dc", 0.35, { clearcoat: 0.2 });
  const pupil = material("Pupil", "#292520", 0.45);
  const lip = material("Lip", "#8e5e55", 0.66);
  const phoneMaterial = material("Phone", "#1d252a", 0.25, {
    metalness: 0.25,
    clearcoat: 0.25,
  });
  const cupMaterial = material("Cup", "#e2d4bf", 0.38, { clearcoat: 0.12 });
  const materials = [
    skin,
    hair,
    jacket,
    shirt,
    trousers,
    shoes,
    accent,
    eyeWhite,
    pupil,
    lip,
    phoneMaterial,
    cupMaterial,
  ];
  if (detailed) {
    skin.bumpMap = skinTexture;
    skin.bumpScale = 0.00045;
  }
  if (quality !== "low")
    for (const cloth of [jacket, shirt, trousers]) {
      cloth.bumpMap = clothTexture;
      cloth.bumpScale = 0.0007;
    }
  const eyes: Mesh[] = [];
  const fingers: Group[] = [];

  attachMesh(
    root,
    "Chest",
    "Torso",
    geometry.torso,
    jacket,
    [0, -0.015, 0],
    [1, 1, 0.7],
  );
  attachMesh(
    root,
    "Hips",
    "Pelvis",
    geometry.pelvis,
    trousers,
    [0, -0.015, 0],
    [0.16, 0.115, 0.125],
  );
  attachMesh(root, "Neck", "NeckMesh", geometry.neck, skin, [0, 0.065, 0]);
  attachMesh(
    root,
    "Head",
    "HeadMesh",
    geometry.head,
    skin,
    [0, 0.115, 0],
    [0.112, 0.14, 0.102],
  );
  attachMesh(
    root,
    "Head",
    "HairCap",
    geometry.hair,
    hair,
    [0, 0.14, -0.006],
    [0.116, 0.143, 0.108],
  );

  if (style.longHair)
    attachMesh(
      root,
      "Head",
      "HairLong",
      geometry.hairLong,
      hair,
      [0, 0.09, -0.075],
      [0.12, 0.18, 0.065],
    );

  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? "Left" : "Right";
    attachMesh(
      root,
      "Head",
      `${prefix}Ear`,
      geometry.ear,
      skin,
      [side * 0.112, 0.12, 0],
      [0.017, 0.03, 0.014],
    );
    eyes.push(
      attachMesh(
        root,
        "Head",
        `${prefix}Eye`,
        geometry.eye,
        eyeWhite,
        [side * 0.044, 0.145, 0.091],
        [0.02, 0.009, 0.009],
      ),
    );
    eyes.push(
      attachMesh(
        root,
        "Head",
        `${prefix}Pupil`,
        geometry.pupil,
        pupil,
        [side * 0.044, 0.145, 0.101],
        [0.0055, 0.0065, 0.003],
      ),
    );
    attachMesh(
      root,
      "Head",
      `${prefix}Brow`,
      geometry.brow,
      hair,
      [side * 0.044, 0.168, 0.094],
      [1, 1, 0.7],
      [0, 0, Math.PI / 2 + side * 0.1],
    );
    attachMesh(
      root,
      "Head",
      `${prefix}UpperLid`,
      geometry.brow,
      skin,
      [side * 0.044, 0.155, 0.097],
      [0.7, 1, 0.6],
      [0, 0, Math.PI / 2],
    );
    if (quality !== "low")
      attachMesh(
        root,
        "Head",
        `${prefix}InnerEar`,
        geometry.ear,
        lip,
        [side * 0.124, 0.12, 0.007],
        [0.005, 0.018, 0.006],
      );

    attachMesh(
      root,
      `${prefix}UpperArm`,
      `${prefix}UpperArmMesh`,
      geometry.upperArm,
      style.shortSleeve ? shirt : jacket,
      [0, -0.17, 0],
    );
    attachMesh(
      root,
      `${prefix}LowerArm`,
      `${prefix}LowerArmMesh`,
      geometry.lowerArm,
      style.shortSleeve ? skin : jacket,
      [0, -0.16, 0],
    );
    if (!style.shortSleeve)
      attachMesh(
        root,
        `${prefix}LowerArm`,
        `${prefix}Cuff`,
        geometry.collar,
        shirt,
        [0, -0.29, 0],
        [0.42, 0.7, 0.55],
      );
    attachMesh(
      root,
      `${prefix}Hand`,
      `${prefix}HandMesh`,
      geometry.hand,
      skin,
      [0, -0.024, 0.006],
      [0.033, 0.045, 0.024],
    );

    for (let fingerIndex = 0; fingerIndex < 4; fingerIndex++) {
      const finger = new Group();
      finger.name = `${prefix}Finger${fingerIndex}`;
      finger.position.set((fingerIndex - 1.5) * 0.015, -0.055, 0.009);
      root.getObjectByName(`${prefix}Hand`)!.add(finger);
      const length = [0.85, 1, 0.93, 0.72][fingerIndex];
      for (let segment = 0; segment < (quality === "low" ? 1 : 2); segment++) {
        const mesh = new Mesh(geometry.finger, skin);
        mesh.position.set(
          0,
          -0.014 - segment * 0.021 * length,
          segment * 0.006,
        );
        mesh.scale.y = length * (quality === "low" ? 1.5 : 1);
        mesh.rotation.x = -segment * 0.3;
        mesh.castShadow = true;
        finger.add(mesh);
      }
      fingers.push(finger);
    }
    attachMesh(
      root,
      `${prefix}Hand`,
      `${prefix}Thumb`,
      geometry.finger,
      skin,
      [-side * 0.03, -0.032, 0.019],
      [1.2, 1.25, 1.2],
      [0, 0, -side * 0.5],
    );
    if (quality !== "low")
      attachMesh(
        root,
        `${prefix}Foot`,
        `${prefix}Sole`,
        geometry.shoe,
        trousers,
        [0, -0.049, 0.075],
        [0.071, 0.024, 0.132],
      );

    attachMesh(
      root,
      `${prefix}UpperLeg`,
      `${prefix}UpperLegMesh`,
      geometry.upperLeg,
      trousers,
      [0, -0.225, 0],
    );
    attachMesh(
      root,
      `${prefix}LowerLeg`,
      `${prefix}LowerLegMesh`,
      geometry.lowerLeg,
      trousers,
      [0, -0.205, 0],
    );
    attachMesh(
      root,
      `${prefix}Foot`,
      `${prefix}Shoe`,
      geometry.shoe,
      shoes,
      [0, -0.02, 0.075],
      [0.069, 0.053, 0.13],
    );
  }

  attachMesh(
    root,
    "Head",
    "Nose",
    geometry.nose,
    skin,
    [0, 0.112, 0.108],
    [0.021, 0.034, 0.024],
  );
  const mouth = attachMesh(
    root,
    "Head",
    "Mouth",
    geometry.mouth,
    lip,
    [0, 0.067, 0.102],
    [0.029, 0.005, 0.008],
  );
  attachMesh(
    root,
    "Chest",
    "ShirtFront",
    geometry.lapel,
    shirt,
    [0, 0.11, 0.128],
    [1.3, 1.3, 0.7],
  );

  if (style.lapels) {
    attachMesh(
      root,
      "Chest",
      "OptionalLapelLeft",
      geometry.lapel,
      accent,
      [-0.07, 0.095, 0.138],
      [0.82, 1, 0.8],
      [0, 0, 0.38],
    );
    attachMesh(
      root,
      "Chest",
      "OptionalLapelRight",
      geometry.lapel,
      accent,
      [0.07, 0.095, 0.138],
      [0.82, 1, 0.8],
      [0, 0, -0.38],
    );
  }
  if (style.tie)
    attachMesh(
      root,
      "Chest",
      "OptionalTie",
      geometry.tie,
      accent,
      [0, 0.06, 0.142],
    );
  if (style.style === "cool" || style.style === "casual")
    attachMesh(
      root,
      "Chest",
      "OptionalZipper",
      geometry.zipper,
      accent,
      [0, -0.015, 0.123],
    );
  if (style.style === "relaxed")
    attachMesh(
      root,
      "Chest",
      "OptionalRelaxedCollar",
      geometry.collar,
      accent,
      [0, 0.185, 0.141],
    );
  if (style.boss)
    attachMesh(
      root,
      "Chest",
      "OptionalBossBadge",
      geometry.badge,
      accent,
      [0.125, 0.12, 0.128],
      [1, 1, 1],
      [0, 0, -0.08],
    );

  const cup = attachMesh(
    root,
    "RightHand",
    "AccessoryCoffeeCup",
    geometry.cup,
    cupMaterial,
    [0, -0.085, 0.075],
  );
  cup.visible = false;
  const cupHandle = new Mesh(geometry.cupHandle, cupMaterial);
  cupHandle.position.set(0.043, 0, 0);
  cupHandle.rotation.set(0, Math.PI / 2, 0);
  cupHandle.castShadow = true;
  cup.add(cupHandle);

  const phone = attachMesh(
    root,
    "RightHand",
    "AccessoryPhone",
    geometry.phone,
    phoneMaterial,
    [0, -0.08, 0.045],
    [1, 1, 1],
    [0.18, 0, 0],
  );
  phone.visible = false;

  // Asymmetric swept locks soften the helmet silhouette of a plain hair cap.
  for (let lock = 0; lock < (quality === "low" ? 3 : 5); lock++)
    attachMesh(
      root,
      "Head",
      `HairLock${lock}`,
      geometry.hairLong,
      hair,
      [
        -0.076 + lock * (quality === "low" ? 0.068 : 0.034),
        0.248 - Math.abs(lock - (quality === "low" ? 1 : 2)) * 0.005,
        0.024,
      ],
      [0.038, 0.028, 0.073],
      [0.12, -0.22, -0.24],
    );
  if (quality !== "low") {
    for (let button = 0; button < 3; button++)
      attachMesh(
        root,
        "Chest",
        `JacketButton${button}`,
        geometry.button,
        accent,
        [0.015, -0.04 - button * 0.065, 0.113],
      );
    attachMesh(
      root,
      "Chest",
      "BreastPocket",
      geometry.badge,
      jacket,
      [0.115, 0.09, 0.117],
      [1.2, 0.25, 0.65],
    );
    attachMesh(
      root,
      "LeftLowerArm",
      "Wristwatch",
      geometry.collar,
      shoes,
      [0, -0.285, 0.034],
      [0.36, 0.75, 0.65],
    );
    attachMesh(
      root,
      "LeftLowerArm",
      "WatchFace",
      geometry.badge,
      accent,
      [0, -0.285, 0.045],
      [0.5, 1, 0.5],
    );
  }

  root.userData.bygaCharacterRig = "v1";
  root.userData.bygaCharacterVisual = "v2";
  root.userData.bygaCharacterQuality = quality;
  root.traverse((object) => {
    if (object instanceof Mesh)
      object.castShadow = object.receiveShadow = detailed;
  });
  return { materials, eyes, fingers, mouth };
}
