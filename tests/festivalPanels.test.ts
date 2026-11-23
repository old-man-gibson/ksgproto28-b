/**
 * The festival's two panels, rendered on the server (`svelte/server`) with
 * the game's views, as `tests/harbor.test.ts` renders the sea's readout.
 * Every control is found in the page and the command its action carries is
 * sent; the case checks what the command did.
 *
 * - `FestivalReadout.svelte` (the Location panel): "Enter the royale now"
 *   in the hub, with the hub's preview of the field (step 4 port C5); on
 *   floor 16 `RoyaleFieldReadout.svelte`: the ground and the minimap (a
 *   click walks there), the arrow keys, the "Whole field" toggle, the
 *   plan's three pickers and "Back to the plan". A click on the ground or
 *   the minimap is turned into a field point by `walkAt` (the panel's
 *   handler calls it with the SVG's point); the case calls it with a
 *   point it projects, then sends the command.
 * - `StashReadout.svelte` (the Prestige panel): per token, the permanent
 *   bonus, each technique on offer and the regalia; per kept item, "Take
 *   out".
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import FestivalReadout from '../src/systems/festival/FestivalReadout.svelte';
import StashReadout from '../src/systems/festival/StashReadout.svelte';
import {
  ARENA,
  DARK_FLOOR,
  DEFAULT_ROYALE_PLAN,
  isoPoint,
  ROYALE_STRATEGIES,
  scoutedKey,
  type FestivalState,
  type FestivalView,
  type StashAction,
} from '../src/systems/festival';
import { backToPlanCommand, enterRoyaleCommand, nudgeCommand, planSlotCommand, walkAt } from '../src/systems/festival/royaleControls';
import type { ItemsState, ItemsView } from '../src/systems/items';
import { FLOORS } from '../src/systems/ladder';
import type { MartialState } from '../src/systems/martial';
import { ATTRIBUTE_IDS } from '../src/systems/stats';
import { climb as climbCommand, travelTo } from '../src/systems/world';
import { playerStats, setHp } from './combatHelpers';
import { makeGame, patch, slice } from './helpers';
import { setCounters, worldOf } from './worldHelpers';

const festivalView = (k: Kernel): FestivalView => k.view().systems.festival as FestivalView;
const itemsView = (k: Kernel): ItemsView => k.view().systems.items as ItemsView;
const legacyOf = (k: Kernel) => slice<FestivalState>(k, 'festival').legacy;
const stashOf = (k: Kernel) => slice<ItemsState>(k, 'items').stash;

function stashHtml(k: Kernel): string {
  return render(StashReadout, { props: { stash: festivalView(k).stash, kept: itemsView(k).stash, onSend: () => {} } }).body;
}

/** Find a control in the rendered stash, check it is drawn and enabled, and send its command. */
function press(k: Kernel, find: (v: FestivalView) => StashAction | undefined, index: number): boolean {
  const action = find(festivalView(k));
  expect(action, 'no such control').toBeDefined();
  const html = stashHtml(k);
  expect(html, `the stash renders no ${action!.id} control`).toContain(`data-action="${action!.id}" data-index="${index}"`);
  expect(html).toContain(action!.label);
  expect(action!.blocked, `${action!.id} is disabled: ${action!.blocked}`).toBeNull();
  return k.dispatch(action!.command).ok;
}

const tokenAction = (index: number, id: string) => (v: FestivalView) =>
  v.stash.tokens.find((t) => t.index === index)?.actions.find((a) => a.id === id);

function withTokens(k: Kernel, seeds: number[]): Kernel {
  patch(k, (s) => {
    for (const seed of seeds) (s.festival as FestivalState).legacy.tokens.push({ seed });
  });
  return k;
}

describe('the stronghold stash panel', () => {
  it('is hidden with nothing in it and shown with a token', () => {
    const k = makeGame({ seed: 0 });
    expect(festivalView(k).stash.shown).toBe(false);
    expect(stashHtml(k)).not.toContain('stash-readout');
    withTokens(k, [1]);
    expect(festivalView(k).stash.shown).toBe(true);
    expect(stashHtml(k)).toContain('stash-readout');
  });

  it('the bonus control buys a stack', () => {
    const k = withTokens(makeGame({ seed: 0 }), [1]);
    expect(press(k, tokenAction(0, 'bonus'), 0)).toBe(true);
    expect(legacyOf(k).bonus).toBe(1);
    expect(legacyOf(k).tokens).toEqual([]);
  });

  it('a technique control learns that technique, canonical', () => {
    const k = withTokens(makeGame({ seed: 0 }), [12345]);
    const offer = festivalView(k).stash.tokens[0].actions.find((a) => a.id.startsWith('technique:'))!;
    const id = offer.id.slice('technique:'.length);
    expect(press(k, tokenAction(0, offer.id), 0)).toBe(true);
    expect(legacyOf(k).techniques).toEqual([id]);
    expect(slice<MartialState>(k, 'martial').techniques[id]?.form).toBe('canonical');
  });

  it('the regalia control mints the regalia into the stash, and the take-out control moves it to the pack', () => {
    const k = withTokens(makeGame({ seed: 0 }), [1]);
    expect(press(k, tokenAction(0, 'regalia'), 0)).toBe(true);
    expect(stashOf(k).map((i) => i.defId)).toEqual(['festival_regalia']);
    expect(stashHtml(k)).toContain('Festival Regalia');
    expect(press(k, (v) => v.stash.takeOut[0], 0)).toBe(true);
    expect(stashOf(k)).toEqual([]);
    expect(slice<ItemsState>(k, 'items').inventory.some((i) => i.defId === 'festival_regalia')).toBe(true);
  });

  it('the bonus control is drawn disabled at the cap, with the reason', () => {
    const k = withTokens(makeGame({ seed: 0 }), [1]);
    patch(k, (s) => {
      (s.festival as FestivalState).legacy.bonus = 5;
    });
    const bonus = tokenAction(0, 'bonus')(festivalView(k))!;
    expect(bonus.blocked).toBe('The bonus is at its cap of 5 stacks.');
    expect(stashHtml(k)).toMatch(/<button[^>]*disabled[^>]*>\s*<span data-action="bonus"/);
    expect(k.dispatch(bonus.command).ok).toBe(false);
  });

  it('take-out is drawn disabled inside a festival attempt', () => {
    const k = withTokens(makeGame({ seed: 0 }), [1]);
    expect(press(k, tokenAction(0, 'regalia'), 0)).toBe(true);
    // Into an attempt: floors below cleared, a strong body, the ride to the dark room.
    const values: Record<string, number> = {};
    for (const f of Object.values(FLOORS)) {
      if (f.bandId === undefined || f.index >= 15) continue;
      for (const c of f.clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
    }
    setCounters(k, values);
    patch(k, (s) => {
      s.world.spot = FLOORS.ascent_f14.landing!;
      for (const a of ATTRIBUTE_IDS) (s.attributes as AttributesState).attrs[a].level = 400;
    });
    setHp(k, playerStats(k).maxHp);
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
    for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
    const take = festivalView(k).stash.takeOut[0];
    expect(take.blocked).not.toBeNull();
    expect(stashHtml(k)).toMatch(/<button[^>]*disabled[^>]*>\s*<span data-action="take"/);
    expect(k.dispatch(take.command).ok).toBe(false);
  });
});

describe('the festival readout', () => {
  it('is hidden outside an attempt; inside it shows the dark room, then the hub, at fixed lines', () => {
    const k = makeGame({ seed: 0 });
    expect(festivalView(k).attempt).toBeNull();
    expect(render(FestivalReadout, { props: { attempt: null } }).body).not.toContain('festival-readout');
    const values: Record<string, number> = {};
    for (const f of Object.values(FLOORS)) {
      if (f.bandId === undefined || f.index >= 15) continue;
      for (const c of f.clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
    }
    setCounters(k, values);
    patch(k, (s) => {
      s.world.spot = FLOORS.ascent_f14.landing!;
      for (const a of ATTRIBUTE_IDS) (s.attributes as AttributesState).attrs[a].level = 400;
    });
    setHp(k, playerStats(k).maxHp);
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
    for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
    const dark = render(FestivalReadout, { props: { attempt: festivalView(k).attempt } }).body;
    expect(dark).toContain('festival-readout');
    expect(dark).toContain('Still standing: 9');
    expect(dark).toContain('Waves left: 4');
    for (let i = 0; i < 20_000 && festivalView(k).attempt?.phase !== 'prep'; i++) k.tick();
    expect(k.dispatch(travelTo({ to: 'f15_hall' })).ok).toBe(true);
    for (let i = 0; i < 200 && worldOf(k).travel; i++) k.tick();
    const hub = render(FestivalReadout, { props: { attempt: festivalView(k).attempt } }).body;
    expect(hub).toContain('Festival day: 1 of 10, 00:00');
    expect(hub).toContain('Preparing until then: the other 99');
  });
});

/** A festival attempt with the dark room emptied: standing in the hall. */
function inHall(seed = 0): Kernel {
  const k = makeGame({ seed });
  const values: Record<string, number> = {};
  for (const f of Object.values(FLOORS)) {
    if (f.bandId === undefined || f.index >= 15) continue;
    for (const c of f.clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
  patch(k, (s) => {
    s.world.spot = FLOORS.ascent_f14.landing!;
    for (const a of ATTRIBUTE_IDS) (s.attributes as AttributesState).attrs[a].level = 400;
  });
  setHp(k, playerStats(k).maxHp);
  expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
  for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
  for (let i = 0; i < 20_000 && festivalView(k).attempt?.phase !== 'prep'; i++) k.tick();
  expect(k.dispatch(travelTo({ to: 'f15_hall' })).ok).toBe(true);
  for (let i = 0; i < 200 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).spot).toBe('f15_hall');
  return k;
}

/** The readout as the panel passes it. */
function readoutHtml(k: Kernel): string {
  const v = festivalView(k);
  return render(FestivalReadout, {
    props: { attempt: v.attempt, royale: v.royale, preview: v.preview, plan: v.plan, enter: v.enter, onSend: () => {} },
  }).body;
}

/** In the royale with its field open: climbed from the hall, one tick on the arena. */
function onField(): Kernel {
  const k = inHall();
  expect(k.dispatch(enterRoyaleCommand()).ok).toBe(true);
  for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).spot).toBe(ARENA);
  k.tick();
  expect(festivalView(k).royale).not.toBeNull();
  return k;
}

const fieldOf = (k: Kernel) => slice<FestivalState>(k, 'festival').run!.field!;

describe('the festival readout: the hub and the royale (step 4 port C5)', () => {
  it('the hub shows the preview of the attempt’s field, scouted sections listed with their caches and dens', () => {
    const k = inHall();
    const v = festivalView(k);
    expect(v.preview).not.toBeNull();
    expect(v.preview!.seed).toBe(slice<FestivalState>(k, 'festival').run!.fieldSeed);
    expect(v.preview!.scouted).toBe(0);
    expect(v.preview!.features).toEqual([]);
    let html = readoutHtml(k);
    expect(html).toContain('data-testid="festival-preview"');
    expect(html).toContain('Scouted: 0 of 8.');
    expect(html).toContain('not scouted');
    setCounters(k, { [scoutedKey('cave')]: 1 });
    html = readoutHtml(k);
    expect(html).toContain('Scouted: 1 of 8.');
    expect(html).toContain('scouted, 4 caches and 1 den');
    expect(festivalView(k).preview!.features.map((f) => f.id).sort()).toEqual(
      ['bear_cave', 'cave_mouth', 'deep_cache', 'hermit_niche', 'miners_niche'].sort(),
    );
  });

  it('"Enter the royale now" is drawn enabled in the hub; pressing it climbs to floor 16 and jumps the clock', () => {
    const k = inHall();
    const v = festivalView(k);
    expect(v.enter).toEqual({ blocked: null });
    const html = readoutHtml(k);
    expect(html).toContain('data-action="enter-royale"');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*<span data-action="enter-royale"/);
    expect(k.dispatch(enterRoyaleCommand()).ok).toBe(true);
    // On the way up: the readout is the royale's, with no enter control.
    expect(festivalView(k).attempt!.phase).toBe('royale');
    expect(festivalView(k).enter).toBeNull();
    expect(readoutHtml(k)).not.toContain('data-action="enter-royale"');
    for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
    expect(worldOf(k).spot).toBe(ARENA);
  }, 30_000);

  it('"Enter the royale now" is drawn disabled with its reason while travelling', () => {
    const k = inHall();
    expect(k.dispatch(travelTo({ to: 'f15_stores' })).ok).toBe(true);
    const v = festivalView(k);
    expect(v.enter!.blocked).toMatch(/^Travelling/);
    expect(readoutHtml(k)).toMatch(/<button[^>]*disabled[^>]*>\s*<span data-action="enter-royale"/);
  });

  it('on the field: the map, its fixed lines and every control are drawn', () => {
    const k = onField();
    const html = readoutHtml(k);
    expect(html).toContain('data-testid="royale-field"');
    expect(html).toMatch(/Field: \d+ standing, \d+ on your map\./);
    expect(html).toMatch(/Fights: \d+ duelling each other, \d+ fighting you\./);
    expect(html).toMatch(/Radar: on in \d+ min \(\d+ s of play\)/);
    expect(html).toMatch(/Ground: /);
    for (const action of ['walk', 'walk-mini', 'whole-field', 'plan-1', 'plan-2', 'plan-3', 'back-to-plan']) {
      expect(html, `no ${action} control`).toContain(`data-action="${action}"`);
    }
    // Nothing set by hand yet: "Back to the plan" is drawn disabled.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*<span data-action="back-to-plan"/);
    expect(html).toContain('aria-pressed="false"');
  }, 30_000);

  it('a click on the ground or the minimap walks there by hand; a point off the field does nothing', () => {
    const k = onField();
    const size = festivalView(k).royale!.size;
    const at = { x: fieldOf(k).player.x - 12, y: fieldOf(k).player.y - 12 };
    const p = isoPoint(at.x, at.y);
    const command = walkAt(p.sx, p.sy, size);
    expect(command).not.toBeNull();
    expect(k.dispatch(command!).ok).toBe(true);
    const target = fieldOf(k).player.target!;
    expect(target.x).toBeCloseTo(at.x, 6);
    expect(target.y).toBeCloseTo(at.y, 6);
    expect(festivalView(k).plan!.target).toBe(true);
    // Off the field: no command.
    const off = isoPoint(size + 10, -10);
    expect(walkAt(off.sx, off.sy, size)).toBeNull();
    // The walk is drawn: the path and the flag; "Back to the plan" is enabled.
    const html = readoutHtml(k);
    expect(html).toContain('🚩');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*<span data-action="back-to-plan"/);
  }, 30_000);

  it('the arrow keys walk three units in screen directions; any other key does nothing', () => {
    const k = onField();
    const from = { x: fieldOf(k).player.x, y: fieldOf(k).player.y };
    expect(nudgeCommand('Enter', from)).toBeNull();
    expect(k.dispatch(nudgeCommand('ArrowUp', from)!).ok).toBe(true);
    expect(fieldOf(k).player.target).toEqual({ x: from.x - 3, y: from.y - 3 });
  }, 30_000);

  it('"Back to the plan" clears the hand-set point; with none set the command is refused with a reason', () => {
    const k = onField();
    const first = k.dispatch(backToPlanCommand());
    expect(first.ok).toBe(false);
    const p = isoPoint(fieldOf(k).player.x - 5, fieldOf(k).player.y);
    expect(k.dispatch(walkAt(p.sx, p.sy, festivalView(k).royale!.size)!).ok).toBe(true);
    expect(k.dispatch(backToPlanCommand()).ok).toBe(true);
    expect(fieldOf(k).player.target).toBeUndefined();
    expect(festivalView(k).plan!.target).toBe(false);
  }, 30_000);

  it('a plan picker sets its slot; "None" clears it and the rest keep their order', () => {
    const k = onField();
    expect(festivalView(k).plan!.ids).toEqual(DEFAULT_ROYALE_PLAN);
    expect(k.dispatch(planSlotCommand(festivalView(k).plan!.ids, 0, 'keep_away')).ok).toBe(true);
    expect(slice<FestivalState>(k, 'festival').plan).toEqual(['keep_away', ...DEFAULT_ROYALE_PLAN.slice(1)]);
    expect(k.dispatch(planSlotCommand(festivalView(k).plan!.ids, 1, '')).ok).toBe(true);
    expect(festivalView(k).plan!.ids).toEqual(['keep_away', DEFAULT_ROYALE_PLAN[2]]);
    const html = readoutHtml(k);
    // Two set, one picker more to add a third.
    expect(html).toContain('data-action="plan-3"');
    expect(html).toContain(ROYALE_STRATEGIES.keep_away.desc);
  }, 30_000);
});
