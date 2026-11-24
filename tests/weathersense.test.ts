/**
 * Port of the old `tests/weathersense.test.ts`, all 9 cases.
 *
 * What changed in the call shape:
 * - the old file stood on the shelved countryside (`westlands`); the region
 *   here is `threshold`, a noise-field region with an atlas pin;
 * - one call of the old `tickWeathersense(state, bus, sample)` is the
 *   trainer `trainWeathersense` run with a system context, `held` read from
 *   the skills slice; `noteTravelSkies` is in `world`;
 * - the old `prognosisTitle` (the header tooltip's text, read by no UI in the
 *   old build: the header built its own lines) is the view's `forecast`: the
 *   sky now, the prognosis flag from level 5, the rows. Its date part is left
 *   out, as the old header left it out.
 *
 * New here: the trainer in the tick under an open sky and under a roof, an
 * arrival by travel, and the Sky readout rendered on the server.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { SKILLS, type SkillsState, type SkillState } from '../src/systems/skills';
import {
  FORECAST_ROWS,
  forecastFor,
  isSevere,
  PROGNOSIS_TOOLTIP_AT,
  rowQuality,
  senseState,
  SEVERE_COLD,
  SEVERE_HOT,
  trainWeathersense,
  weatherAt,
  WEATHERSENSE_ID,
  worldSeedOf,
  type WeatherSample,
  type WeatherView,
} from '../src/systems/weather';
import SkyReadout from '../src/systems/weather/SkyReadout.svelte';
import { noteTravelSkies, REGIONS, skyRegionOf, travelTo, type WorldState } from '../src/systems/world';
import { makeGame, patch, reads, run, slice } from './helpers';

const SEED = worldSeedOf(1_754_000_000_000);

function sample(over: Partial<WeatherSample>): WeatherSample {
  return { temp: 15, precip: 0.2, wind: 0.3, kind: 'clear', band: 'mild', ...over };
}

function world(held: Record<string, SkillState> = {}): Kernel {
  const kernel = makeGame();
  if (Object.keys(held).length) patch(kernel, (slices) => Object.assign((slices.skills as SkillsState).skills, held));
  return kernel;
}

const sense = (kernel: Kernel): SkillState | undefined => slice<SkillsState>(kernel, 'skills').skills[WEATHERSENSE_ID];

/** One old `tickWeathersense`: one game minute under an open sky showing `s`. */
function minuteUnder(kernel: Kernel, s: WeatherSample): void {
  const sense = senseState(reads(kernel), WEATHERSENSE_ID, slice<SkillsState>(kernel, 'skills').skills[WEATHERSENSE_ID]);
  run(kernel, (ctx) => trainWeathersense(ctx, s, sense));
}

describe('the sense itself', () => {
  it('is capped at 30 and grows on the weather novelty domain', () => {
    const def = SKILLS[WEATHERSENSE_ID];
    expect(def.maxLevel).toBe(30);
    expect(def.novelty?.domain).toBe('weather');
  });

  it('manifests in the first severe weather, not under a pleasant sky', () => {
    const calm = world();
    minuteUnder(calm, sample({ kind: 'overcast' }));
    expect(sense(calm)).toBeUndefined();

    const storm = world();
    minuteUnder(storm, sample({ kind: 'storm', precip: 0.8, wind: 0.7 }));
    // The manifesting minute also pays its first lesson.
    expect(sense(storm)?.level).toBe(1);
    expect(sense(storm)?.xp).toBeGreaterThan(0);
  });

  it('severity: the event kinds, and only extreme temperatures', () => {
    expect(isSevere(sample({ kind: 'sandstorm' }))).toBe(true);
    expect(isSevere(sample({ kind: 'rain' }))).toBe(false);
    expect(isSevere(sample({ temp: SEVERE_HOT }))).toBe(true);
    expect(isSevere(sample({ temp: SEVERE_COLD }))).toBe(true);
    expect(isSevere(sample({ temp: 33 }))).toBe(false); // hot, but not severe
  });

  it('a second storm teaches less than the first: novelty wears', () => {
    const kernel = world({ [WEATHERSENSE_ID]: { level: 1, xp: 0 } });
    minuteUnder(kernel, sample({ kind: 'storm' }));
    const first = sense(kernel)!.xp;
    minuteUnder(kernel, sample({ kind: 'storm' }));
    const second = sense(kernel)!.xp - first;
    expect(first).toBeGreaterThan(second);
    // A new kind opens at full novelty again.
    minuteUnder(kernel, sample({ kind: 'blizzard', temp: -2 }));
    const blizzard = sense(kernel)!.xp - first - second;
    expect(blizzard).toBeGreaterThan(second);
  });

  it('new regions pay travel novelty; repeats fade', () => {
    const kernel = world({ [WEATHERSENSE_ID]: { level: 1, xp: 0 } });
    run(kernel, (ctx) => noteTravelSkies(ctx, 'threshold'));
    const first = sense(kernel)!.xp;
    run(kernel, (ctx) => noteTravelSkies(ctx, 'threshold'));
    expect(sense(kernel)!.xp - first).toBeLessThan(first);
  });
});

describe('the prognosis', () => {
  const region = REGIONS.threshold;

  it('opens at two hours and reaches seven days only at the cap', () => {
    expect(forecastFor(1, region, SEED, 0)).toHaveLength(1);
    expect(forecastFor(4, region, SEED, 0)).toHaveLength(3);
    expect(forecastFor(PROGNOSIS_TOOLTIP_AT, region, SEED, 0)).toHaveLength(4);
    expect(forecastFor(30, region, SEED, 0)).toHaveLength(FORECAST_ROWS.length);
    expect(FORECAST_ROWS[FORECAST_ROWS.length - 1].hours).toBe(168);
  });

  it('each row arrives rough and sharpens with the levels after it', () => {
    expect(rowQuality(5, 5)).toBe('rough');
    expect(rowQuality(7, 5)).toBe('fair');
    expect(rowQuality(10, 5)).toBe('precise');
  });

  it('a precise row tells the truth: it is the future, sampled', () => {
    const now = 100_000;
    const entries = forecastFor(10, region, SEED, now);
    const tomorrow = entries[3]; // 24h row, req 5, precise at 10
    const truth = weatherAt(SEED, region, now + 24 * 600)!;
    expect(tomorrow.quality).toBe('precise');
    expect(tomorrow.text).toContain(truth.kind);
    expect(tomorrow.text).toContain(`${Math.round(truth.temp)}°`);
  });

  it('the forecast the view carries grows with the sense', () => {
    // At the Foot (Threshold, an open sky) with the seed drawn.
    const kernel = world();
    patch(kernel, (slices) => {
      slices.world.spot = 'ascent_foot';
      slices.weather.seed = SEED;
    });
    const forecast = (k: Kernel) => (k.view().systems.weather as WeatherView).forecast;
    expect(forecast(kernel)).toBeNull();

    patch(kernel, (slices) => (slices.skills.skills[WEATHERSENSE_ID] = { level: 1, xp: 0 }));
    const glance = forecast(kernel)!;
    expect(glance.rows.map((r) => r.label)).toContain('in 2 hours');
    expect(glance.prognosis).toBe(false);

    patch(kernel, (slices) => (slices.skills.skills[WEATHERSENSE_ID] = { level: PROGNOSIS_TOOLTIP_AT, xp: 0 }));
    const read = forecast(kernel)!;
    expect(read.prognosis).toBe(true);
    expect(read.region).toBe('Threshold');
    expect(read.rows.map((r) => r.label)).toContain('tomorrow');
  });
});

// ---------- new here ----------

/** A game at `spot` whose next tick lands on game minute `tick`, the seed drawn, the skills given. */
function minuteAt(spot: string, tick: number, held: Record<string, SkillState> = {}): Kernel {
  const kernel = makeGame();
  patch(kernel, (slices) => {
    slices.world.spot = spot;
    if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
    slices.clock.totalTicks = tick - 1;
    slices.weather.seed = SEED;
    Object.assign((slices.skills as SkillsState).skills, held);
  });
  kernel.tick();
  return kernel;
}

/** The first game hour from the epoch at which the sky over `spot` is severe, or ordinary. */
function hourShowing(spot: string, severe: boolean): number {
  const region = skyRegionOf(spot)!;
  for (let tick = 600; ; tick += 600) if (isSevere(weatherAt(SEED, region, tick)!) === severe) return tick;
}

describe('in the tick', () => {
  it('the first severe minute under an open sky manifests the sense; a roof keeps it out', () => {
    const tick = hourShowing('f4_deep_woods', true);
    expect(sense(minuteAt('f4_deep_woods', tick))?.level).toBe(1);
    // The roofed floors under the same sky: no sample, no lesson.
    expect(sense(minuteAt('f1_landing', tick))).toBeUndefined();
  });

  it('an ordinary open sky pays the held sense the watch rate, and only on a game minute', () => {
    const tick = hourShowing('f4_deep_woods', false);
    const kernel = minuteAt('f4_deep_woods', tick, { [WEATHERSENSE_ID]: { level: 1, xp: 0 } });
    const paid = sense(kernel)!.xp;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(0.1);
    kernel.tick();
    expect(sense(kernel)!.xp).toBe(paid);
    // Not held: an ordinary sky manifests nothing.
    expect(sense(minuteAt('f4_deep_woods', tick))).toBeUndefined();
  });

  it('at the ceiling an ordinary sky sends no grant; a severe sky still counts its novelty key', () => {
    const tick = hourShowing('f4_deep_woods', false);
    const kernel = minuteAt('f4_deep_woods', tick - 10, { [WEATHERSENSE_ID]: { level: 30, xp: 0 } });
    expect(senseState(reads(kernel), WEATHERSENSE_ID, sense(kernel))).toBe('capped');
    let grants = 0;
    kernel.onEvent((event) => {
      if (event.type === 'skills/grant-xp' && (event.payload as { tags: string[] }).tags[0] === 'weather') grants += 1;
    });
    for (let i = 0; i < 10; i++) kernel.tick();
    expect(grants).toBe(0);
    expect(sense(kernel)).toEqual({ level: 30, xp: 0 });
    // Severe: the key is counted at the cap, as the old grant counted it.
    minuteUnder(kernel, sample({ kind: 'storm' }));
    expect(slice<SkillsState>(kernel, 'skills').novelty[WEATHERSENSE_ID]?.['wx:storm']).toBe(1);
    expect(sense(kernel)).toEqual({ level: 30, xp: 0 });
    // A raised cap trains again.
    patch(kernel, (slices) => (slices.skills.skills[WEATHERSENSE_ID] = { level: 30, xp: 0, capRaised: 5 }));
    expect(senseState(reads(kernel), WEATHERSENSE_ID, sense(kernel))).toBe('training');
  });

  it('an arrival by travel pays the held sense, keyed by the region of the spot', () => {
    const kernel = minuteAt('ascent_foot', 6000, { [WEATHERSENSE_ID]: { level: 1, xp: 0 } });
    patch(kernel, (slices) => (slices.world.discovered = [...slices.world.discovered, 'lectory_steps']));
    const before = slice<SkillsState>(kernel, 'skills').novelty[WEATHERSENSE_ID]?.['skies:threshold'] ?? 0;
    expect(kernel.dispatch(travelTo({ to: 'lectory_steps' })).ok).toBe(true);
    for (let i = 0; i < 100 && slice<WorldState>(kernel, 'world').travel; i++) kernel.tick();
    expect(slice<WorldState>(kernel, 'world').spot).toBe('lectory_steps');
    expect(slice<SkillsState>(kernel, 'skills').novelty[WEATHERSENSE_ID]?.['skies:threshold']).toBe(before + 1);
  });
});

describe('the Sky readout', () => {
  const view = (level: number) => {
    const kernel = world({ [WEATHERSENSE_ID]: { level, xp: 0 } });
    patch(kernel, (slices) => {
      slices.world.spot = 'ascent_foot';
      slices.weather.seed = SEED;
    });
    return (kernel.view().systems.weather as WeatherView).forecast;
  };

  it('renders nothing below level 1', () => {
    expect(render(SkyReadout, { props: { forecast: null } }).body).not.toContain('sky-readout');
  });

  it('renders the sky now and one line per row, a rough row marked', () => {
    const forecast = view(3)!;
    const html = render(SkyReadout, { props: { forecast } }).body;
    expect(html).toContain('sky-readout');
    expect(html).toContain(`Now: ${forecast.now}`);
    expect(html).not.toContain('Prognosis:');
    expect(forecast.rows.map((r) => r.quality)).toEqual(['fair', 'rough', 'rough']);
    expect(html).toContain(`In 2 hours: ${forecast.rows[0].text}`);
    expect(html).toContain(`In 12 hours: ${forecast.rows[2].text} (rough)`);
    expect(html.match(/data-quality=/g)).toHaveLength(3);
  });

  it('from level 5 names the region of the prognosis', () => {
    const html = render(SkyReadout, { props: { forecast: view(PROGNOSIS_TOOLTIP_AT)! } }).body;
    expect(html).toContain('Prognosis: Threshold');
    expect(html).toContain('Tomorrow: ');
  });
});
