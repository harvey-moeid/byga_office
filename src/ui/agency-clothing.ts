import {
  Color,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";

// Ten stable, visibly distinct outfits. The phase is the office character index,
// never animation time, so orbiting, quality changes and meetings preserve it.
export const AGENCY_OUTFIT_COLORS = [
  "#287d86",
  "#ad485c",
  "#396fb4",
  "#bb884d",
  "#719957",
  "#3e466f",
  "#88589e",
  "#bd6a36",
  "#8b99aa",
  "#33393f",
] as const;

export function agencyOutfitColor(index: number) {
  const color = AGENCY_OUTFIT_COLORS[index];
  if (!color)
    throw new Error(`No agency outfit defined for character ${index}`);
  return color;
}

export function dressAgencyCharacter(
  root: Object3D,
  mask: Texture,
  color: string,
) {
  const materials: MeshStandardMaterial[] = [];
  const owned = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  const tint = new Color(color);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const dress = (source: MeshStandardMaterial) => {
      if (!/_body$/.test(source.name)) return source;
      let material = owned.get(source);
      if (material) return material;
      material = source.clone();
      material.onBeforeCompile = (shader) => {
        shader.uniforms.bygaClothingMask = { value: mask };
        shader.uniforms.bygaOutfitColor = { value: tint };
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform sampler2D bygaClothingMask;\nuniform vec3 bygaOutfitColor;",
          )
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
          #ifdef USE_MAP
            float clothing = texture2D(bygaClothingMask, vMapUv).r;
            float fabricLight = sqrt(max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0)) * 1.8;
            diffuseColor.rgb = mix(diffuseColor.rgb, bygaOutfitColor * fabricLight, clothing);
          #endif`,
          );
      };
      material.customProgramCacheKey = () => "byga-clothing-mask-v1";
      owned.set(source, material);
      materials.push(material);
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map((material) =>
          dress(material as MeshStandardMaterial),
        )
      : dress(object.material as MeshStandardMaterial);
  });
  return materials;
}
