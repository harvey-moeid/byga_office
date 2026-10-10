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
) {
  const focus = new Vector3(...target);
  const direction = new Vector3(...position).sub(focus).normalize();
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const vertical = Math.tan((fov * Math.PI) / 360) * 0.76;
  const horizontal = vertical * Math.max(0.1, aspect);
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
