import { Vector3 } from "three";

export type CameraBounds = {
  min: [number, number, number];
  max: [number, number, number];
};

/** Fit all eight corners, including their depth, inside a perspective view.
 * Keep room for the HUD and camera controls rather than cropping the building
 * or relying on a single aspect multiplier that only works on desktop. */
export function fitOfficeCamera(
  position: [number, number, number],
  target: [number, number, number],
  bounds: CameraBounds,
  aspect: number,
  fov: number,
  occupancy: [number, number] = [0.76, 0.76],
) {
  const focus = new Vector3(...target);
  const direction = new Vector3(...position).sub(focus).normalize();
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const tangent = Math.tan((fov * Math.PI) / 360);
  const vertical = tangent * occupancy[1];
  const horizontal = tangent * occupancy[0] * Math.max(0.1, aspect);
  let distance = 0;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner = new Vector3(x, y, z).sub(focus);
        const depth = corner.dot(direction);
        distance = Math.max(
          distance,
          depth + Math.abs(corner.dot(right)) / horizontal,
          depth + Math.abs(corner.dot(up)) / vertical,
        );
      }
  return focus.addScaledVector(direction, Math.max(4, distance));
}

export type ScreenRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
/** Choose a clear rectangle beside or below the HUD, above camera controls. */
export function meetingViewport(
  width: number,
  height: number,
  hud?: ScreenRect,
  bottom = height - 82,
): ScreenRect {
  const top = Math.min(72, height * 0.15);
  const end = Math.max(top + 80, Math.min(height - 12, bottom));
  const whole = {
    left: 12,
    top,
    width: Math.max(80, width - 24),
    height: end - top,
  };
  if (!hud || hud.top >= end || hud.top + hud.height <= top) return whole;
  const right = hud.left + hud.width + 16;
  const below = Math.max(top, hud.top + hud.height + 16);
  const candidates = [
    { left: right, top, width: width - right - 12, height: end - top },
    { left: 12, top: below, width: width - 24, height: end - below },
  ].filter((rect) => rect.width >= 140 && rect.height >= 100);
  return (
    candidates.sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
    whole
  );
}

/** Fit the projected ensemble, rather than padding each asymmetric corner.
 * Return its projected center so the clear viewport can center all participants. */
export function fitMeetingCamera(
  position: [number, number, number],
  target: [number, number, number],
  bounds: CameraBounds,
  aspect: number,
  fov: number,
  occupancy: [number, number],
) {
  const focus = new Vector3(...target);
  const direction = new Vector3(...position).sub(focus).normalize();
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const tangent = Math.tan((fov * Math.PI) / 360);
  const points: { x: number; y: number; depth: number }[] = [];
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner = new Vector3(x, y, z).sub(focus);
        points.push({
          x: corner.dot(right),
          y: corner.dot(up),
          depth: corner.dot(direction),
        });
      }
  const project = (distance: number) => {
    const xs = points.map(
      (p) => p.x / ((distance - p.depth) * tangent * aspect),
    );
    const ys = points.map((p) => p.y / ((distance - p.depth) * tangent));
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    return {
      fill: Math.max(
        (maxX - minX) / (2 * occupancy[0]),
        (maxY - minY) / (2 * occupancy[1]),
      ),
      center: [(minX + maxX) / 2, (minY + maxY) / 2] as [number, number],
    };
  };
  let low = Math.max(4, ...points.map((p) => p.depth + 0.2));
  let high = fitOfficeCamera(
    position,
    target,
    bounds,
    aspect,
    fov,
    occupancy,
  ).distanceTo(focus);
  high = Math.max(high, low);
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (project(middle).fill > 1) low = middle;
    else high = middle;
  }
  return {
    position: focus.addScaledVector(direction, high),
    center: project(high).center,
  };
}
