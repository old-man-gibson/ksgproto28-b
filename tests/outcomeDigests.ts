/**
 * Outcome digests recorded on `main` at 7b59ba1, before the catch-up work
 * (docs/KERNEL.md decision 32), with `scripts/budget-runs.ts`. A change that
 * only makes the simulation faster leaves every one of them equal. A change
 * to a rule, a formula or content changes them; record them again then, and
 * say why in the commit.
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
    'state': '200cb504'
  },
  'poison': {
    'tick': 288000,
    'rng': 250718473,
    'kills': 0,
    'defeats': 0,
    'level': 1,
    'gold': 0,
    'state': 'e5e13f79'
  },
  'floor1': {
    'tick': 288000,
    'rng': 1256549792,
    'kills': 9673,
    'defeats': 0,
    'level': 9,
    'gold': 33028,
    'state': 'a402e646'
  },
  'floor6': {
    'tick': 288000,
    'rng': 82601846,
    'kills': 11328,
    'defeats': 1,
    'level': 26,
    'gold': 1587917,
    'state': '5587a2dc'
  },
  'world4': {
    'tick': 288000,
    'rng': 3414344434,
    'kills': 9834,
    'defeats': 4,
    'level': 17,
    'gold': 350792,
    'state': '4bcd643a'
  },
  'world6': {
    'tick': 288000,
    'rng': 3012075105,
    'kills': 11360,
    'defeats': 1,
    'level': 26,
    'gold': 1590950,
    'state': 'c8b455cf'
  }
};

export const JOHN_DIGESTS: Record<number, JohnDigest> = {
  '7': {
    'done': {
      'tutorial': 0,
      'vermin': 882,
      'floor1': 2375,
      'floor2': 3646,
      'gate3': 6090,
      'descent': 6842,
      'floor3': 7848,
      'floor4': 10880,
      'gate5': 10920,
      'floor5': 11337,
      'gate6': 13998,
      'floor6': 14330
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 1,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 3,
      'floor4': 9,
      'gate5': 0,
      'floor5': 0,
      'gate6': 7,
      'floor6': 2
    },
    'levels': {
      'tutorial': 1,
      'vermin': 1,
      'floor1': 2,
      'floor2': 3,
      'gate3': 3,
      'descent': 3,
      'floor3': 6,
      'floor4': 6,
      'gate5': 6,
      'floor5': 7,
      'gate6': 8,
      'floor6': 8
    },
    'gold': {
      'tutorial': 0,
      'vermin': 13,
      'floor1': 186,
      'floor2': 462,
      'gate3': 615,
      'descent': 724,
      'floor3': 902,
      'floor4': 2428,
      'gate5': 2428,
      'floor5': 3897,
      'gate6': 5592,
      'floor6': 8400
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 4,
      'floor4': 2,
      'gate5': 0,
      'floor5': 1,
      'gate6': 0,
      'floor6': 2
    },
    'fights': 75,
    'goldEarned': 8400,
    'harvest': 10,
    'end': {
      'tick': 14347,
      'rng': 3030898561,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '7e32c8b2'
    }
  },
  '42': {
    'done': {
      'tutorial': 0,
      'vermin': 911,
      'floor1': 1825,
      'floor2': 3322,
      'gate3': 5327,
      'descent': 6094,
      'floor3': 6593,
      'floor4': 11405,
      'gate5': 11445,
      'floor5': 12056,
      'gate6': 14129,
      'floor6': 14314
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 0,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 15,
      'gate5': 0,
      'floor5': 1,
      'gate6': 5,
      'floor6': 1
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
      'vermin': 19,
      'floor1': 219,
      'floor2': 483,
      'gate3': 604,
      'descent': 690,
      'floor3': 866,
      'floor4': 3371,
      'gate5': 3371,
      'floor5': 4825,
      'gate6': 6500,
      'floor6': 8905
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
      'floor5': 2,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 84,
    'goldEarned': 8905,
    'harvest': 10,
    'end': {
      'tick': 14318,
      'rng': 1097510086,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '651e64c6'
    }
  },
  '1234': {
    'done': {
      'tutorial': 0,
      'vermin': 633,
      'floor1': 2712,
      'floor2': 4235,
      'gate3': 6678,
      'descent': 7474,
      'floor3': 8302,
      'floor4': 11843,
      'gate5': 11883,
      'floor5': 12512,
      'gate6': 14767,
      'floor6': 15276
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 10,
      'gate5': 0,
      'floor5': 1,
      'gate6': 6,
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
      'floor2': 453,
      'gate3': 606,
      'descent': 717,
      'floor3': 895,
      'floor4': 3168,
      'gate5': 3168,
      'floor5': 4796,
      'gate6': 6848,
      'floor6': 10250
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 3,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 3,
      'floor4': 1,
      'gate5': 0,
      'floor5': 2,
      'gate6': 0,
      'floor6': 3
    },
    'fights': 77,
    'goldEarned': 10250,
    'harvest': 11,
    'end': {
      'tick': 15351,
      'rng': 3406055964,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '9c5646a0'
    }
  }
};
