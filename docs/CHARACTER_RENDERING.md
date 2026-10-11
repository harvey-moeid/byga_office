# Character rendering contract

Phase 1 replaces the decorative character renderer without changing the trading or office state machines.

## Quality contract

- `low`, `medium`: keep the lightweight procedural character renderer for constrained or software-rendered devices.
- `high`, `ultra`: render the articulated humanoid path using the local `public/models/byga/rigged-office-humanoid.gltf` skeleton and `AnimationMixer` clips. Select High or Ultra to see the detailed avatar upgrade.
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
- Browser acceptance temporarily selects Medium quality and verifies the rig asset returns HTTP 200, then returns to Low to preserve the existing low-cost WebGL/context-loss coverage.
- Normal repository gates still require TypeScript, ESLint, Vitest, build and Playwright acceptance before merge/deploy.

## Avatar and movement upgrade

High and Ultra now use a tapered jaw, smaller eyes with eyebrows/lids, swept hair, a tailored jacket silhouette, articulated fingers, watch and shoe soles. Shared, locally generated skin and woven cloth bump maps add surface detail without external asset requests. These remain procedural miniature humanoids, not photoreal character scans.

Characters blink at staggered intervals and move their mouths during conversation. Workstation monitoring crossfades through typing, mouse and screen-review clips on an 18-second cycle offset by character ID. This cycle only decorates the existing `type` presence; it does not imply a new AI request or alter meeting attendance. Reduced motion disables blinking, mouth/jitter and the workstation cycle while preserving required travel and seat poses.

`src/ui/character-locomotion.ts` accelerates at departure, brakes at the final destination, and consumes multiple route waypoints in one update. Position follows the original planner's segments exactly, including doorways and stairs. Walking animation cadence follows actual travel speed. Both lightweight and detailed renderers use this movement path.

`tests/character-locomotion.test.ts` verifies acceleration, braking, corner preservation, empty-route safety, and upstairs meeting arrival within 14 seconds at 60 FPS, 12 FPS and half-second updates.

Character-to-character avoidance, facial morph targets and photoreal scans remain future visual work. Desktop/mobile visual and performance acceptance still requires a browser with WebGL before merge/deploy.
