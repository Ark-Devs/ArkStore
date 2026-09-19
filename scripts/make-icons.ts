// Renders ArkStore's icons: a dot-matrix "A" with a red full stop, Nothing-glyph style.
//   npx tsx scripts/make-icons.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

type RGBA = [number, number, number, number];

const WHITE: RGBA = [244, 244, 244, 255];
const RED: RGBA = [224, 36, 43, 255];
const FAINT: RGBA = [34, 34, 34, 255];
const BLACK: RGBA = [0, 0, 0, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

// 7x7 panel: "A" in the first five columns, a red dot bottom-right.
const GLYPH = [
  '..#....',
  '.#.#...',
  '#...#..',
  '#...#..',
  '#####..',
  '#...#..',
  '#...#.R',
];

function render(size: number, opts: { background: RGBA; panel: number; faint: boolean; mono?: boolean }) {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) png.data.set(opts.background, i * 4);

  const pitch = opts.panel / 7;
  const r = pitch * 0.38;
  const origin = (size - opts.panel) / 2;

  const dot = (cx: number, cy: number, color: RGBA) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(size - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(size - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cover = Math.max(0, Math.min(1, r - d + 0.5)) * (color[3] / 255);
        if (cover <= 0) continue;
        const i = (y * size + x) * 4;
        const a = png.data[i + 3] / 255;
        const outA = cover + a * (1 - cover);
        for (let k = 0; k < 3; k++) {
          png.data[i + k] = Math.round((color[k] * cover + png.data[i + k] * a * (1 - cover)) / (outA || 1));
        }
        png.data[i + 3] = Math.round(outA * 255);
      }
    }
  };

  GLYPH.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      const cx = origin + pitch * (x + 0.5);
      const cy = origin + pitch * (y + 0.5);
      if (cell === '#') dot(cx, cy, WHITE);
      else if (cell === 'R') dot(cx, cy, opts.mono ? WHITE : RED);
      else if (opts.faint) dot(cx, cy, FAINT);
    }),
  );
  return PNG.sync.write(png);
}

const out = (name: string) => join(import.meta.dirname, '..', 'assets', 'images', name);

writeFileSync(out('icon.png'), render(1024, { background: BLACK, panel: 640, faint: true }));
// Adaptive icon: the launcher masks to ~66% of the canvas, keep the glyph inside it.
writeFileSync(out('android-icon-foreground.png'), render(1024, { background: CLEAR, panel: 520, faint: true }));
writeFileSync(out('android-icon-background.png'), render(1024, { background: BLACK, panel: 0, faint: false }));
writeFileSync(out('android-icon-monochrome.png'), render(1024, { background: CLEAR, panel: 520, faint: false, mono: true }));
writeFileSync(out('splash-icon.png'), render(512, { background: CLEAR, panel: 400, faint: true }));
writeFileSync(out('favicon.png'), render(64, { background: BLACK, panel: 52, faint: false }));

// Dot tiles for the Nothing-style grids and dotted rules. Drawn once as tiny PNGs and
// repeated by the image view: far cheaper to scroll than live SVG patterns.
// White on transparent; the app tints them per theme. @2x/@3x match screen density.
function tile(w: number, h: number, dots: [number, number, number][]) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  for (const [cx, cy, r] of dots) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cover = Math.max(0, Math.min(1, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
        if (cover <= 0) continue;
        const i = (y * w + x) * 4;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
        png.data[i + 3] = Math.max(png.data[i + 3], Math.round(cover * 255));
      }
    }
  }
  return PNG.sync.write(png);
}
const tiles: Record<string, (s: number) => Buffer> = {
  'dot-grid-12': (s) => tile(12 * s, 12 * s, [[6 * s, 6 * s, 1.25 * s]]),
  'dot-grid-8': (s) => tile(8 * s, 8 * s, [[4 * s, 4 * s, 0.9 * s]]),
  'dot-rule': (s) => tile(6 * s, 4 * s, [[3 * s, 2 * s, 1 * s]]),
  'dot-rule-v': (s) => tile(4 * s, 5 * s, [[2 * s, 2.5 * s, 1 * s]]),
};
for (const [name, draw] of Object.entries(tiles)) {
  for (const scale of [1, 2, 3]) {
    writeFileSync(out(`dots/${name}${scale === 1 ? '' : `@${scale}x`}.png`), draw(scale));
  }
}
console.log('Icons and dot tiles written to assets/images');
