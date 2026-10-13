import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { AnimationAction, Mesh, Vector3, Quaternion, type Bone } from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { RiggedOfficeCharacter as ProceduralCharacter } from "./rigged-character";

import { agencyOutfitColor, dressAgencyCharacter } from "./agency-clothing";
import { createStairPose } from "./stair-pose";

type Props = Parameters<typeof ProceduralCharacter>[0];
const AVATARS = ["aria", "nova", "kai", "leo", "iris"] as const;

class AvatarBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function AgencyCharacter(props: Props & { url: string }) {
  const gltf = useGLTF(props.url);
  const mask = useTexture(props.url.replace(".glb", "-clothing-mask.png"));
  mask.flipY = false;
  const outfitColor = agencyOutfitColor(props.phase);
  const character = useMemo(() => {
    const model = clone(gltf.scene);
    model.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = object.receiveShadow =
          props.quality === "high" || props.quality === "ultra";
        // Rocketbox skinned bounds do not include every animated pose.
        object.frustumCulled = false;
      }
    });
    const materials = dressAgencyCharacter(model, mask, outfitColor);
    return { root: model, materials };
  }, [gltf.scene, props.quality, mask, outfitColor]);
  const root = character.root;
  const head = useMemo(
    () =>
      root.getObjectByName("Bip01_Head") ?? root.getObjectByName("Bip01 Head"),
    [root],
  );
  const stairPose = useMemo(() => createStairPose(root, true), [root]);
  useEffect(() => {
    props.onHeadAnchor?.(head);
    return () => props.onHeadAnchor?.(undefined);
  }, [head, props.onHeadAnchor]);
  useEffect(
    () => () => character.materials.forEach((material) => material.dispose()),
    [character.materials],
  );
  const clips = useMemo(
    () =>
      gltf.animations.map((clip) => {
        const copy = clip.clone();
        copy.tracks = copy.tracks.map((track) => {
          if (
            /(?:Bip01|hips|pelvis|root|armature)\.position$/i.test(track.name)
          ) {
            const neutral = track.clone();
            for (let i = 0; i < neutral.values.length; i += 3) {
              neutral.values[i] = neutral.values[0];
              neutral.values[i + 2] = neutral.values[2];
            }
            return neutral;
          }
          return track;
        });
        return copy;
      }),
    [gltf.animations],
  );
  const { actions, mixer } = useAnimations(clips, root);
  const previous = useRef<AnimationAction | null>(null);
  const limbs = useMemo(
    () =>
      ["L", "R"].map((side) => ({
        side,
        upper: root.getObjectByName(`Bip01_${side}_UpperArm`) as
          Bone | undefined,
        fore: root.getObjectByName(`Bip01_${side}_Forearm`) as Bone | undefined,
        hand: root.getObjectByName(`Bip01_${side}_Hand`) as Bone | undefined,
      })),
    [root],
  );
  const vectors = useMemo(
    () => ({
      a: new Vector3(),
      b: new Vector3(),
      c: new Vector3(),
      goal: new Vector3(),
      delta: new Quaternion(),
      parent: new Quaternion(),
      inverse: new Quaternion(),
      wrist: new Quaternion(),
    }),
    [],
  );
  const seated = ["sit", "type", "meeting-talk"].includes(props.motion);
  const clipName = seated
    ? "Type"
    : props.motion === "walk"
      ? "Walk"
      : props.motion === "talk" || props.motion === "stretch"
        ? "Present"
        : props.motion === "review" || props.motion === "coffee"
          ? "Read"
          : "Idle";
  useEffect(() => {
    const next = actions[clipName] ?? actions.Idle;
    if (!next || previous.current === next) return;
    next.reset().setEffectiveWeight(1).play();
    next.time = (props.phase * 0.37) % Math.max(next.getClip().duration, 0.01);
    if (props.motionReduced) {
      previous.current?.stop();
      next.stopFading().setEffectiveWeight(1);
      mixer.timeScale = 1;
      mixer.update(0);
      mixer.timeScale = 0;
    } else if (previous.current)
      next.crossFadeFrom(previous.current, 0.32, false);
    else next.fadeIn(0.12);
    previous.current = next;
  }, [actions, clipName, props.phase, props.motionReduced, mixer]);
  useFrame((_, dt) => {
    mixer.timeScale = props.motionReduced || document.hidden ? 0 : 1;
    previous.current?.setEffectiveTimeScale(
      props.motion === "walk"
        ? Math.max(0.2, Math.min(2.4, props.motionSpeed.current / 1.25))
        : 1,
    );
    if (props.motion === "type") {
      root.updateWorldMatrix(true, true);
      for (const limb of limbs) {
        if (!limb.upper || !limb.fore || !limb.hand || !root.parent) continue;
        // The agency seated clip needs IK to bring its outstretched arms to
        // the keyboard. Targets are in the same avatar space as BYGA desks.
        vectors.goal
          .set(limb.side === "L" ? 0.095 : -0.095, 0.92, 0.45)
          .applyMatrix4(root.parent.matrixWorld);
        limb.hand.getWorldQuaternion(vectors.wrist);
        for (let iteration = 0; iteration < 3; iteration++)
          for (const joint of [limb.fore, limb.upper]) {
            joint.getWorldPosition(vectors.a);
            limb.hand.getWorldPosition(vectors.b);
            vectors.b.sub(vectors.a).normalize();
            vectors.c.copy(vectors.goal).sub(vectors.a).normalize();
            vectors.delta.setFromUnitVectors(vectors.b, vectors.c);
            joint.parent!.getWorldQuaternion(vectors.parent);
            vectors.inverse.copy(vectors.parent).invert();
            vectors.delta.premultiply(vectors.inverse).multiply(vectors.parent);
            joint.quaternion.premultiply(vectors.delta);
            joint.updateWorldMatrix(false, true);
          }
        limb.hand.parent!.getWorldQuaternion(vectors.parent);
        limb.hand.quaternion.copy(
          vectors.parent.invert().multiply(vectors.wrist),
        );
      }
    }
    if (props.worldPosition)
      stairPose(
        props.stairMotion?.current,
        props.worldPosition.current,
        dt,
        props.motionReduced,
      );
    for (const action of Object.values(actions))
      if (
        action &&
        action !== previous.current &&
        action.getEffectiveWeight() < 0.001
      )
        action.stop();
  });
  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );
  // Agency assets stand 1.74 m; match the existing BYGA avatar's 0.93 scale.
  return (
    <group name="rigged-office-character" scale={0.93}>
      <primitive object={root} dispose={null} />
    </group>
  );
}

export function RiggedOfficeCharacter(props: Props) {
  const url = `/avatars/${AVATARS[props.phase % AVATARS.length]}.glb`;
  const fallback = <ProceduralCharacter {...props} />;
  return (
    <AvatarBoundary key={url} fallback={fallback}>
      <Suspense fallback={fallback}>
        <AgencyCharacter {...props} url={url} />
      </Suspense>
    </AvatarBoundary>
  );
}
