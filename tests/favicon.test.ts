import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("index.html", "utf8");
const dataView = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("BYGA brand favicon", () => {
  const icons = [
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["favicon-192x192.png", 192],
    ["apple-touch-icon.png", 180],
  ] as const;

  it.each(icons)("%s is a valid PNG with %i px dimensions", (file, size) => {
    const png = readFileSync(`public/${file}`);
    const view = dataView(png);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    expect(view.getUint32(16, false)).toBe(size);
    expect(view.getUint32(20, false)).toBe(size);
    expect(html).toContain(`href="/${file}"`);
  });

  it("serves a multi-resolution ICO for older browsers", () => {
    const ico = readFileSync("public/favicon.ico");
    const view = dataView(ico);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBeGreaterThanOrEqual(2);
    expect(html).toContain('href="/favicon.ico"');
  });

  it("keeps the app root and Vite module entry intact", () => {
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/src/ui/main.tsx"');
  });
});
