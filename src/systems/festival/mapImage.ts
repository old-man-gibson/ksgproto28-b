/**
 * The royale terrain as an image. Port of old `ui/lib/royaleMapImage.svelte.ts`
 * (step 4 port C5): one pixel per cell, a colour per section from the theme's
 * tokens (`royaleView.ts` `mapPalette`), drawn once per seed and palette into
 * an offscreen canvas and handed to the map as a data URL. The map places it
 * under the isometric transform as a single SVG image, so a 180 by 180 field
 * costs one element rather than 32,400.
 *
 * Panel side: it reads the page. The old file watched `data-theme` with a
 * mutation observer; here the panel reads the shell's theme rune, so a
 * theme switch redraws the image. Without a page (a server render in a
 * test) it answers '' and the map draws no terrain.
 */
import type { RoyaleMap } from './royaleMap';
import { mapPalette, paletteKey, royaleMapPixels, type MapPalette } from './royaleView';

/** The map palette under the page's current theme; null without a page. */
export function readPalette(): MapPalette | null {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return null;
  const css = getComputedStyle(document.documentElement);
  return mapPalette((token) => css.getPropertyValue(token));
}

/** The last few images drawn, by seed and palette: a field reads its image every render. */
const DRAWN = new Map<string, string>();
const DRAWN_SIZE = 6;

/** The terrain of `map` as a PNG data URL ('' where there is no canvas to draw on). */
export function mapDataUrl(map: RoyaleMap, palette: MapPalette | null): string {
  if (!palette || typeof document === 'undefined') return '';
  const key = `${map.seed}:${map.size}:${paletteKey(palette)}`;
  const hit = DRAWN.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = map.size;
  canvas.height = map.size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(map.size, map.size);
  image.data.set(royaleMapPixels(map, palette));
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL('image/png');
  DRAWN.set(key, url);
  if (DRAWN.size > DRAWN_SIZE) DRAWN.delete(DRAWN.keys().next().value!);
  return url;
}
