/**
 * The desert's controls, rendered on the server and their commands sent, as
 * `tests/harbor.test.ts` does for the sea's (step 4 port C7). The port adds
 * no component; it adds content the Location panel and the Quests panel's
 * people list draw: the obelisk's read, the ladder's rungs of floors 18 to
 * 20 with their ride buttons, the notice at the ladder's end, the quay's
 * forced road, and the broker's Talk.
 *
 * The Location panel reads the page's kernel through `src/ui/game.svelte`.
 * This file replaces that module with one over a kernel the test builds:
 * `viewOf` reads its view and `send` dispatches to it.
 */
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, Kernel } from '../src/kernel';
import { FLOORS } from '../src/systems/ladder';
import npcs, { NPCS, talkTo, type NpcsView } from '../src/systems/npcs';
import PeopleList from '../src/systems/npcs/PeopleList.svelte';
import LocationPanel from '../src/systems/world/LocationPanel.svelte';
import { climb, selectActivity, travelTo } from '../src/systems/world';
import { logOf } from './combatHelpers';
import { counterOf, gameAt, setCounters, worldOf } from './worldHelpers';

const page = vi.hoisted(() => ({ kernel: null as Kernel | null, sent: [] as Command[] }));

vi.mock('../src/ui/game.svelte', () => ({
  send: (command: Command) => {
    page.sent.push(command);
    return page.kernel!.dispatch(command);
  },
  viewOf: (system: { id: string }) => page.kernel!.view().systems[system.id],
  game: {
    get view() {
      return page.kernel!.view();
    },
  },
}));

beforeEach(() => {
  page.kernel = null;
  page.sent = [];
});

/** Set the counters each floor's `clear` reads. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[]): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = Math.max(counterOf(k, c.key), c.value);
  }
  setCounters(k, values);
}

const floorsUpTo = (n: number): string[] => Array.from({ length: n }, (_, i) => `ascent_f${i + 1}`);

/** A game at `spot` with floors 1 to `cleared` cleared and the desert gates met, drawn by the panel. */
function at(spot: string, cleared = 19): Kernel {
  const k = gameAt(3, spot);
  clearFloors(k, floorsUpTo(cleared));
  setCounters(k, { 'kills:tag:desert': 150 });
  page.kernel = k;
  return k;
}

const panel = (): string => render(LocationPanel).body;
/** The text of one button: the label between its tags, whitespace folded. */
const buttons = (html: string): { label: string; disabled: boolean }[] =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    label: m[2].replace(/<[^>]+>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim(),
    disabled: /\sdisabled/.test(m[1]),
  }));
const button = (html: string, label: string) => buttons(html).find((b) => b.label === label);

describe('the desert in the Location panel', () => {
  it('draws floors 18 to 20 on the ladder with their gates, and each ride button sends its climb', () => {
    const k = at('f18_well_head');
    const html = panel();
    expect(html).toContain('Floor 18: The Necropolis Road');
    expect(html).toContain('Floor 19: The Pyramid');
    expect(html).toContain('Floor 20: The Delta Port');
    // Floor 18's landing is here: its ride is drawn disabled; 19 and 20 are open.
    expect(button(html, 'Ride to floor 18')?.disabled).toBe(true);
    expect(button(html, 'Ride to floor 19')?.disabled).toBe(false);
    expect(button(html, 'Ride to floor 20')?.disabled).toBe(false);
    // The ladder stops at 20: no rung past it, and no notice while 20 is open.
    expect(html).not.toContain('Floor 21');
    // The button's command: one rung up is an ordinary climb.
    expect(k.dispatch(climb({ floor: 'ascent_f19' })).ok).toBe(true);
    expect(logOf(k).at(-1)).toContain('Climbing to');
    expect(worldOf(k).travel).not.toBeNull();
  });

  it('reads the gates of 19 and 20 in desert kills', () => {
    const k = at('f18_well_head', 18);
    setCounters(k, { 'kills:tag:desert': 42 });
    const html = panel();
    expect(html).toMatch(/Gate: [^<]*\(42 of 60\)/);
    expect(html).toMatch(/Gate: [^<]*\(42 of 150\)/);
    expect(button(html, 'Ride to floor 19')?.disabled).toBe(true);
  });

  it('says floor 21 is not in this build once floor 20 is cleared', () => {
    at('f20_quay', 20);
    expect(panel()).toContain('Floor 21: not in this build.');
  });

  it('draws the obelisk read and the rest as activities, and the read sends the explore', () => {
    const k = at('f18_first_obelisk', 17);
    const html = panel();
    expect(button(html, '📜 Read the Obelisk')?.disabled).toBe(false);
    expect(button(html, '🛏️ Rest in the Shade')?.disabled).toBe(false);
    expect(k.dispatch(selectActivity({ activity: 'explore' })).ok).toBe(true);
    k.tick(200);
    expect(counterOf(k, 'flag:chart')).toBe(1);
  });

  it('marks the roadstead as a forced road from the quay, and Go sends the travel', () => {
    const k = at('f20_quay');
    expect(panel()).toContain('data-testid="spot-f20_roadstead"');
    expect(k.dispatch(travelTo({ to: 'f20_roadstead' })).ok).toBe(true);
    expect(worldOf(k).travel?.to).toBe('f20_roadstead');
  });
});

describe('the broker in the people list', () => {
  it('stands on the quay with a line and a Talk control that sends the greeting', () => {
    const k = at('f20_quay');
    const view = () => k.view().systems[npcs.id] as NpcsView;
    const html = () => render(PeopleList, { props: { people: view().here, onTalk: () => {} } }).body;
    expect(view().here.map((n) => n.id)).toEqual(['f20_broker']);
    const broker = view().here[0];
    expect(NPCS.f20_broker.dialogue).toContain(broker.line);
    expect(html()).toContain('💰 The Broker');
    expect(html()).toContain(`Says: “${broker.line}”`);
    expect(html()).toMatch(/<button[^>]*>\s*<span data-npc="f20_broker">Talk<\/span>/);
    expect(k.dispatch(talkTo({ npc: 'f20_broker' })).ok).toBe(true);
    expect(view().here[0].met).toBe(true);
    expect(html()).toMatch(/<button[^>]*disabled[^>]*>\s*<span data-npc="f20_broker">Met<\/span>/);
  });
});
