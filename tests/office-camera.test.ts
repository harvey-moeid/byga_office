import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  fitOfficeCamera,
  fitMeetingCamera,
  meetingViewport,
} from "../src/ui/office-camera";

describe("office camera framing", () => {
  for (const [width, height] of [
    [1440, 900],
    [393, 851],
    [915, 412],
    [320, 740],
  ]) {
    it(`keeps both floors inside the canvas at ${width}×${height}`, () => {
      const bounds = { min: [-9, -0.55, -8], max: [9, 6.6, 8] } as const;
      const camera = new PerspectiveCamera(40, width / height, 0.1, 300);
      camera.position.copy(
        fitOfficeCamera(
          [-18, 18, 24],
          [0, 2.1, 0],
          {
            min: [...bounds.min],
            max: [...bounds.max],
          },
          camera.aspect,
          camera.fov,
        ),
      );
      camera.lookAt(0, 2.1, 0);
      camera.updateMatrixWorld();
      for (const x of [bounds.min[0], bounds.max[0]])
        for (const y of [bounds.min[1], bounds.max[1]])
          for (const z of [bounds.min[2], bounds.max[2]]) {
            const point = new Vector3(x, y, z).project(camera);
            expect(Math.abs(point.x)).toBeLessThanOrEqual(0.760001);
            expect(Math.abs(point.y)).toBeLessThanOrEqual(0.760001);
            expect(point.z).toBeGreaterThan(-1);
            expect(point.z).toBeLessThan(1);
          }
    });
  }
});

describe("meeting camera clear area", () => {
  for (const [width, height, hud] of [
    [1280, 720, { left: 20, top: 125, width: 330, height: 180 }],
    [393, 851, { left: 16, top: 140, width: 300, height: 160 }],
    [915, 412, { left: 20, top: 125, width: 300, height: 130 }],
  ] as const) {
    it(`frames every seat outside the HUD at ${width}×${height}`, () => {
      const rect = meetingViewport(width, height, hud, height - 110);
      const bounds = {
        min: [2.85, 3.68, -3.65],
        max: [6.5, 5.55, -0.75],
      } as const;
      const target: [number, number, number] = [4.675, 4.615, -2.2];
      const camera = new PerspectiveCamera(40, width / height, 0.1, 300);
      const frame = fitMeetingCamera(
        [-2.5, 9.1, 4.8],
        target,
        { min: [...bounds.min], max: [...bounds.max] },
        camera.aspect,
        camera.fov,
        [(0.72 * rect.width) / width, (0.72 * rect.height) / height],
      );
      camera.position.copy(frame.position);
      camera.setViewOffset(
        width,
        height,
        width / 2 - rect.left - rect.width / 2 + (frame.center[0] * width) / 2,
        height / 2 -
          rect.top -
          rect.height / 2 -
          (frame.center[1] * height) / 2,
        width,
        height,
      );
      camera.lookAt(...target);
      camera.updateMatrixWorld();
      const xs: number[] = [],
        ys: number[] = [];
      for (const x of [bounds.min[0], bounds.max[0]])
        for (const y of [bounds.min[1], bounds.max[1]])
          for (const z of [bounds.min[2], bounds.max[2]]) {
            const point = new Vector3(x, y, z).project(camera);
            const px = ((point.x + 1) * width) / 2,
              py = ((1 - point.y) * height) / 2;
            xs.push(px);
            ys.push(py);
            expect(px).toBeGreaterThanOrEqual(rect.left);
            expect(px).toBeLessThanOrEqual(rect.left + rect.width);
            expect(py).toBeGreaterThanOrEqual(rect.top);
            expect(py).toBeLessThanOrEqual(rect.top + rect.height);
            expect(
              px >= hud.left &&
                px <= hud.left + hud.width &&
                py >= hud.top &&
                py <= hud.top + hud.height,
            ).toBe(false);
          }
      const fill = Math.max(
        (Math.max(...xs) - Math.min(...xs)) / rect.width,
        (Math.max(...ys) - Math.min(...ys)) / rect.height,
      );
      expect(fill).toBeGreaterThanOrEqual(0.65);
      expect(fill).toBeLessThanOrEqual(0.75);
    });
  }
});
