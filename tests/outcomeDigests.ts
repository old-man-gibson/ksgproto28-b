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
 * level and gold of the four fight runs and every John segment), and on
 * branch `step3-psionic` after the psionic port (the new slice `psionic`:
 * every state hash, nothing else; no run and no John shapes, and the
 * psionic slime stands on no spot), and on branch `step3-runecarving` after
 * the runecarving port (the new slice `runecarving`: every state hash,
 * nothing else; no run and no John carves, and the shutter is shut), and
 * on branch `step3-facet` after the Facet port (the new slice `facet`, off:
 * every state hash, nothing else; the switch is off in every run and climb),
 * and on branch `step4-L` after port L (the new slices `bestiary` and
 * `achievements`: every state hash. Each kill rolls the bestiary's open
 * facts on the generator, and claimed achievement tiers give their bonuses,
 * as the old build did: the generator, kills and gold of the floor 1, floor
 * 6 and two world runs, defeats and level of the floor 4 world run, and
 * every John segment and harvest), and on branch `step4-C1` after port C1
 * (the new slice `wards`, empty: every state hash, nothing else; no run
 * reaches band 3 and the John digest stops at the first prestige), and on
 * branch `step4-C2` after port C2 (the new slice `bonus`, whose bank fills
 * in every idle tick, and the field `stronghold` of `prestige` version 2:
 * every state hash, nothing else; no run reaches floor 11 and the John
 * digest stops at the first prestige).
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
    'state': '84c258b0'
  },
  'poison': {
    'tick': 288000,
    'rng': 250718473,
    'kills': 0,
    'defeats': 0,
    'level': 1,
    'gold': 0,
    'state': '21df3e34'
  },
  'floor1': {
    'tick': 288000,
    'rng': 715818999,
    'kills': 9677,
    'defeats': 0,
    'level': 9,
    'gold': 33649,
    'state': '06fc268e'
  },
  'floor6': {
    'tick': 288000,
    'rng': 1152550808,
    'kills': 11571,
    'defeats': 0,
    'level': 26,
    'gold': 1627909,
    'state': '875743ae'
  },
  'world4': {
    'tick': 288000,
    'rng': 3326362229,
    'kills': 10020,
    'defeats': 4,
    'level': 18,
    'gold': 362564,
    'state': '26b0137c'
  },
  'world6': {
    'tick': 288000,
    'rng': 1152550808,
    'kills': 11571,
    'defeats': 0,
    'level': 26,
    'gold': 1627911,
    'state': '60d4bc8a'
  }
};

export const JOHN_DIGESTS: Record<number, JohnDigest> = {
  '7': {
    'done': {
      'tutorial': 0,
      'vermin': 838,
      'floor1': 2149,
      'floor2': 3845,
      'gate3': 6497,
      'descent': 7276,
      'floor3': 8095,
      'floor4': 12541,
      'gate5': 12574,
      'floor5': 13173,
      'gate6': 15520,
      'floor6': 15864
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 14,
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
      'floor4': 6,
      'gate5': 6,
      'floor5': 7,
      'gate6': 8,
      'floor6': 8
    },
    'gold': {
      'tutorial': 0,
      'vermin': 20,
      'floor1': 215,
      'floor2': 433,
      'gate3': 602,
      'descent': 699,
      'floor3': 889,
      'floor4': 3012,
      'gate5': 3012,
      'floor5': 4187,
      'gate6': 6078,
      'floor6': 10877
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 3,
      'floor4': 1,
      'gate5': 0,
      'floor5': 2,
      'gate6': 0,
      'floor6': 2
    },
    'fights': 85,
    'goldEarned': 10877,
    'harvest': 16,
    'end': {
      'tick': 15884,
      'rng': 727186057,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '71834a75'
    }
  },
  '42': {
    'done': {
      'tutorial': 0,
      'vermin': 847,
      'floor1': 2394,
      'floor2': 4059,
      'gate3': 6710,
      'descent': 7412,
      'floor3': 8165,
      'floor4': 12676,
      'gate5': 12709,
      'floor5': 13570,
      'gate6': 15542,
      'floor6': 15744
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 1,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 2,
      'floor4': 14,
      'gate5': 0,
      'floor5': 2,
      'gate6': 4,
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
      'floor1': 164,
      'floor2': 436,
      'gate3': 605,
      'descent': 718,
      'floor3': 875,
      'floor4': 3606,
      'gate5': 3606,
      'floor5': 5397,
      'gate6': 7446,
      'floor6': 11827
    },
    'bossTries': {
      'tutorial': 0,
      'vermin': 0,
      'floor1': 2,
      'floor2': 0,
      'gate3': 0,
      'descent': 0,
      'floor3': 3,
      'floor4': 1,
      'gate5': 0,
      'floor5': 3,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 85,
    'goldEarned': 11827,
    'harvest': 17,
    'end': {
      'tick': 15804,
      'rng': 1133562174,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': '0cd2af51'
    }
  },
  '1234': {
    'done': {
      'tutorial': 0,
      'vermin': 887,
      'floor1': 1921,
      'floor2': 3726,
      'gate3': 6380,
      'descent': 7169,
      'floor3': 7682,
      'floor4': 13070,
      'gate5': 13103,
      'floor5': 13498,
      'gate6': 15319,
      'floor6': 15514
    },
    'knockouts': {
      'tutorial': 0,
      'vermin': 1,
      'floor1': 0,
      'floor2': 1,
      'gate3': 0,
      'descent': 0,
      'floor3': 1,
      'floor4': 17,
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
      'vermin': 14,
      'floor1': 206,
      'floor2': 440,
      'gate3': 609,
      'descent': 718,
      'floor3': 875,
      'floor4': 4472,
      'gate5': 4472,
      'floor5': 5999,
      'gate6': 7798,
      'floor6': 13628
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
      'floor5': 1,
      'gate6': 0,
      'floor6': 1
    },
    'fights': 82,
    'goldEarned': 13628,
    'harvest': 17,
    'end': {
      'tick': 15563,
      'rng': 245962908,
      'kills': 0,
      'defeats': 0,
      'level': 1,
      'gold': 0,
      'state': 'f8950b95'
    }
  }
};
