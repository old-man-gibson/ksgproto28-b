/** The log templates of the combat system. Port of the `combat.*` and `huntrest.*` keys of the old `text/log.text.ts`. */
import { registry } from '../../kernel';
import { textSchema, type TextRecord } from '../log';
import combatTextData from './content/combat_text.json';

export const combatText = registry(textSchema, combatTextData, 'Combat text');

type Key =
  | 'knocked_out_forced'
  | 'knocked_out'
  | 'appears'
  | 'appear_group'
  | 'ambushed'
  | 'hunt_kill'
  | 'unique_slain'
  | 'keeper_slain'
  | 'spot_cleared'
  | 'weapon_dropped'
  | 'huntrest_resting'
  | 'huntrest_done'
  | 'huntrest_stuck'
  | 'fight_kept'
  | 'fight_evicted';

export const TEXT = Object.fromEntries((combatTextData as TextRecord[]).map((r) => [r.id, r.text])) as Record<Key, string>;
