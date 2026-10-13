# Character rendering contract

## Agency avatar renderer

The office now uses the same five textured, skinned Microsoft Rocketbox models as `harvey-moeid/byga-agency`. Assets are bundled under `public/avatars/`; `manifest.json` records the original source, checksums and clips, and `LICENSE-Rocketbox.txt` includes the MIT attribution. No runtime CDN or avatar account is needed.

`src/ui/agency-character.tsx` clones each skeleton independently and crossfades the bundled Idle, Walk, Read, Present and Type clips. Stable character indices select models cyclically; existing character IDs, roles, group colors, click handlers, world navigation, speech routing and meeting attendance remain authoritative in `office-character.tsx`.

Workstation typing applies arm IK to reach the existing keyboard. Standing talk/stretch uses Present; coffee/review uses Read. Seated idle, typing and meeting speech all use the seated Type clip so a speaker remains seated. These are visual approximations: dedicated coffee, stretch, neutral meeting and seated speech clips, phone props and listener head tracking are not present in the agency assets. Reduced motion freezes the model animation while required world travel/seat transitions remain controlled by the office state machine.

Each of the ten office character indices has a unique, stable clothing color in `agency-clothing.ts`. Per-model UV masks recolor clothing while preserving fabric shading and leaving skin/hair textures alone. Body materials are cloned per actor and disposed independently; GLB textures and geometry remain shared. Model/cut reuse is intentional: this is ten distinct colorways of five models, not ten different garment meshes. `scripts/avatars/clothing-masks.py` rebuilds bundled PNG masks using Python/Pillow; neither is a runtime dependency.

All quality levels use the textured models. Only High/Ultra enable avatar shadows; this renderer does not yet provide separate lower-polygon model assets. The procedural renderer is retained as the loading/error fallback. Geometry, materials and textures from the GLTF cache are shared; skeletons and animation actions are independent.

`tests/agency-character.test.ts` verifies asset checksums, embedded textures, skeletons, animation clips and license. Browser acceptance checks successful agency GLB loading and WebGL context-loss behavior.

## Procedural fallback contract (previous renderer)


Phase 1 replaces the decorative character renderer without changing the trading or office state machines.

## Quality contract

- All quality levels use the same new articulated avatar, local `public/models/byga/rigged-office-humanoid.gltf` skeleton and `AnimationMixer` clips.
- `low`: reduced polygon counts, single-segment animated fingers, three swept hair locks, standard materials and no bump maps or avatar shadows. Small watch/pocket/button/sole details are omitted.
- `medium`: intermediate polygon counts, full fingers and outfit details, standard materials and cloth bump maps; avatar shadows remain disabled.
- `high`, `ultra`: full avatar geometry, physical materials, skin/cloth bump maps and avatar shadows.
- Auto quality may move into `low`; that must not alter character IDs, office destinations, meeting attendance, speech routing, or backend state.

## Rig contract

The local glTF is authored for this repository and contains a skin definition with 19 joints plus a hidden driver mesh. Required transforms are:

`Hips → Spine → Chest → Neck → Head`

`Chest → Left/Right Shoulder → UpperArm → LowerArm → Hand`

`Hips → Left/Right UpperLeg → LowerLeg → Foot`

`src/ui/rigged-character-visual.ts` attaches the rendered body pieces, face, hair, outfit details, hands, shoes and props to those transforms. The tiny glTF is intentionally geometry-light: the skeleton is the stable asset contract while visual geometry can evolve independently without touching movement/navigation.

## Motion contract

`src/ui/character-motion.ts` is the single state-to-motion mapping. Current clips are:

- `idle`: standing breathing/head movement.
- `walk`: alternating legs, knees, feet, arm counter-swing, hip bob and torso counter-rotation.
- `sit`: neutral meeting seat pose.
- `type`: seated typing pose for normal workstation monitoring.
- `mouse`: seated mouse interaction with right-hand clicks.
- `desk-review`: seated screen review with a subtle gaze sweep.
- `talk`: standing conversation gesture for ambient office activity.
- `meeting-talk`: seated meeting speech gesture that preserves the meeting pose.
- `coffee`: right-hand drink motion with the cup prop visible.
- `stretch`: overhead stretch.
- `review`: standing market-review pose.

`src/ui/rigged-character.tsx` crossfades clips with `AnimationMixer`. The motion system controls only local joint pose. `src/ui/office-character.tsx` remains authoritative for world position, deterministic navigation route, facing, meeting arrival and activity timing.

## Non-regression boundaries

Phase 1 must not change:

- `CharacterId` values or analyst role assignment.
- scanner/group consensus, AI voting, Risk Manager or Boss logic.
- Cloudflare Worker, Durable Object, cron, D1 reads/writes or `chart_db` behavior.
- meeting destination/facing plans.
- speech bubble ownership and case-result content.
- click selection and character detail routes.

## Verification

- `tests/character-motion.test.ts` covers deterministic motion selection.
- `tests/character-rig.test.ts` validates the local glTF skin/joint hierarchy and embedded buffer.
- Browser acceptance verifies the rig asset loads through the Medium renderer, then switches to Low to exercise both floors and WebGL/context-loss coverage.
- Normal repository gates still require TypeScript, ESLint, Vitest, build and Playwright acceptance before merge/deploy.

## Avatar and movement upgrade

All qualities use a tapered jaw, smaller eyes with eyebrows/lids, swept hair, a tailored jacket silhouette and articulated fingers. Medium, High and Ultra also include watch and shoe-sole details. Shared, locally generated skin and woven cloth bump maps add surface detail without external asset requests. These remain procedural miniature humanoids, not photoreal character scans.

Characters blink at staggered intervals and move their mouths during conversation. Workstation monitoring crossfades through typing, mouse and screen-review clips on an 18-second cycle offset by character ID. This cycle only decorates the existing `type` presence; it does not imply a new AI request or alter meeting attendance. Reduced motion disables blinking, mouth/jitter and the workstation cycle while preserving required travel and seat poses.

`src/ui/character-locomotion.ts` accelerates gently at departure, eases into sharp corners, brakes at the final destination, and consumes multiple route waypoints in one update. Position follows the original planner's segments exactly, including doorways and stairs. Flat travel uses 1.25 scene units/second; ascent/descent uses 0.72, with no boost for a route crossing floors. Slow-renderer updates consume up to two seconds of elapsed time using fixed substeps, and returning from a hidden tab clears the accumulated movement time. Walking animation cadence follows actual travel speed. Every avatar quality uses this movement path. Quality changes rebuild only the local avatar geometry/materials; the world-space root, route, activity and meeting state stay in place.

`src/ui/stair-pose.ts` derives alternating support/swing feet from position along the actual staircase, not from an independent animation timer. The supporting foot stays on its tread, the other clears the riser, and a small post-animation IK solve applies the targets to the licensed agency rigs and the BYGA fallback rig. Body lowering eases into and out of the stairs. This adds no downloaded animation asset.

Meeting gathering and Boss entry use per-case arrival reports after the character reaches the new target and settles for 450 ms. Old desk arrival state cannot satisfy a new meeting destination. A 65-second travel deadline keeps missing renderer reports from stalling the presentation indefinitely; cancellation bypasses arrival waits. Browser presentation never changes the backend trading/orchestration timeline.

Speech attaches above the animated head bone and uses a smooth screen placement with a connector back to that head, even when the card moves to avoid controls. The camera updates before character movement and HTML projection. A subtle floor ring identifies the active speaker. The seven-second reading window starts only when the actual HTML bubble is visible; repeated visibility changes do not restart it. An unseen speaker has a bounded 20-second presentation wait, and the current conversation remains accessible through the status sheet.

`tests/character-lod.test.ts` verifies shared identity and expressive hands at every quality, consistent joint positions/body bounds, lower triangle counts in Low/Medium, cheap materials/no avatar shadows in those modes, and shared geometry with independently owned materials.

`tests/character-locomotion.test.ts` verifies acceleration, braking, corner preservation, empty-route safety, natural-speed arrival before the travel timeout at 60 FPS, 12 FPS and half-second updates, and equivalent travel at two-second renderer updates. `tests/stair-pose.test.ts` checks planted feet, riser clearance and both stair directions on all five actual agency skeletons. Meeting tests cover selected participants, Boss arrival, cancellation and bounded missing reports. Browser regression checks bubble bounds and the connector endpoint against the actual animated head projection.

Character-to-character avoidance, facial morph targets and photoreal scans remain future visual work. Desktop/mobile visual and performance acceptance still requires a browser with WebGL before merge/deploy.
