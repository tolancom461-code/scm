import { z } from "zod";

const definitions = [
  ["blue", "أزرق", "Blue", "نیلا", "#2775b5"],
  ["violet", "بنفسجي", "Violet", "بنفشی", "#6949a5"],
  ["orange", "برتقالي", "Orange", "نارنجی", "#ad5d28"],
  ["teal", "تركوازي", "Teal", "فیروزی", "#0b827b"],
  ["emerald", "زمردي", "Emerald", "زمردی", "#227b55"],
  ["rose", "وردي", "Rose", "گلابی", "#b1416b"],
  ["indigo", "نيلي", "Indigo", "نیلگوں", "#4252a8"],
  ["gold", "ذهبي", "Gold", "سنہری", "#9c711b"],
  ["berry", "توتي", "Berry", "جامنی گلابی", "#913b89"],
  ["olive", "زيتوني", "Olive", "زیتونی", "#657524"],
  ["slate", "أردوازي", "Slate", "سلیٹی", "#536878"],
  ["brick", "قرميدي", "Brick", "اینٹی سرخ", "#a3463d"],
] as const;

export const ganttPaletteInput = z.enum(definitions.map(([id]) => id));
export type GanttPaletteId = z.infer<typeof ganttPaletteInput>;
export const ganttPalettes = definitions.map(([id, ar, en, ur, color]) => ({
  id,
  label: { ar, en, ur },
  color,
}));
export const ganttColorInput = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform(value => value.toLowerCase());

function channels(hex: string) {
  return [1, 3, 5].map(offset =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  );
}

function shade(hex: string, lightness: number) {
  const rgb = channels(hex).map(value => value / 255);
  const high = Math.max(...rgb);
  const low = Math.min(...rgb);
  const delta = high - low;
  if (!delta) {
    const channel = Math.round(lightness * 255)
      .toString(16)
      .padStart(2, "0");
    return "#" + channel.repeat(3);
  }
  const saturation = delta / (1 - Math.abs(high + low - 1));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * Math.min(0.74, saturation);
  const offset = lightness - chroma / 2;
  return (
    "#" +
    rgb
      .map(value =>
        Math.round((offset + ((value - low) / delta) * chroma) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

export function ganttProjectColors(project: {
  id?: number | null;
  ganttPalette?: string | null;
  ganttColor?: string | null;
}) {
  const palette =
    ganttPalettes.find(color => color.id === project.ganttPalette) ??
    ganttPalettes[Math.max(0, (project.id ?? 1) - 1) % ganttPalettes.length];
  const base =
    ganttColorInput.safeParse(project.ganttColor).data ?? palette.color;
  const levels = [
    shade(base, 0.22),
    shade(base, 0.34),
    shade(base, 0.47),
    shade(base, 0.61),
    shade(base, 0.76),
  ] as const;
  return { base, levels };
}

export function ganttColorText(color: string) {
  const [red, green, blue] = channels(color).map(value => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return luminance >= 0.179 ? "#000000" : "#ffffff";
}
