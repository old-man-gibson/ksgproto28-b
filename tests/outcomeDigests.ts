/**
 * Outcome digests recorded with `scripts/budget-runs.ts`. First recorded on
 * `main` at 7b59ba1, before the catch-up work (docs/KERNEL.md decision 32);
 * recorded again on branch `step3-martial` after the martial port (new
 * slices and fields: every state hash; the floor 2 tutor: every John
 * climb), on branch `step3-arcane` after the arcane port (the
 * spellcraft slice field `utilityReady`: every state hash, nothing else),
 * and on branch `step3-divine` after the divine port (the new slices
 * `divine` v2 and `titles`: every state hash; titles now latch and give
 * their modifiers. Slayer, +2% damage at 100 kills, in the four fight runs:
 * the floor 6 and the two world runs change generator, kills and gold, the
 * floor 1 run its hash only. Wanderer, +5% travel speed at 50 journeys, in
 * every John climb near the third floor's gate: every John segment from
 * there on), and on branch `step3-alchemy` after the alchemy port (the new
 * slices `benches`, `alchemy` and `consumables`: every state hash, nothing
 * else; no run and no John brews or uses an item).
 * A change that only makes the simulation faster leaves every one
 * of them equal. A change to a rule, a formula or content changes them;
 * record them again then, and say why in the commit.
 */
import type { Digest, RunName } from './budgetRuns';
import type { JohnDigest } from './johnDigest';

export const RUN_DIGESTS: Record<RunName, Digest> = {
  'idle': {
    'tick': 288200,
    'rng': 1491660913,
    'kills': 0,
    'defeats': 0,
    'level': 1,
    'gold': 0,
    'state': 'd5b38528'
  },
  'poison': {
    'tick': 288000,
    'rng': 250718473,
    'kills': 0,
    'defeats': 0,
    'level': 1,
    'gold': 0,
    'state': '2bded025'
  },
  'floor1': {
    'tick': 288000,
    'rng': 1256549792,
    'kills': 9673,
    'defeats': 0,
    'level': 9,
    'gold': 33028,
    'state': '04c8f24e'
  },
  'floor6': {
    'tick': 288000,
    'rng': 504130528,
    'kills': 11347,
    'defeats': 0,
    'level': 26,
    'gold': 1581408,
    'state': '5dc8d61b'
  },
  'world4': {
    'tick': 288000,
    'rng': 2571287070,
    'kills': 9885,
    'defeats': 4,
    'level': 17,
    'gold': 356591,
    'state': '1d4a4134'
  },
  'world6': {
    'tick': 288000,
    'rng': 504130528,
    'kills': 11347,
    'defeats': 0,
    'level': 26,
    'gold': 1581409,
    'state': 'd7c80001'
  }
};

export const JOHN_DIGESTS: Record<number, JohnDigest> = {
  '7': {
    'done': {
      'tutorial': 0,
      'vermin': 882,
      'floor1': 2375,
      'floor2': 3980,
      'gate3': 6204,
      'descent': 6966,
      'floor3': 7436,
      'floor4': 13652,
      'gate5': 13690,
      'floor5': 14084,
      'gate6': 16093,
      'floor6': 16841
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 19,
      'gate5': 0,
      'floor5': 0,
      'gate6': 4,
      'floor6': 4
    },
    'levels': {
      'tutorial': 1,
      'vermin': 1,
      'floor1': 2,
      'floor2': 3,
      'gate3': 3,
      'descent': 3,
      'floor3': 5,
      'floor4': 7,
      'gate5': 7,
      'floor5': 7,
      'gate6': 8,
      'floor6': 9
    },
    'gold': {
      'tutorial': 0,
      'vermin': 13,
      'floor1': 186,
      'floor2': 474,
      'gate3': 611,
      'descent': 711,
      'floor3': 829,
      'floor4': 4132,
      'gate5': 4132,
      'floor5': 5836,
      'gate6': 7849,
      'floor6': 14124
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 2,
      'gate5': 0,
      'floor5': 1,
      'gate6': 0,
      'floor6': 5
    },
    'fights': 101,
    'goldEarned': 14124,
    'harvest': 11,
    'end': {
      'tick': 16891,
      'rng': 3309978928,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': 'f6420ff2'
    }
  },
  '42': {
    'done': {
      'tutorial': 0,
      'vermin': 911,
      'floor1': 1825,
      'floor2': 3574,
      'gate3': 5799,
      'descent': 6566,
      'floor3': 7084,
      'floor4': 10428,
      'gate5': 10466,
      'floor5': 11377,
      'gate6': 13390,
      'floor6': 13737
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 0,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 10,
      'gate5': 0,
      'floor5': 2,
      'gate6': 4,
      'floor6': 2
    },
    'levels': {
      'tutorial': 1,
      'vermin': 1,
      'floor1': 2,
      'floor2': 3,
      'gate3': 3,
      'descent': 3,
      'floor3': 5,
      'floor4': 6,
      'gate5': 6,
      'floor5': 7,
      'gate6': 8,
      'floor6': 8
    },
    'gold': {
      'tutorial': 0,
      'vermin': 19,
      'floor1': 219,
      'floor2': 473,
      'gate3': 610,
      'descent': 699,
      'floor3': 788,
      'floor4': 2555,
      'gate5': 2555,
      'floor5': 4126,
      'gate6': 5984,
      'floor6': 13357
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 1,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 1,
      'gate5': 0,
      'floor5': 3,
      'gate6': 0,
      'floor6': 2
    },
    'fights': 75,
    'goldEarned': 13357,
    'harvest': 11,
    'end': {
      'tick': 13800,
      'rng': 2899685405,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '4218e48d'
    }
  },
  '1234': {
    'done': {
      'tutorial': 0,
      'vermin': 633,
      'floor1': 2712,
      'floor2': 4091,
      'gate3': 6968,
      'descent': 7727,
      'floor3': 8805,
      'floor4': 13951,
      'gate5': 13989,
      'floor5': 14357,
      'gate6': 16248,
      'floor6': 16419
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 3,
      'floor4': 16,
      'gate5': 0,
      'floor5': 0,
      'gate6': 4,
      'floor6': 0
    },
    'levels': {
      'tutorial': 1,
      'vermin': 1,
      'floor1': 2,
      'floor2': 3,
      'gate3': 3,
      'descent': 3,
      'floor3': 5,
      'floor4': 7,
      'gate5': 7,
      'floor5': 7,
      'gate6': 8,
      'floor6': 9
    },
    'gold': {
      'tutorial': 0,
      'vermin': 18,
      'floor1': 204,
      'floor2': 430,
      'gate3': 616,
      'descent': 689,
      'floor3': 878,
      'floor4': 3852,
      'gate5': 3852,
      'floor5': 7063,
      'gate6': 8864,
      'floor6': 14601
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 3,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 4,
      'floor4': 1,
      'gate5': 0,
      'floor5': 1,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 90,
    'goldEarned': 14601,
    'harvest': 11,
    'end': {
      'tick': 16481,
      'rng': 1904188527,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '28b351c4'
    }
  }
};
