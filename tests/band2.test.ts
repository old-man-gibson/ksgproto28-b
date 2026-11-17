/**
 * Port of the old `tests/band2.test.ts` (5 cases): band 2, floors 4 to 6,
 * prestige at the warchief, floor 0 behind every prestiged run.
 *
 * Nothing of it runs yet. The structure cases read the floor and spot
 * registries (`FLOORS`, `SPOTS`, `PRESTIGE_UNLOCK`), which arrive with port 6.
 * The climb cases run the John driver (`tests/john.ts` of the old
 * repository), which arrives with port 7. Each case is an `it.todo` under its
 * old `describe` and name.
 */
import { describe, it } from 'vitest';

describe('band 2 structure', () => {
  it.todo('prestige opens on the floor 6 clear: the warchief (port 6: floors and spots)');

  it.todo('floor 0 cannot be reached from the Foot, where every prestiged run starts (port 6: floors and spots)');

  it.todo('every hunt outside the three boss rooms is endless, and the gates read goblin kills (port 6: floors and spots)');
});

describe('John through band 2', () => {
  it.todo('clears floor 6 inside 45 minutes of play (port 7: the John port)');

  it.todo('knocks John down on the way, not out of the game (port 7: the John port)');
});
