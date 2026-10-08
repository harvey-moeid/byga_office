import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("index.html", "utf8");

describe("BYGA brand favicon", () => {
  const icons = [
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["favicon-192x192.png", 192],
    ["apple-touch-icon.png", 180],
  ] as const;

  it.each(icons)("%s is a valid PNG with %i px dimensions", (file, size) => {
    const png = readFileSync(`public/${file}`);
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(html).toContain(`href="/${file}"`);
  });

  it("serves a multi-resolution ICO for older browsers", () => {
    const ico = readFileSync("public/favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);
    expect(html).toContain('href="/favicon.ico"');
  });

  it("keeps the app root and Vite module entry intact", () => {
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/src/ui/main.tsx"');
  });
});
