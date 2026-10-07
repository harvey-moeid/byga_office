import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import {
  AnimationClip,
  Euler,
  LoopRepeat,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { showsCoffeeCup, type CharacterMotion } from "./character-motion";
import {
  buildCharacterVisual,
  type RiggedCharacterStyle,
} from "./rigged-character-visual";

const HUMANOID_MODEL = "/models/byga/rigged-office-humanoid.gltf";

type RotationKey = [number, number, number];

function quaternions(values: RotationKey[]) {
  const q = new Quaternion();
  const e = new Euler();
  return values.flatMap(([x, y, z]) => {
    q.setFromEuler(e.set(x, y, z, "XYZ"));
    return [q.x, q.y, q.z, q.w];
  });
}

function rotationTrack(
  bone: string,
  times: number[],
  values: RotationKey[],
) {
  return new QuaternionKeyframeTrack(
    `${bone}.quaternion`,
    times,
    quaternions(values),
  );
}

function positionTrack(
  bone: string,
  times: number[],
  values: [number, number, number][],
) {
  return new VectorKeyframeTrack(
    `${bone}.position`,
    times,
    values.flatMap((value) => value),
  );
}

function stillPose(
  name: string,
  duration: number,
  hipsY: number,
  rotations: Record<string, RotationKey>,
) {
  const times = [0, duration];
  const tracks = [
    positionTrack("Hips", times, [
      [0, hipsY, 0],
      [0, hipsY, 0],
    ]),
    ...Object.entries(rotations).map(([bone, rotation]) =>
      rotationTrack(bone, times, [rotation, rotation]),
    ),
  ];
  return new AnimationClip(name, duration, tracks);
}

function humanoidAnimations() {
  const sitPose: Record<string, RotationKey> = {
    LeftUpperLeg: [-1.43, 0.03, 0.03],
    RightUpperLeg: [-1.43, -0.03, -0.03],
    LeftLowerLeg: [1.5, 0, 0],
    RightLowerLeg: [1.5, 0, 0],
    LeftFoot: [-0.06, 0, 0],
    RightFoot: [-0.06, 0, 0],
    Spine: [0.035, 0, 0],
    Chest: [-0.015, 0, 0],
  };

  const idle = new AnimationClip("idle", 4, [
    positionTrack("Hips", [0, 1, 2, 3, 4], [
      [0, 0.97, 0],
      [0, 0.975, 0],
      [0, 0.97, 0],
      [0, 0.974, 0],
      [0, 0.97, 0],
    ]),
    rotationTrack("Spine", [0, 1, 2, 3, 4], [
      [0, 0, -0.012],
      [0.005, 0.008, 0],
      [0, 0, 0.012],
      [-0.005, -0.008, 0],
      [0, 0, -0.012],
    ]),
    rotationTrack("Chest", [0, 2, 4], [
      [0.01, -0.015, 0],
      [-0.006, 0.018, 0],
      [0.01, -0.015, 0],
    ]),
    rotationTrack("Head", [0, 1, 2.2, 3.2, 4], [
      [0, -0.05, 0],
      [0.015, 0.02, 0],
      [-0.01, 0.06, 0],
      [0.012, -0.015, 0],
      [0, -0.05, 0],
    ]),
    rotationTrack("LeftUpperArm", [0, 2, 4], [
      [0.025, 0, -0.035],
      [-0.015, 0, -0.02],
      [0.025, 0, -0.035],
    ]),
    rotationTrack("RightUpperArm", [0, 2, 4], [
      [-0.02, 0, 0.03],
      [0.015, 0, 0.018],
      [-0.02, 0, 0.03],
    ]),
  ]);

  const walkTimes = [0, 0.25, 0.5, 0.75, 1];
  const walk = new AnimationClip("walk", 1, [
    positionTrack("Hips", walkTimes, [
      [0, 0.97, 0],
      [-0.014, 1.005, 0],
      [0, 0.97, 0],
      [0.014, 1.005, 0],
      [0, 0.97, 0],
    ]),
    rotationTrack("Hips", walkTimes, [
      [0, 0.045, 0.025],
      [0, 0, -0.018],
      [0, -0.045, 0.025],
      [0, 0, -0.018],
      [0, 0.045, 0.025],
    ]),
    rotationTrack("Spine", walkTimes, [
      [0, -0.07, -0.02],
      [0, 0, 0.015],
      [0, 0.07, -0.02],
      [0, 0, 0.015],
      [0, -0.07, -0.02],
    ]),
    rotationTrack("LeftUpperLeg", walkTimes, [
      [0.56, 0, 0],
      [0.16, 0, 0],
      [-0.52, 0, 0],
      [-0.12, 0, 0],
      [0.56, 0, 0],
    ]),
    rotationTrack("RightUpperLeg", walkTimes, [
      [-0.52, 0, 0],
      [-0.12, 0, 0],
      [0.56, 0, 0],
      [0.16, 0, 0],
      [-0.52, 0, 0],
    ]),
    rotationTrack("LeftLowerLeg", walkTimes, [
      [0.08, 0, 0],
      [0.72, 0, 0],
      [0.18, 0, 0],
      [0.06, 0, 0],
      [0.08, 0, 0],
    ]),
    rotationTrack("RightLowerLeg", walkTimes, [
      [0.18, 0, 0],
      [0.06, 0, 0],
      [0.08, 0, 0],
      [0.72, 0, 0],
      [0.18, 0, 0],
    ]),
    rotationTrack("LeftFoot", walkTimes, [
      [-0.08, 0, 0],
      [0.16, 0, 0],
      [0.04, 0, 0],
      [-0.12, 0, 0],
      [-0.08, 0, 0],
    ]),
    rotationTrack("RightFoot", walkTimes, [
      [0.04, 0, 0],
      [-0.12, 0, 0],
      [-0.08, 0, 0],
      [0.16, 0, 0],
      [0.04, 0, 0],
    ]),
    rotationTrack("LeftUpperArm", walkTimes, [
      [-0.42, 0, -0.035],
      [-0.12, 0, -0.03],
      [0.42, 0, -0.035],
      [0.12, 0, -0.03],
      [-0.42, 0, -0.035],
    ]),
    rotationTrack("RightUpperArm", walkTimes, [
      [0.42, 0, 0.035],
      [0.12, 0, 0.03],
      [-0.42, 0, 0.035],
      [-0.12, 0, 0.03],
      [0.42, 0, 0.035],
    ]),
    rotationTrack("LeftLowerArm", walkTimes, [
      [-0.12, 0, 0],
      [-0.2, 0, 0],
      [-0.1, 0, 0],
      [-0.16, 0, 0],
      [-0.12, 0, 0],
    ]),
    rotationTrack("RightLowerArm", walkTimes, [
      [-0.1, 0, 0],
      [-0.16, 0, 0],
      [-0.12, 0, 0],
      [-0.2, 0, 0],
      [-0.1, 0, 0],
    ]),
  ]);

  const sit = stillPose("sit", 2.6, 0.62, {
    ...sitPose,
    LeftUpperArm: [-0.38, 0, -0.035],
    RightUpperArm: [-0.38, 0, 0.035],
    LeftLowerArm: [-0.58, 0, 0],
    RightLowerArm: [-0.58, 0, 0],
  });

  const typeTimes = [0, 0.35, 0.7, 1.05, 1.4];
  const typing = new AnimationClip("type", 1.4, [
    positionTrack("Hips", typeTimes, typeTimes.map(() => [0, 0.62, 0])),
    ...Object.entries(sitPose).map(([bone, rotation]) =>
      rotationTrack(bone, typeTimes, typeTimes.map(() => rotation)),
    ),
    rotationTrack("LeftUpperArm", typeTimes, typeTimes.map(() => [-0.78, 0.05, -0.08])),
    rotationTrack("RightUpperArm", typeTimes, typeTimes.map(() => [-0.78, -0.05, 0.08])),
    rotationTrack("LeftLowerArm", typeTimes, [
      [-1.02, 0.08, 0],
      [-1.12, -0.03, 0],
      [-1.03, 0.06, 0],
      [-1.10, -0.05, 0],
      [-1.02, 0.08, 0],
    ]),
    rotationTrack("RightLowerArm", typeTimes, [
      [-1.10, -0.04, 0],
      [-1.03, 0.06, 0],
      [-1.12, -0.02, 0],
      [-1.03, 0.05, 0],
      [-1.10, -0.04, 0],
    ]),
    rotationTrack("Head", typeTimes, [
      [0.11, 0.02, 0],
      [0.08, -0.025, 0],
      [0.12, 0.01, 0],
      [0.08, 0.035, 0],
      [0.11, 0.02, 0],
    ]),
  ]);

  const talkTimes = [0, 0.55, 1.1, 1.65, 2.2];
  const standingTalk = new AnimationClip("talk", 2.2, [
    positionTrack("Hips", talkTimes, talkTimes.map(() => [0, 0.97, 0])),
    rotationTrack("Spine", talkTimes, [
      [0.005, -0.02, 0],
      [0.015, 0.015, 0],
      [-0.005, 0.03, 0],
      [0.012, -0.01, 0],
      [0.005, -0.02, 0],
    ]),
    rotationTrack("Chest", talkTimes, [
      [-0.01, -0.04, 0],
      [0.015, 0.025, 0],
      [-0.005, 0.05, 0],
      [0.02, -0.02, 0],
      [-0.01, -0.04, 0],
    ]),
    rotationTrack("Head", talkTimes, [
      [0, -0.08, 0],
      [0.035, 0.02, 0],
      [-0.025, 0.09, 0],
      [0.03, -0.015, 0],
      [0, -0.08, 0],
    ]),
    rotationTrack("RightUpperArm", talkTimes, [
      [-0.32, 0, 0.12],
      [-0.68, -0.12, 0.18],
      [-0.42, 0.1, 0.08],
      [-0.58, -0.05, 0.2],
      [-0.32, 0, 0.12],
    ]),
    rotationTrack("RightLowerArm", talkTimes, [
      [-0.45, 0, 0],
      [-1.05, 0.12, 0.08],
      [-0.62, -0.08, -0.06],
      [-0.9, 0.08, 0.04],
      [-0.45, 0, 0],
    ]),
    rotationTrack("LeftUpperArm", talkTimes, [
      [-0.25, 0, -0.09],
      [-0.38, 0.06, -0.12],
      [-0.5, -0.04, -0.16],
      [-0.34, 0.04, -0.1],
      [-0.25, 0, -0.09],
    ]),
  ]);

  const meetingTalk = new AnimationClip("meeting-talk", 2.2, [
    positionTrack("Hips", talkTimes, talkTimes.map(() => [0, 0.62, 0])),
    ...Object.entries(sitPose)
      .filter(([bone]) => bone !== "Chest")
      .map(([bone, rotation]) =>
        rotationTrack(bone, talkTimes, talkTimes.map(() => rotation)),
      ),
    rotationTrack("Chest", talkTimes, [
      [-0.01, -0.04, 0],
      [0.015, 0.025, 0],
      [-0.005, 0.05, 0],
      [0.02, -0.02, 0],
      [-0.01, -0.04, 0],
    ]),
    rotationTrack("Head", talkTimes, [
      [0, -0.08, 0],
      [0.035, 0.02, 0],
      [-0.025, 0.09, 0],
      [0.03, -0.015, 0],
      [0, -0.08, 0],
    ]),
    rotationTrack("RightUpperArm", talkTimes, [
      [-0.48, 0, 0.12],
      [-0.78, -0.12, 0.18],
      [-0.52, 0.1, 0.08],
      [-0.68, -0.05, 0.2],
      [-0.48, 0, 0.12],
    ]),
    rotationTrack("RightLowerArm", talkTimes, [
      [-0.7, 0, 0],
      [-1.15, 0.12, 0.08],
      [-0.78, -0.08, -0.06],
      [-1.02, 0.08, 0.04],
      [-0.7, 0, 0],
    ]),
    rotationTrack("LeftUpperArm", talkTimes, [
      [-0.44, 0, -0.09],
      [-0.5, 0.06, -0.12],
      [-0.65, -0.04, -0.16],
      [-0.48, 0.04, -0.1],
      [-0.44, 0, -0.09],
    ]),
  ]);

  const coffeeTimes = [0, 0.6, 1.2, 1.8, 2.4];
  const coffee = new AnimationClip("coffee", 2.4, [
    positionTrack("Hips", coffeeTimes, coffeeTimes.map(() => [0, 0.97, 0])),
    rotationTrack("Spine", coffeeTimes, coffeeTimes.map(() => [0.015, 0, 0])),
    rotationTrack("RightUpperArm", coffeeTimes, [
      [-0.4, 0, 0.08],
      [-0.9, -0.05, 0.12],
      [-1.08, -0.08, 0.15],
      [-0.88, -0.04, 0.1],
      [-0.4, 0, 0.08],
    ]),
    rotationTrack("RightLowerArm", coffeeTimes, [
      [-0.45, 0, 0],
      [-1.25, 0, 0.05],
      [-1.58, 0, 0.08],
      [-1.22, 0, 0.04],
      [-0.45, 0, 0],
    ]),
    rotationTrack("Head", coffeeTimes, [
      [0, 0, 0],
      [0.02, -0.02, 0],
      [-0.06, 0, 0],
      [0.02, 0.02, 0],
      [0, 0, 0],
    ]),
  ]);

  const stretchTimes = [0, 0.7, 1.4, 2.1, 2.8];
  const stretch = new AnimationClip("stretch", 2.8, [
    positionTrack("Hips", stretchTimes, stretchTimes.map(() => [0, 0.97, 0])),
    rotationTrack("Spine", stretchTimes, [
      [0, 0, 0],
      [-0.08, 0, 0],
      [-0.14, 0, 0],
      [-0.07, 0, 0],
      [0, 0, 0],
    ]),
    rotationTrack("LeftUpperArm", stretchTimes, [
      [0, 0, -0.05],
      [0, 0, -1.7],
      [0, 0, -2.82],
      [0, 0, -1.8],
      [0, 0, -0.05],
    ]),
    rotationTrack("RightUpperArm", stretchTimes, [
      [0, 0, 0.05],
      [0, 0, 1.7],
      [0, 0, 2.82],
      [0, 0, 1.8],
      [0, 0, 0.05],
    ]),
    rotationTrack("LeftLowerArm", stretchTimes, [
      [0, 0, 0],
      [-0.15, 0, 0],
      [-0.22, 0, 0],
      [-0.12, 0, 0],
      [0, 0, 0],
    ]),
    rotationTrack("RightLowerArm", stretchTimes, [
      [0, 0, 0],
      [-0.15, 0, 0],
      [-0.22, 0, 0],
      [-0.12, 0, 0],
      [0, 0, 0],
    ]),
    rotationTrack("Head", stretchTimes, [
      [0, 0, 0],
      [-0.07, 0.03, 0],
      [-0.12, -0.02, 0],
      [-0.06, 0.02, 0],
      [0, 0, 0],
    ]),
  ]);

  const reviewTimes = [0, 0.8, 1.6, 2.4, 3.2];
  const review = new AnimationClip("review", 3.2, [
    positionTrack("Hips", reviewTimes, reviewTimes.map(() => [0, 0.97, 0])),
    rotationTrack("Spine", reviewTimes, reviewTimes.map(() => [0.025, 0, 0])),
    rotationTrack("Head", reviewTimes, [
      [0.13, -0.05, 0],
      [0.1, 0.03, 0],
      [0.14, 0.07, 0],
      [0.09, -0.02, 0],
      [0.13, -0.05, 0],
    ]),
    rotationTrack("LeftUpperArm", reviewTimes, reviewTimes.map(() => [-0.44, 0.05, -0.05])),
    rotationTrack("RightUpperArm", reviewTimes, reviewTimes.map(() => [-0.44, -0.05, 0.05])),
    rotationTrack("LeftLowerArm", reviewTimes, reviewTimes.map(() => [-0.88, 0, 0])),
    rotationTrack("RightLowerArm", reviewTimes, reviewTimes.map(() => [-0.88, 0, 0])),
  ]);

  return [idle, walk, sit, typing, standingTalk, meetingTalk, coffee, stretch, review];
}

const CLIPS = humanoidAnimations();

export function RiggedOfficeCharacter({
  motion,
  style,
  showPhone,
  motionReduced,
}: {
  motion: CharacterMotion;
  style: RiggedCharacterStyle;
  showPhone: boolean;
  motionReduced: boolean;
}) {
  const model = useGLTF(HUMANOID_MODEL);
  const stableStyle = useMemo<RiggedCharacterStyle>(
    () => ({ ...style }),
    [
      style.skin,
      style.hair,
      style.jacket,
      style.accent,
      style.shirt,
      style.trousers,
      style.shoes,
      style.lapels,
      style.tie,
      style.shortSleeve,
      style.style,
      style.longHair,
      style.boss,
    ],
  );
  const character = useMemo(() => {
    const root = cloneSkeleton(model.scene);
    const build = buildCharacterVisual(root, stableStyle);
    return { root, ...build };
  }, [model.scene, stableStyle]);
  const root = character.root;
  const { actions, mixer } = useAnimations(CLIPS, root);
  const active = useRef<CharacterMotion | undefined>(undefined);

  useEffect(() => {
    active.current = undefined;
  }, [root]);

  useEffect(() => {
    const coffee = root.getObjectByName("AccessoryCoffeeCup");
    const phone = root.getObjectByName("AccessoryPhone");
    if (coffee) coffee.visible = showsCoffeeCup(motion);
    if (phone) phone.visible = showPhone;
  }, [motion, root, showPhone]);

  useEffect(() => {
    const requested = motion;
    const next = actions[requested] ?? actions.idle;
    if (!next || active.current === requested) return;
    const previous = active.current ? actions[active.current] : undefined;
    next.enabled = true;
    next.setLoop(LoopRepeat, Infinity);
    next.setEffectiveTimeScale(motionReduced ? 0.6 : 1);
    next.setEffectiveWeight(1);
    next.reset().fadeIn(previous ? 0.24 : 0.08).play();
    previous?.fadeOut(0.24);
    active.current = requested;
    return () => {
      if (!active.current) return;
      actions[active.current]?.fadeOut(0.12);
    };
  }, [actions, motion, motionReduced]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      character.materials.forEach((value) => value.dispose());
    },
    [character.materials, mixer],
  );

  return (
    <group name="rigged-office-character" scale={0.93}>
      <primitive object={root} />
    </group>
  );
}

