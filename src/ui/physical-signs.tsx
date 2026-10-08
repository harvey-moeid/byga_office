import { useEffect, useMemo } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import type { ScannerOutput } from "../core/contracts";
import type { Quality } from "./quality";
import { roomSignDefinitions, type RoomSignSpec } from "./room-sign-layout";

function textureFromCanvas(canvas: HTMLCanvasElement) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

function drawSignTexture(sign: RoomSignSpec, quality: Quality) {
  const canvas = document.createElement("canvas");
  const detailed = quality === "high" || quality === "ultra";
  canvas.width = detailed ? 1024 : 512;
  canvas.height = detailed ? 256 : 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const scale = canvas.width / 512;
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, 512, 128);
    // The metal is a real mesh. Use the texture only for permanent lettering.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${sign.subtitle ? 43 : 51}px system-ui, sans-serif`;
    if (quality !== "low") {
      ctx.shadowColor = "#100e0bcc";
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = "#e4c68d";
    ctx.fillText(sign.label, 256, sign.subtitle ? 49 : 64, 464);
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
    if (sign.subtitle) {
      ctx.fillStyle = "#bcae97";
      ctx.font = "600 23px system-ui, sans-serif";
      ctx.fillText(sign.subtitle, 256, 99, 448);
    }
  }
  return textureFromCanvas(canvas);
}

export function PhysicalSign({
  sign,
  quality,
  onClick,
}: {
  sign: RoomSignSpec;
  quality: Quality;
  onClick?: () => void;
}) {
  const texture = useMemo(
    () => drawSignTexture(sign, quality),
    [quality, sign.label, sign.subtitle],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const detailed = quality === "high" || quality === "ultra";
  const raised = quality !== "low";
  const { width, height } = sign;
  const legHeight = Math.max(0.12, sign.position[1] - height / 2 - 0.06);
  return (
    <group
      name={`room-sign:${sign.id}`}
      position={sign.position}
      rotation={[0, sign.rotationY ?? 0, 0]}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      {sign.mount === "wall" && [-1, 1].map((side) => (
        <mesh key={side} position={[side * width * 0.29, 0, -0.16]}>
          <boxGeometry args={[0.035, 0.055, 0.28]} />
          <meshStandardMaterial color="#5c564c" metalness={0.64} roughness={0.47} />
        </mesh>
      ))}
      {sign.mount === "stand" && (
        <>
          <mesh position={[0, -height / 2 - legHeight / 2, -0.005]}>
            <boxGeometry args={[0.065, legHeight, 0.065]} />
            <meshStandardMaterial color="#424746" roughness={0.45} metalness={0.58} />
          </mesh>
          <mesh position={[0, -sign.position[1] + 0.045, 0]}>
            <boxGeometry args={[Math.min(0.5, width * 0.45), 0.08, 0.34]} />
            <meshStandardMaterial color="#303636" roughness={0.48} metalness={0.52} />
          </mesh>
        </>
      )}
      <mesh castShadow={detailed}>
        <boxGeometry args={[width, height, 0.07]} />
        <meshStandardMaterial
          color={sign.style === "hero" ? "#242c2d" : "#343737"}
          metalness={quality === "low" ? 0.22 : 0.55}
          roughness={quality === "low" ? 0.72 : 0.43}
        />
      </mesh>
      {detailed && (
        <mesh position={[0, 0, 0.038]}>
          <boxGeometry args={[width - 0.065, height - 0.065, 0.008]} />
          <meshStandardMaterial color="#a98a56" metalness={0.8} roughness={0.32} />
        </mesh>
      )}
      <mesh position={[0, 0, detailed ? 0.047 : 0.041]}>
        <planeGeometry args={[width - (detailed ? 0.105 : 0.05), height - (detailed ? 0.10 : 0.045)]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>
      {raised && (
        <mesh position={[0, -height / 2 + 0.034, 0.046]}>
          <boxGeometry args={[width - 0.12, 0.012, 0.015]} />
          <meshStandardMaterial color="#bf9e67" metalness={0.6} roughness={0.38} />
        </mesh>
      )}
    </group>
  );
}

export function RoomSigns({
  quality,
  upperFloor,
  onSelect,
}: {
  quality: Quality;
  upperFloor: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <group name="physical-room-signs">
      {roomSignDefinitions
        .filter((sign) => sign.floor !== 2 || upperFloor)
        .map((sign) => (
          <PhysicalSign
            key={sign.id}
            sign={sign}
            quality={quality}
            onClick={sign.interactive ? () => onSelect("server-room") : undefined}
          />
        ))}
    </group>
  );
}

function scannerTexture(scanners: ScannerOutput[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#0e2129";
    ctx.fillRect(0, 0, 768, 512);
    ctx.fillStyle = "#d5e7df";
    ctx.font = "700 39px system-ui, sans-serif";
    ctx.fillText("SCANNER STATUS", 38, 56);
    ctx.fillStyle = "#88a8a4";
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.fillText("LIVE · DETERMINISTIC SIGNALS", 38, 89);
    if (!scanners.length) {
      ctx.fillStyle = "#b4c9bf";
      ctx.font = "600 29px system-ui, sans-serif";
      ctx.fillText("WAITING FOR SCANNER DATA", 38, 262);
    }
    scanners.slice(0, 6).forEach((scanner, index) => {
      const y = 145 + index * 56;
      ctx.fillStyle = "#cfdfd8";
      ctx.font = "600 25px system-ui, sans-serif";
      ctx.fillText(scanner.name.toUpperCase().replaceAll("-", " "), 38, y, 530);
      ctx.fillStyle =
        scanner.direction === "BUY" ? "#83d7ac" :
        scanner.direction === "SELL" ? "#f2a49a" : "#e6c78c";
      ctx.textAlign = "right";
      ctx.font = "700 26px system-ui, sans-serif";
      ctx.fillText(scanner.direction, 728, y);
      ctx.textAlign = "left";
      ctx.fillStyle = "#244147";
      ctx.fillRect(38, y + 10, 690, 1);
    });
  }
  return textureFromCanvas(canvas);
}

// Scanner output is painted onto a screen inside the actual Scanner Command
// area. Re-render only when scanner data changes, never as an Html overlay.
export function ScannerDisplay({ scanners }: { scanners: ScannerOutput[] }) {
  const texture = useMemo(() => scannerTexture(scanners), [scanners]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group name="scanner-command-monitor" position={[-6, 1.52, -7.25]}>
      <mesh>
        <boxGeometry args={[3.15, 1.7, 0.12]} />
        <meshStandardMaterial color="#262f33" metalness={0.35} roughness={0.52} />
      </mesh>
      <mesh position={[0, 0, 0.067]}>
        <planeGeometry args={[3.01, 1.55]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
