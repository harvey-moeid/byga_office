import { describe, expect, it } from "vitest";
import { rooms } from "../src/ui/navigation";
import { missingRoomSigns, roomSignDefinitions } from "../src/ui/room-sign-layout";
import { parseQualityMode, profiles } from "../src/ui/quality";

describe("physical signage", () => {
  it("provides one physical marker for every ground-floor room and two upstairs", () => {
    expect(missingRoomSigns()).toEqual([]);
    expect(roomSignDefinitions.length).toBe(rooms.length + 2);
    expect(new Set(roomSignDefinitions.map((sign) => sign.id)).size).toBe(roomSignDefinitions.length);
    expect(roomSignDefinitions.filter((sign) => sign.floor === 2).map((sign) => sign.label)).toEqual([
      "BOSS OFFICE", "STRATEGY ROOM",
    ]);
  });
  it("uses fixed supported surfaces or freestanding pedestals instead of overlays", () => {
    for (const sign of roomSignDefinitions) {
      expect(["wall", "stand"]).toContain(sign.mount);
      expect(sign.position.every(Number.isFinite)).toBe(true);
      expect(sign.width).toBeGreaterThan(0.5);
      expect(sign.height).toBeGreaterThan(0);
      if (sign.mount === "stand") expect(sign.floor).not.toBe(2);
    }
    expect(roomSignDefinitions.filter((sign) => sign.interactive).map((sign) => sign.id))
      .toEqual(["Server / Data"]);
  });
  it("preserves the low single-floor and medium two-floor profiles", () => {
    expect(profiles.low.upperFloor).toBe(false);
    expect(profiles.medium.upperFloor).toBe(true);
    expect(profiles.medium.shadows).toBe(false);
    expect(profiles.medium.dpr).toBe(1);
  });
});

describe("quality selection persistence", () => {
  it("selects Medium for a first visit or invalid stored value", () => {
    expect(parseQualityMode(null)).toBe("medium");
    expect(parseQualityMode("")).toBe("medium");
    expect(parseQualityMode("garbage")).toBe("medium");
  });
  it("respects all explicit stored user choices, including Auto", () => {
    for (const selection of ["low", "medium", "high", "ultra", "auto"] as const) {
      expect(parseQualityMode(selection)).toBe(selection);
    }
  });
});
