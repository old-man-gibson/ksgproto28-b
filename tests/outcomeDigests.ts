/**
 * Outcome digests recorded with `scripts/budget-runs.ts`. First recorded on
 * `main` at 7b59ba1, before the catch-up work (docs/KERNEL.md decision 32);
 * recorded again on branch `step3-martial` after the martial port (new
 * slices and fields: every state hash; the floor 2 tutor: every John
 * climb), and on branch `step3-arcane` after the arcane port (the
 * spellcraft slice field `utilityReady`: every state hash, nothing else).
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
    'state': 'ecdc2e59'
  },
  'poison': {
    'tick': 288000,
    'rng': 250718473,
    'kills': 0,
    'defeats': 0,
    'level': 1,
    'gold': 0,
    'state': 'd2dbd5ac'
  },
  'floor1': {
    'tick': 288000,
    'rng': 1256549792,
    'kills': 9673,
    'defeats': 0,
    'level': 9,
    'gold': 33028,
    'state': '63dd1853'
  },
  'floor6': {
    'tick': 288000,
    'rng': 82601846,
    'kills': 11328,
    'defeats': 1,
    'level': 26,
    'gold': 1587917,
    'state': '3c2c496d'
  },
  'world4': {
    'tick': 288000,
    'rng': 3414344434,
    'kills': 9834,
    'defeats': 4,
    'level': 17,
    'gold': 350792,
    'state': '5d425fee'
  },
  'world6': {
    'tick': 288000,
    'rng': 3012075105,
    'kills': 11360,
    'defeats': 1,
    'level': 26,
    'gold': 1590950,
    'state': 'e155e6f7'
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
      'descent': 6970,
      'floor3': 7461,
      'floor4': 11658,
      'gate5': 11698,
      'floor5': 12365,
      'gate6': 14814,
      'floor6': 15037
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 12,
      'gate5': 0,
      'floor5': 1,
      'gate6': 6,
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
      'vermin': 13,
      'floor1': 186,
      'floor2': 474,
      'gate3': 611,
      'descent': 722,
      'floor3': 870,
      'floor4': 3458,
      'gate5': 3458,
      'floor5': 5246,
      'gate6': 7224,
      'floor6': 13216
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
      'floor5': 2,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 84,
    'goldEarned': 13216,
    'harvest': 11,
    'end': {
      'tick': 15085,
      'rng': 3165442549,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '5b58f6ca'
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
      'floor4': 11730,
      'gate5': 11770,
      'floor5': 12430,
      'gate6': 14677,
      'floor6': 15019
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 0,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 15,
      'gate5': 0,
      'floor5': 1,
      'gate6': 5,
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
      'vermin': 19,
      'floor1': 219,
      'floor2': 473,
      'gate3': 610,
      'descent': 699,
      'floor3': 788,
      'floor4': 3698,
      'gate5': 3698,
      'floor5': 5138,
      'gate6': 7277,
      'floor6': 12200
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
      'floor6': 2
    },
    'fights': 85,
    'goldEarned': 12200,
    'harvest': 11,
    'end': {
      'tick': 15043,
      'rng': 4286078930,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '964184ba'
    }
  },
  '1234': {
    'done': {
      'tutorial': 0,
      'vermin': 633,
      'floor1': 2712,
      'floor2': 4091,
      'gate3': 6974,
      'descent': 7678,
      'floor3': 8167,
      'floor4': 12189,
      'gate5': 12229,
      'floor5': 12643,
      'gate6': 15128,
      'floor6': 15318
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 11,
      'gate5': 0,
      'floor5': 0,
      'gate6': 7,
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
      'vermin': 18,
      'floor1': 204,
      'floor2': 430,
      'gate3': 616,
      'descent': 699,
      'floor3': 793,
      'floor4': 3601,
      'gate5': 3601,
      'floor5': 5909,
      'gate6': 8103,
      'floor6': 11924
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 3,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 1,
      'gate5': 0,
      'floor5': 1,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 91,
    'goldEarned': 11924,
    'harvest': 11,
    'end': {
      'tick': 15347,
      'rng': 4173350328,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '572df9cb'
    }
  }
};
