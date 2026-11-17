import { describe, expect, it } from "vitest";
import { projectSaveInput } from "@shared/construction";
import {
  ganttColorInput,
  ganttColorText,
  ganttPalettes,
  ganttProjectColors,
} from "@shared/gantt-colors";

function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => {
    const rgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return rgb <= 0.04045 ? rgb / 12.92 : ((rgb + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("Gantt project color palettes", () => {
  it("provides five visibly different ordered shades with readable text", () => {
    for (const palette of ganttPalettes) {
      const result = ganttProjectColors({ ganttPalette: palette.id });
      expect(result.base).toBe(palette.color);
      expect(new Set(result.levels).size).toBe(5);
      const lightness = result.levels.map(luminance);
      for (const [index, color] of result.levels.entries()) {
        if (index)
          expect(lightness[index] - lightness[index - 1]).toBeGreaterThan(0.03);
        const contrast =
          ganttColorText(color) === "#ffffff"
            ? 1.05 / (lightness[index] + 0.05)
            : (lightness[index] + 0.05) / 0.05;
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps automatic palettes project-specific and normalizes custom colors", () => {
    const oldProject = { id: 29, ganttPalette: null, ganttColor: null };
    const automatic = ganttProjectColors(oldProject);
    expect(ganttProjectColors({ ...oldProject })).toEqual(automatic);
    expect(ganttProjectColors({ id: 30 }).base).not.toBe(automatic.base);
    const custom = ganttProjectColors({ ...oldProject, ganttColor: "#8080FF" });
    expect(custom.base).toBe("#8080ff");
    expect(custom.levels).toHaveLength(5);
    expect(ganttColorInput.safeParse("#0af").success).toBe(false);
  });

  it("validates optional palette fields on the existing project save", () => {
    const parse = (data: Record<string, string>) =>
      projectSaveInput.parse({
        key: "11111111-1111-4111-8111-111111111111",
        data: { name: "Library construction", ...data },
      }).data;
    expect(parse({}).ganttPalette).toBeUndefined();
    expect(
      parse({ ganttPalette: "violet", ganttColor: "#2E4AC7" })
    ).toMatchObject({
      ganttPalette: "violet",
      ganttColor: "#2e4ac7",
    });
    expect(() => parse({ ganttPalette: "missing" })).toThrow();
  });
});
