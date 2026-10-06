# Character rendering contract

Phase 1 replaces the decorative character renderer without changing the trading or office state machines.

## Quality contract

- `low`: keep the existing procedural character renderer. It is the explicit LOD/fallback for constrained or software-rendered devices.
- `medium`, `high`, `ultra`: render the articulated humanoid path using the local `public/models/byga/rigged-office-humanoid.gltf` skeleton and `AnimationMixer` clips.
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
- `talk`: seated meeting speech and standing conversation gesture.
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
- Browser acceptance temporarily selects Medium quality and verifies the rig asset returns HTTP 200, then returns to Low to preserve the existing low-cost WebGL/context-loss coverage.
- Normal repository gates still require TypeScript, ESLint, Vitest, build and Playwright acceptance before merge/deploy.

## Follow-up visual work

Phase 1 intentionally stops at the character layer. Character-to-character avoidance, facial morph targets/blinking, finger articulation, texture maps, and photoreal character scans are separate upgrades so they cannot destabilize the trading workflow.
