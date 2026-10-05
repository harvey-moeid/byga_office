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


function WoodSlatWall({
  position,
  rotation = [0, 0, 0],
  width = 3.8,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
}) {
  const count = Math.max(8, Math.floor(width / 0.16));
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 1.36, -0.06]} receiveShadow>
        <boxGeometry args={[width, 2.7, 0.1]} />
        <meshPhysicalMaterial
          color="#34261f"
          roughness={0.5}
          clearcoat={0.08}
          clearcoatRoughness={0.62}
        />
      </mesh>
      {Array.from({ length: count }, (_, index) => {
        const x = -width / 2 + 0.09 + index * (width / count);
        return (
          <mesh key={index} position={[x, 1.38, 0.015]} castShadow>
            <boxGeometry args={[0.055, 2.58, 0.08]} />
            <meshPhysicalMaterial
              color={index % 3 === 0 ? "#9b714d" : "#795437"}
              roughness={0.52}
              clearcoat={0.1}
              clearcoatRoughness={0.6}
            />
          </mesh>
        );
      })}
      <mesh position={[0, 0.12, 0.07]}>
        <boxGeometry args={[width * 0.92, 0.035, 0.045]} />
        <meshStandardMaterial
          color="#f0c47c"
          emissive="#c78a42"
          emissiveIntensity={1.55}
        />
      </mesh>
    </group>
  );
}

function PremiumPlanter({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.25, 0.36, 28]} />
        <meshPhysicalMaterial
          color="#c7b7a0"
          roughness={0.42}
          clearcoat={0.12}
        />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.23, 0.23, 0.035, 24]} />
        <meshStandardMaterial color="#2e261f" roughness={1} />
      </mesh>
      {Array.from({ length: 10 }, (_, index) => {
        const a = index * 2.34;
        return (
          <mesh
            key={index}
            position={[
              Math.cos(a) * 0.12,
              0.67 + (index % 4) * 0.18,
              Math.sin(a) * 0.12,
            ]}
            rotation={[0.28, a, 0.72]}
            scale={[0.13, 0.34 + (index % 3) * 0.05, 0.055]}
            castShadow
          >
            <sphereGeometry args={[1, 18, 12]} />
            <meshStandardMaterial
              color={index % 2 ? "#315a3e" : "#477450"}
              roughness={0.92}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function ReceptionConsole() {
  return (
    <group position={[4.85, 0, 6.78]}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.8, 1.05, 0.68]} />
        <meshPhysicalMaterial
          color="#d9d3c8"
          roughness={0.4}
          clearcoat={0.18}
          clearcoatRoughness={0.48}
        />
      </mesh>
      <mesh position={[0, 1.09, -0.02]} castShadow>
        <boxGeometry args={[3.96, 0.08, 0.77]} />
        <meshPhysicalMaterial
          color="#6f4b32"
          roughness={0.42}
          clearcoat={0.15}
        />
      </mesh>
      <mesh position={[0, 0.54, 0.355]}>
        <boxGeometry args={[3.36, 0.045, 0.03]} />
        <meshStandardMaterial
          color="#efc276"
          emissive="#d29545"
          emissiveIntensity={1.35}
        />
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
      <WoodSlatWall position={[6.55, 0, 7.46]} width={3.45} />
      <WoodSlatWall
        position={[8.42, 0, -4.0]}
        rotation={[0, -Math.PI / 2, 0]}
        width={3.0}
      />
      <ReceptionConsole />
      <PremiumPlanter position={[2.95, 0, 6.74]} scale={0.92} />
      <PremiumPlanter position={[7.72, 0, 6.7]} scale={1.05} />
      <PremiumPlanter position={[2.95, 0, -5.85]} scale={0.86} />
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

      <mesh position={[-6.2, 0.046, 5.7]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
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
