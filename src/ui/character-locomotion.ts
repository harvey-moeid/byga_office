import { Vector3 } from "three";

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
  let remaining = Math.min(Math.max(elapsed, 0), 0.5);
  const acceleration = 7;
  const braking = 5;
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
    let desired = cruiseSpeed;
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
