import { Clone, useGLTF } from "@react-three/drei";
import { analystDesks, desks, meetingSeats } from "./navigation";

const CHAIR_MODEL = "/models/byga/executive-chair.gltf";
const SOFA_MODEL = "/models/byga/lounge-sofa.gltf";

function Chair({
  position,
  facing,
  scale = 1,
}: {
  position: [number, number, number];
  facing: number;
  scale?: number;
}) {
  const model = useGLTF(CHAIR_MODEL);
  return (
    <group position={position} rotation={[0, facing, 0]} scale={scale}>
      <Clone object={model.scene} castShadow receiveShadow />
    </group>
  );
}

function Sofa() {
  const model = useGLTF(SOFA_MODEL);
  return (
    <group position={[-6.2, 0, 5.7]} rotation={[0, Math.PI, 0]}>
      <Clone object={model.scene} castShadow receiveShadow />
    </group>
  );
}

/**
 * Local GLTF furniture used for the medium/high/ultra scene.
 * Architecture and routing remain deterministic/procedural, while hero
 * furniture is asset-based so the office can keep gaining detail without
 * turning scene.tsx into a collection of one-off meshes.
 */
export function HybridOfficeAssets() {
  return (
    <group name="hybrid-office-assets">
      {desks.map(([x, z], index) => (
        <Chair
          key={`desk-chair-${index}`}
          position={[x, 0, z + 0.72]}
          facing={Math.PI}
          scale={index >= analystDesks.length ? 1.04 : 1}
        />
      ))}
      {meetingSeats.map(({ position: [x, z], facing }, index) => (
        <Chair
          key={`meeting-chair-${index}`}
          position={[x, 0, z]}
          facing={facing}
          scale={0.96}
        />
      ))}
      <Sofa />
    </group>
  );
}

useGLTF.preload(CHAIR_MODEL);
useGLTF.preload(SOFA_MODEL);
