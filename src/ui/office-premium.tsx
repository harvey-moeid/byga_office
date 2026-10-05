import { Html } from "@react-three/drei";
import type { RefObject } from "react";

function Pendant({
  position,
  intensity = 2.8,
}: {
  position: [number, number, number];
  intensity?: number;
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.11, 0.22, 0.16, 20]} />
        <meshStandardMaterial
          color="#343130"
          metalness={0.68}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, -0.085, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.025, 20]} />
        <meshStandardMaterial
          color="#ffe7bd"
          emissive="#ffc978"
          emissiveIntensity={2.1}
          roughness={0.3}
        />
      </mesh>
      <pointLight
        position={[0, -0.18, 0]}
        color="#ffd59c"
        intensity={intensity}
        distance={5}
        decay={2}
      />
    </group>
  );
}

function GlassDoor({ x }: { x: number }) {
  return (
    <group position={[x, 1.1, 7.58]}>
      <mesh castShadow>
        <boxGeometry args={[1.28, 2.18, 0.055]} />
        <meshPhysicalMaterial
          color="#b9d7d2"
          roughness={0.08}
          metalness={0.08}
          transparent
          opacity={0.2}
          transmission={0.55}
          thickness={0.08}
          ior={1.44}
          envMapIntensity={1.25}
        />
      </mesh>
      <mesh position={[x > 0 ? -0.55 : 0.55, 0, 0.055]}>
        <boxGeometry args={[0.035, 2.16, 0.04]} />
        <meshStandardMaterial color="#303638" metalness={0.78} roughness={0.25} />
      </mesh>
      <mesh position={[x > 0 ? -0.38 : 0.38, 0, 0.075]}>
        <boxGeometry args={[0.025, 0.48, 0.035]} />
        <meshStandardMaterial color="#c5a66b" metalness={0.82} roughness={0.22} />
      </mesh>
    </group>
  );
}

/**
 * Hero architecture and lighting layered over the deterministic office shell.
 * These meshes intentionally stay separate from navigation obstacles: they sit
 * at the perimeter/ceiling and do not change any character route.
 */
export function PremiumOfficeAccents({
  labelHost,
  cinematic,
}: {
  labelHost: RefObject<HTMLDivElement>;
  cinematic: boolean;
}) {
  return (
    <group name="premium-office-accents">
      <mesh position={[0, -0.54, 0]} receiveShadow>
        <boxGeometry args={[18.9, 0.46, 16.9]} />
        <meshPhysicalMaterial
          color="#3f2d22"
          roughness={0.44}
          clearcoat={0.18}
          clearcoatRoughness={0.5}
        />
      </mesh>
      <mesh position={[0, -0.79, 0]}>
        <boxGeometry args={[19.35, 0.08, 17.35]} />
        <meshStandardMaterial color="#15191a" roughness={0.52} metalness={0.34} />
      </mesh>

      <mesh position={[4.85, 0.72, 7.7]} castShadow receiveShadow>
        <boxGeometry args={[5.15, 1.45, 0.3]} />
        <meshPhysicalMaterial
          color="#d8d2c6"
          roughness={0.52}
          clearcoat={0.12}
          clearcoatRoughness={0.55}
        />
      </mesh>
      <mesh position={[4.85, 1.31, 7.87]}>
        <boxGeometry args={[4.72, 0.055, 0.035]} />
        <meshStandardMaterial
          color="#e3bd78"
          emissive="#c58a3f"
          emissiveIntensity={1.3}
          roughness={0.3}
        />
      </mesh>
      <Html portal={labelHost} position={[4.85, 0.78, 7.89]} center>
        <div className="brand-sign-3d" aria-label="BYGA OFFICE">
          <strong>BYGA OFFICE</strong>
          <span>TRADING · BTC · GOLD · FX</span>
        </div>
      </Html>

      <GlassDoor x={-0.68} />
      <GlassDoor x={0.68} />
      <mesh position={[0, 2.24, 7.59]}>
        <boxGeometry args={[3, 0.08, 0.1]} />
        <meshStandardMaterial color="#333a3b" metalness={0.75} roughness={0.24} />
      </mesh>

      {[
        [-4, 3.08, -0.5],
        [-1, 3.08, -0.5],
        [-4, 3.08, 2.8],
        [-1, 3.08, 2.8],
        [4.2, 3.08, 0.2],
        [5.8, 3.08, 0.2],
      ].map(([x, y, z], index) => (
        <Pendant
          key={index}
          position={[x, y, z]}
          intensity={cinematic ? 3.5 : 2.25}
        />
      ))}

      {[
        [-4.8, -4.8, 3.13],
        [-1.6, -4.8, 3.13],
        [4.95, 1, 3.13],
        [6.1, 5.8, 3.13],
      ].map(([x, z, y], index) => (
        <group key={index} position={[x, y, z]}>
          <mesh>
            <boxGeometry args={[1.45, 0.045, 0.12]} />
            <meshStandardMaterial
              color="#fff0ca"
              emissive="#ffc46f"
              emissiveIntensity={cinematic ? 2.4 : 1.6}
              roughness={0.4}
            />
          </mesh>
        </group>
      ))}

      <mesh position={[-6.2, 0.045, 5.7]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.55, 48]} />
        <meshStandardMaterial color="#314944" roughness={1} />
      </mesh>

      <mesh position={[8.48, 1.62, 5.55]} rotation={[0, -Math.PI / 2, 0]}>
        <boxGeometry args={[2.2, 1.45, 0.055]} />
        <meshPhysicalMaterial
          color="#1b2828"
          roughness={0.58}
          clearcoat={0.18}
          clearcoatRoughness={0.45}
        />
      </mesh>
      <Html portal={labelHost} position={[8.42, 1.62, 5.55]} center>
        <div className="office-mantra">
          <span>DISCIPLINE</span>
          <span>PLAN</span>
          <span>EXECUTE</span>
          <b>GROW</b>
        </div>
      </Html>
    </group>
  );
}
