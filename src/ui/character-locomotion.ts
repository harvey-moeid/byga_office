import { Vector3 } from "three";
import { STAIR_LAYOUT, UPPER_FLOOR_Y } from "./office-layout";

export const WALK_SPEED = 1.25;
export const STAIR_SPEED = 0.72;
export type StairDirection = "up" | "down";

export function stairDirection(
  position: Vector3,
  next?: Vector3,
): StairDirection | undefined {
  if (!next || Math.abs(next.y - position.y) < 0.002) return;
  if (
    Math.abs(position.x - STAIR_LAYOUT.x) > STAIR_LAYOUT.width ||
    position.z < STAIR_LAYOUT.landingZ - 0.2 ||
    position.z > STAIR_LAYOUT.startZ + 0.6 ||
    position.y > UPPER_FLOOR_Y + 0.1
  )
    return;
  return next.y > position.y ? "up" : "down";
}

// Consume the original route segment by segment. Rounding a corner visually
// must never shorten the path through a partition, furniture or stair opening.
export function advanceCharacterRoute(
  position: Vector3,
  route: Vector3[],
  speed: number,
  elapsed: number,
  cruiseSpeed: number,
  direction: Vector3,
) {
  let traveled = 0;
  let remaining = Math.min(Math.max(elapsed, 0), 2);
  const acceleration = 2.2;
  const braking = 3.2;
  while (remaining > 0 && route.length) {
    let distance = position.distanceTo(route[0]);
    if (distance < 0.00001) {
      position.copy(route.shift()!);
      continue;
    }
    const dt = Math.min(remaining, 1 / 60);
    remaining -= dt;
    direction.copy(route[0]).sub(position).normalize();
    // Brake at the destination, not at each intermediate stair/door waypoint.
    let desired = stairDirection(position, route[0])
      ? Math.min(cruiseSpeed, STAIR_SPEED)
      : cruiseSpeed;
    // Ease into tight corners without cutting the planner's safe route.
    if (route.length > 1 && distance < 0.6) {
      const a = route[0],
        b = route[1];
      const nextLength = a.distanceTo(b);
      if (nextLength > 0.001) {
        const alignment =
          (direction.x * (b.x - a.x)) / nextLength +
          (direction.y * (b.y - a.y)) / nextLength +
          (direction.z * (b.z - a.z)) / nextLength;
        if (alignment < 0.7)
          desired = Math.min(
            desired,
            Math.sqrt(0.5 ** 2 + 2 * braking * distance),
          );
      }
    }
    if (route.length === 1)
      desired = Math.min(
        desired,
        Math.max(0.2, Math.sqrt(2 * braking * distance)),
      );
    speed += Math.max(
      -braking * dt,
      Math.min(acceleration * dt, desired - speed),
    );
    let budget = speed * dt;
    while (budget > 0 && route.length) {
      distance = position.distanceTo(route[0]);
      if (distance < 0.00001) {
        position.copy(route.shift()!);
        continue;
      }
      direction.copy(route[0]).sub(position).normalize();
      const step = Math.min(distance, budget);
      position.addScaledVector(direction, step);
      traveled += step;
      budget -= step;
      if (distance - step < 0.00001) position.copy(route.shift()!);
      else break;
    }
  }
  return { speed: route.length ? speed : 0, traveled };
}
