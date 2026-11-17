/**
 * Port of the old `tests/weather.test.ts`, whole. The sample functions take
 * the seed and a region, as before; only the import paths changed.
 */
import { describe, expect, it } from 'vitest';
import { clockOf } from '../src/systems/clock';
import { anomalyAt, classify, climateBaseline, weatherAt, worldSeedOf } from '../src/systems/weather';
import type { RegionDef } from '../src/systems/world';

const SEED = worldSeedOf(1_754_000_000_000);

const plains: RegionDef = { id: 'r', name: 'R', terrain: 'plains', world: { x: 12, y: 28 } };
const cave: RegionDef = { id: 'c', name: 'C', terrain: 'caves', sheltered: true, world: { x: 17.5, y: 30.5 } };

/** Ticks at absolute day `d`, hour `h`. */
const at = (d: number, h = 0) => (d * 1440 + h * 60) * 10;

describe('the anomaly field', () => {
  it('is deterministic, and a different seed gives different skies', () => {
    expect(anomalyAt(SEED, 'temp', 12, 28, 100)).toBe(anomalyAt(SEED, 'temp', 12, 28, 100));
    expect(anomalyAt(SEED, 'temp', 12, 28, 100)).not.toBe(anomalyAt(worldSeedOf(42), 'temp', 12, 28, 100));
    expect(worldSeedOf(1)).toBe(worldSeedOf(1));
    expect(worldSeedOf(1)).not.toBe(worldSeedOf(2));
  });

  it('is about standard normal across space and time', () => {
    const samples: number[] = [];
    // Steps larger than the wavelengths of the widest octave, so samples decorrelate.
    for (let x = 0; x < 100; x += 11) {
      for (let y = 0; y < 75; y += 9.5) {
        for (let t = 0; t < 9000; t += 170) {
          samples.push(anomalyAt(SEED, 'temp', x, y, t));
        }
      }
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const std = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(std).toBeGreaterThan(0.8);
    expect(std).toBeLessThan(1.25);
  });

  it('near points differ less than far points', () => {
    let near = 0;
    let far = 0;
    let n = 0;
    for (let y = 5; y < 70; y += 7) {
      for (let t = 50; t < 5000; t += 333) {
        const here = anomalyAt(SEED, 'temp', 30, y, t);
        near += Math.abs(here - anomalyAt(SEED, 'temp', 31.5, y, t));
        far += Math.abs(here - anomalyAt(SEED, 'temp', 70, y, t));
        n++;
      }
    }
    expect(near / n).toBeLessThan(far / n);
  });
});

describe('the climate baseline', () => {
  it('a region with no pin has no weather', () => {
    const unplaced: RegionDef = { id: 'x', name: 'X' };
    expect(climateBaseline(unplaced, clockOf(0))).toBeNull();
    expect(weatherAt(SEED, unplaced, 0)).toBeNull();
  });

  it('midsummer noon is warmer than midwinter midnight', () => {
    const summer = climateBaseline(plains, clockOf(at(183, 12)))!;
    const winter = climateBaseline(plains, clockOf(at(367, 0)))!;
    expect(summer.temp - winter.temp).toBeGreaterThan(10);
  });

  it('south is warmer than north: y grows toward the equator', () => {
    const north = climateBaseline({ ...plains, world: { x: 12, y: 10 } }, clockOf(at(50, 12)))!;
    const south = climateBaseline({ ...plains, world: { x: 12, y: 60 } }, clockOf(at(50, 12)))!;
    expect(south.temp).toBeGreaterThan(north.temp);
  });

  it('a sheltered cave has no wind and no precipitation', () => {
    const inside = weatherAt(SEED, cave, at(200, 15))!;
    expect(inside.wind).toBe(0);
    expect(inside.precip).toBe(0);
    expect(inside.kind).toBe('still');
    // The seasonal swing inside is under 3 degrees.
    const caveSummer = climateBaseline(cave, clockOf(at(183, 12)))!;
    const caveWinter = climateBaseline(cave, clockOf(at(367, 0)))!;
    expect(caveSummer.temp - caveWinter.temp).toBeLessThan(3);
  });
});

describe('classification', () => {
  const kind = (temp: number, precip: number, wind: number, terrain?: RegionDef['terrain']) =>
    classify({ temp, precip, wind }, terrain ?? 'plains', false);

  it('each kind follows from the three values', () => {
    expect(kind(14, 0.7, 0.3)).toBe('rain');
    expect(kind(14, 0.7, 0.7)).toBe('storm');
    expect(kind(-4, 0.7, 0.3)).toBe('snow');
    expect(kind(-4, 0.7, 0.7)).toBe('blizzard');
    expect(kind(30, 0.1, 0.7, 'desert')).toBe('sandstorm');
    expect(kind(12, 0.1, 0.8)).toBe('gale');
    expect(kind(10, 0.4, 0.05)).toBe('mist');
    expect(kind(22, 0.05, 0.2)).toBe('clear');
    expect(kind(15, 0.3, 0.3)).toBe('overcast');
  });

  it('a full sample is deterministic', () => {
    const a = weatherAt(SEED, plains, at(97, 9));
    const b = weatherAt(SEED, plains, at(97, 9));
    expect(a).toEqual(b);
    expect(a!.band).toBeDefined();
  });

  it('a year of weather in one region holds at least three kinds', () => {
    const kinds = new Set<string>();
    for (let d = 0; d < 368; d += 3) kinds.add(weatherAt(SEED, plains, at(d, 12))!.kind);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});
