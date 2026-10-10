import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { fitOfficeCamera } from "../src/ui/office-camera";

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
