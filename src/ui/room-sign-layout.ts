import { BOSS_OFFICE_LAYOUT, UPPER_MEETING_LAYOUT, UPPER_Y } from "./office-layout";
import { rooms } from "./navigation";

export type SignMount = "wall" | "stand";
export type SignStyle = "plaque" | "hero";
export interface RoomSignSpec {
  id: string;
  label: string;
  position: [number, number, number];
  rotationY?: number;
  width: number;
  height: number;
  mount: SignMount;
  style: SignStyle;
  subtitle?: string;
  floor?: 1 | 2;
  interactive?: boolean;
}

// World-space plaques anchored to existing racks, feature walls, partitions or
// compact perimeter stands. No floating HTML; every sign has a physical support.
// The sign face is +Z before the optional Y rotation (overview sees +Z).
export const roomSignDefinitions: RoomSignSpec[] = [
  { id: "BYGA Lobby", label: "BYGA LOBBY", position: [-7.92, 1.3, 4.1], width: 1.55, height: 0.36, mount: "stand", style: "plaque" },
  { id: "Analyst Floor", label: "ANALYST FLOOR", position: [-6.94, 1.6, 2.75], width: 1.92, height: 0.43, mount: "stand", style: "hero" },
  { id: "Scanner Command", label: "SCANNER COMMAND", position: [-6.0, 2.68, -7.25], width: 2.45, height: 0.39, mount: "wall", style: "hero" },
  { id: "Market Wall", label: "MARKET WALL", position: [0, 3.03, -6.49], width: 2.2, height: 0.35, mount: "wall", style: "hero" },
  { id: "Risk Office", label: "RISK OFFICE", position: [6.4, 2.5, -7.27], width: 1.72, height: 0.38, mount: "wall", style: "plaque" },
  { id: "War Room", label: "WAR ROOM", position: [5.2, 1.86, 3.91], width: 1.73, height: 0.38, mount: "wall", style: "hero" },
  { id: "Executive Station", label: "EXECUTIVE STATION", position: [6, 1.96, 7.245], width: 2.30, height: 0.35, mount: "wall", style: "plaque" },
  { id: "Server / Data", label: "SERVER ROOM", position: [-7.63, 2.32, 1.24], width: 1.66, height: 0.35, mount: "wall", style: "plaque", interactive: true },
  { id: "Lounge", label: "LOUNGE", position: [-0.7, 1.44, 5.18], width: 1.4, height: 0.35, mount: "stand", style: "plaque" },
  { id: "Boss Office L2", label: "BOSS OFFICE", subtitle: "LEVEL 02", position: [3.56, UPPER_Y + 1.87, BOSS_OFFICE_LAYOUT.roomMinZ - 0.075], width: 1.80, height: 0.52, mount: "wall", style: "hero", floor: 2 },
  { id: "Strategy Room L2", label: "STRATEGY ROOM", subtitle: "LEVEL 02", position: [UPPER_MEETING_LAYOUT.x, UPPER_Y + 2.65, -5.99], width: 2.12, height: 0.49, mount: "wall", style: "hero", floor: 2 },
];

// Guard against adding/removing a floor-one room without assigning it a sign.
export function missingRoomSigns(): string[] {
  const available = new Set(roomSignDefinitions.map((sign) => sign.id));
  return rooms.map((room) => room.label).filter((id) => !available.has(id));
}
