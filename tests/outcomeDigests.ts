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
 * else; no run and no John brews or uses an item), and on branch
 * `step3-cooking` after the cooking port (the new slices `cooking` and
 * `meals`: every state hash, nothing else; no run and no John cooks or eats),
 * and on branch `step3-smithing` after the smithing port (the new slices
 * `smithing` and `crafting`: every state hash, nothing else; no run and no
 * John forges or smelts), and on branch `step3-mutagens` after the mutagens
 * port (the new slice `mutagens`: every state hash; the kill harvest draws
 * the generator on every kill, as the old build did: the generator, kills,
 * level and gold of the four fight runs and every John segment).
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
    'state': 'f7e66954'
  },
  'poison': {
    'tick': 288000,
    'rng': 250718473,
    'kills': 0,
    'defeats': 0,
    'level': 1,
    'gold': 0,
    'state': '50400713'
  },
  'floor1': {
    'tick': 288000,
    'rng': 3664690361,
    'kills': 9667,
    'defeats': 0,
    'level': 9,
    'gold': 33071,
    'state': '4e221add'
  },
  'floor6': {
    'tick': 288000,
    'rng': 2910183033,
    'kills': 11405,
    'defeats': 0,
    'level': 26,
    'gold': 1593017,
    'state': '37508fe6'
  },
  'world4': {
    'tick': 288000,
    'rng': 1341769031,
    'kills': 9821,
    'defeats': 5,
    'level': 17,
    'gold': 352118,
    'state': '0e30cac9'
  },
  'world6': {
    'tick': 288000,
    'rng': 2910183033,
    'kills': 11405,
    'defeats': 0,
    'level': 26,
    'gold': 1593019,
    'state': '13233dcb'
  },
};

export const JOHN_DIGESTS: Record<number, JohnDigest> = {
  '7': {
    'done': {
      'tutorial': 0,
      'vermin': 882,
      'floor1': 2352,
      'floor2': 4063,
      'gate3': 6067,
      'descent': 6814,
      'floor3': 7300,
      'floor4': 10049,
      'gate5': 10087,
      'floor5': 10724,
      'gate6': 13387,
      'floor6': 13567
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 7,
      'gate5': 0,
      'floor5': 1,
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
      'floor4': 6,
      'gate5': 6,
      'floor5': 7,
      'gate6': 8,
      'floor6': 8
    },
    'gold': {
      'tutorial': 0,
      'vermin': 16,
      'floor1': 197,
      'floor2': 482,
      'gate3': 603,
      'descent': 667,
      'floor3': 755,
      'floor4': 2709,
      'gate5': 2709,
      'floor5': 4718,
      'gate6': 6381,
      'floor6': 10482
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
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
    'fights': 78,
    'goldEarned': 10482,
    'harvest': 11,
    'end': {
      'tick': 13575,
      'rng': 3370002649,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': 'c6981786'
    }
  },
  '42': {
    'done': {
      'tutorial': 0,
      'vermin': 651,
      'floor1': 2189,
      'floor2': 3932,
      'gate3': 6156,
      'descent': 6905,
      'floor3': 7700,
      'floor4': 12121,
      'gate5': 12159,
      'floor5': 12554,
      'gate6': 15104,
      'floor6': 16062
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 14,
      'gate5': 0,
      'floor5': 0,
      'gate6': 7,
      'floor6': 5
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
      'vermin': 14,
      'floor1': 180,
      'floor2': 475,
      'gate3': 612,
      'descent': 699,
      'floor3': 877,
      'floor4': 3727,
      'gate5': 3727,
      'floor5': 5178,
      'gate6': 7273,
      'floor6': 12228
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 3,
      'floor4': 2,
      'gate5': 0,
      'floor5': 1,
      'gate6': 0,
      'floor6': 6
    },
    'fights': 85,
    'goldEarned': 12228,
    'harvest': 11,
    'end': {
      'tick': 16124,
      'rng': 1505387553,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '1686ebfd'
    }
  },
  '1234': {
    'done': {
      'tutorial': 0,
      'vermin': 651,
      'floor1': 2283,
      'floor2': 3962,
      'gate3': 6846,
      'descent': 7656,
      'floor3': 8161,
      'floor4': 11455,
      'gate5': 11493,
      'floor5': 12439,
      'gate6': 14836,
      'floor6': 15042
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 11,
      'gate5': 0,
      'floor5': 2,
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
      'floor4': 6,
      'gate5': 6,
      'floor5': 7,
      'gate6': 8,
      'floor6': 9
    },
    'gold': {
      'tutorial': 0,
      'vermin': 13,
      'floor1': 187,
      'floor2': 427,
      'gate3': 613,
      'descent': 716,
      'floor3': 841,
      'floor4': 3034,
      'gate5': 3034,
      'floor5': 5050,
      'gate6': 7217,
      'floor6': 13476
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 1,
      'gate5': 0,
      'floor5': 3,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 73,
    'goldEarned': 13476,
    'harvest': 11,
    'end': {
      'tick': 15053,
      'rng': 4060620534,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': 'e298a575'
    }
  },
};
