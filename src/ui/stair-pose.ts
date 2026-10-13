import { MathUtils, Object3D, Quaternion, Vector3 } from "three";
import { STAIR_LAYOUT, UPPER_FLOOR_Y } from "./office-layout";
import type { StairDirection } from "./character-locomotion";

/** Distance-driven steps: the supporting foot stays on its tread while the
 * other clears the next riser. No animation timer can outrun actual travel. */
export function stairFootTarget(
  progress: number,
  side: number,
  direction: StairDirection,
) {
  const sign = direction === "up" ? 1 : -1;
  const cycle = (sign * progress + side) / 2;
  const fraction = cycle - Math.floor(cycle);
  const from = sign * (2 * Math.floor(cycle) - side);
  const swing = MathUtils.clamp((fraction - 0.5) * 2, 0, 1);
  const blend = swing * swing * (3 - 2 * swing);
  const index = from + sign * 2 * blend;
  const height = (step: number) =>
    step < 0
      ? 0
      : step >= STAIR_LAYOUT.stepCount
        ? UPPER_FLOOR_Y
        : STAIR_LAYOUT.startY +
          step * STAIR_LAYOUT.rise +
          STAIR_LAYOUT.stepThickness / 2;
  return {
    z: STAIR_LAYOUT.startZ - index * STAIR_LAYOUT.run,
    y:
      MathUtils.lerp(height(from), height(from + sign * 2), blend) +
      Math.sin(swing * Math.PI) * (STAIR_LAYOUT.rise + 0.06),
    planted: swing === 0,
  };
}

export function createStairPose(root: Object3D, agency: boolean) {
  const find = (name: string) =>
    root.getObjectByName(name) ??
    root.getObjectByName(name.replaceAll("_", " "));
  root.updateWorldMatrix(true, true);
  const rootRotation = root.getWorldQuaternion(new Quaternion());
  const legs = ["Left", "Right"].map((side, index) => {
    const prefix = `Bip01_${index ? "R" : "L"}_`;
    const upper = find(agency ? `${prefix}Thigh` : `${side}UpperLeg`);
    const lower = find(agency ? `${prefix}Calf` : `${side}LowerLeg`);
    const foot = find(agency ? `${prefix}Foot` : `${side}Foot`);
    return {
      upper,
      lower,
      foot,
      neutral: foot
        ? rootRotation
            .clone()
            .invert()
            .multiply(foot.getWorldQuaternion(new Quaternion()))
        : new Quaternion(),
    };
  });
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    goal = new Vector3();
  const parent = new Quaternion(),
    delta = new Quaternion(),
    inverse = new Quaternion();
  const identity = new Quaternion(),
    orientation = new Quaternion();
  let weight = 0;
  return (
    direction: StairDirection | undefined,
    position: Vector3,
    elapsed: number,
    reduced: boolean,
  ) => {
    weight = MathUtils.damp(
      weight,
      direction ? 1 : 0,
      12,
      Math.min(elapsed, 0.1),
    );
    if (!direction || weight < 0.01) return;
    root.updateWorldMatrix(true, true);
    const progress = (STAIR_LAYOUT.startZ - position.z) / STAIR_LAYOUT.run;
    for (const [side, leg] of legs.entries()) {
      if (!leg.upper || !leg.lower || !leg.foot) continue;
      const target = stairFootTarget(progress, side, direction);
      leg.foot.getWorldPosition(b);
      goal.set(
        MathUtils.clamp(b.x, STAIR_LAYOUT.x - 0.27, STAIR_LAYOUT.x + 0.27),
        target.y + 0.055,
        target.z,
      );
      // Small CCD solve after the base clip; works with both local skeletons.
      for (let iteration = 0; iteration < (reduced ? 2 : 3); iteration++)
        for (const joint of [leg.lower, leg.upper]) {
          joint.getWorldPosition(a);
          leg.foot.getWorldPosition(b);
          b.sub(a).normalize();
          c.copy(goal).sub(a).normalize();
          delta.setFromUnitVectors(b, c);
          joint.parent!.getWorldQuaternion(parent);
          inverse.copy(parent).invert();
          delta.premultiply(inverse).multiply(parent);
          delta.slerp(identity, 1 - weight);
          joint.quaternion.premultiply(delta);
          joint.updateWorldMatrix(false, true);
        }
      root.getWorldQuaternion(orientation).multiply(leg.neutral);
      leg.foot.parent!.getWorldQuaternion(parent);
      orientation.premultiply(parent.invert());
      leg.foot.quaternion.slerp(orientation, weight);
    }
  };
}
