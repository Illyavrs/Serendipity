import type { CSSProperties } from 'react';

// Difficulty colour spectrum used by osu-web for star ratings.
const stops: [number, [number, number, number]][] = [
  [0.1, [0x42, 0x90, 0xfb]],
  [1.25, [0x4f, 0xc0, 0xff]],
  [2, [0x4f, 0xff, 0xd5]],
  [2.5, [0x7c, 0xff, 0x4f]],
  [3.3, [0xf6, 0xf0, 0x5c]],
  [4.2, [0xff, 0x80, 0x68]],
  [4.9, [0xff, 0x4e, 0x6f]],
  [5.8, [0xc6, 0x45, 0xb8]],
  [6.7, [0x65, 0x63, 0xde]],
  [7.7, [0x18, 0x15, 0x8e]],
  [9, [0x00, 0x00, 0x00]],
];

function channel(value: number) {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

export function difficultySpectrum(stars: number): [number, number, number] {
  if (!Number.isFinite(stars) || stars < stops[0][0]) return [0xaa, 0xaa, 0xaa];
  if (stars >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  const upper = stops.findIndex(([at]) => stars < at);
  const [from, low] = stops[upper - 1];
  const [to, high] = stops[upper];
  const t = (stars - from) / (to - from);
  // osu-web interpolates with d3.interpolateRgb.gamma(2.2).
  const gamma = 2.2;
  return [0, 1, 2].map((i) =>
    Math.round((low[i] ** gamma + (high[i] ** gamma - low[i] ** gamma) * t) ** (1 / gamma)),
  ) as [number, number, number];
}

/**
 * `--difficulty-color` is the exact spectrum colour. The lift/sink percentages
 * let text stay readable on dark (lift towards white) and light (sink towards
 * black) surfaces without changing the hue family.
 */
export function difficultyStyle(stars: number): CSSProperties {
  const [r, g, b] = difficultySpectrum(stars);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const lift = Math.min(70, Math.max(0, Math.round((0.15 - luminance) * 450)));
  const sink = Math.min(50, Math.max(0, Math.round((luminance - 0.5) * 120)));
  return {
    '--difficulty-color': `rgb(${r} ${g} ${b})`,
    '--difficulty-lift': `${lift}%`,
    '--difficulty-sink': `${sink}%`,
    // osu-web draws high ratings as a dark badge with gold text.
    '--difficulty-text': stars >= 6.5 ? '#ffd966' : '#000000',
  } as CSSProperties;
}
