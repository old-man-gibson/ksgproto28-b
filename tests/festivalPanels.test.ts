/**
 * The festival's two panels, rendered on the server (`svelte/server`) with
 * the game's views, as `tests/harbor.test.ts` renders the sea's readout.
 * Every control is found in the page and the command its action carries is
 * sent; the case checks what the command did.
 *
 * - `FestivalReadout.svelte` (the Location panel): no control in step 4
 *   port C4. The old panel's "Enter the royale now" climbs to floor 16,
 *   which comes with port C5.
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
import { DARK_FLOOR, type FestivalState, type FestivalView, type StashAction } from '../src/systems/festival';
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
    // No control in this port.
    expect(hub).not.toContain('<button');
  });
});
