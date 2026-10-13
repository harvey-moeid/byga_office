# Office movement and presentation — 13 October 2026

This update makes the office presentation calmer and keeps mobile controls clear. It preserves all five quality choices, including Ultra, and does not change trading rules, provider calls, market storage, cron scheduling or production infrastructure.

## Character movement and meeting arrival

- Flat travel uses a consistent 1.25 scene units/second; stairs use 0.72. Cross-floor routes no longer boost the entire journey.
- Departure, tight corners, facing and final arrival ease smoothly while the collision-safe route remains authoritative.
- Ascent and descent apply distance-driven support/swing foot targets and a small skeletal IK correction. Targets follow actual tread geometry, including both landings, for the five agency models and the local fallback.
- Gathering waits for the selected participants to reach their seats and finish settling. Boss entry waits for the Boss. A previous desk/seat cannot count as arrival at a new target.
- Arrival waits are capped at 65 seconds. Cancellation closes stale discussion without waiting for a missing renderer callback. These are visual presentation timings only.
- Hidden-tab time pauses arrival and speech deadlines, matching paused character travel; resuming cannot skip the gathering phase or consume the reading window.

## Speech and status

- Speech follows the actual head bone rather than a fixed height above the floor. Smooth placement avoids the HUD and camera dock; a connector still points to the head after displacement.
- The active speaker has a restrained ring in their group color. Camera, movement and HTML projection run in a defined order.
- The reading window starts when the rendered HTML bubble is actually visible. An offscreen speaker cannot freeze the presentation indefinitely.
- Home shows a compact status button below the title, with a short meeting caption and persistent warning indicator when attention is needed.
- Details, scanner review, failed analyst outputs and retry actions live in an accessible native dialog. It becomes a bottom sheet on mobile; Escape closes it and returns keyboard focus to the status button.
- A current conversation can also be opened from that sheet. Failure notices briefly appear for 4.5 seconds; the warning remains until the problem resolves.

## Visual treatment and performance

- Warm key light and cooler fill improve depth; softer matte oak/walnut and champagne accents keep the palette consistent.
- Overview and Cinematic fit the building into the area clear of the header and bottom controls. Meeting framing retains the ensemble and biases toward the speaker.
- Panel surfaces, borders, corners and connector styling share the same restrained palette.
- Low starts with a non-multisampled WebGL context. Existing DPR, shadow, decoration and Auto quality controls remain available. No model, remote asset dependency or extra scene light was added.

## Validation boundaries

Final local checks passed: TypeScript, ESLint, the production frontend build, 266 unit/contract tests across 23 non-Miniflare test files, and 45 browser cases across desktop, portrait and landscape. The unchanged backend Miniflare suites were not rerun for this frontend update.

Unit regression includes actual agency skeletons for both stair directions. Browser checks use local API fixtures and Chromium desktop, portrait and landscape emulation. They verify compact errors/retry, arrival gating, fallback/cancellation, keyboard focus, mobile control geometry, scanner meetings, and connector alignment with the actual animated head.

Local verification does not establish physical-device FPS, Safari compatibility, production provider availability or a deployment. The existing large lazy-loaded scene bundle warning remains visible.
