/**
 * Three test spots in the Malgeri Range region, so a test can stand under the
 * mountain sky, under a roof inside it, and in a sheltered area of it. Port
 * of the old `tests/fixtures/malgeri.ts`.
 *
 *   import { mountMalgeri } from './fixtures/malgeri';
 *   beforeAll(() => { unmount = mountMalgeri(); });
 *   afterAll(() => unmount());
 *
 * Floor 17's real spots have tables the engine tests should not depend on;
 * these give them one of known shape. The three spots share one encounter
 * table: a plain line, a line that waits on a gale or a storm, and a line
 * that waits on a calm.
 *
 * Changed: the old file assigned into the registries at import. Here the
 * mount is a function that returns its removal, as `mountSpots` does, so a
 * file mounts it for its own duration. The region is the content's
 * `malgeri_range` (step 4 port C6); before the port, the file that used the
 * mount also mounted the region.
 */
import { AREAS, type SpotDef } from '../../src/systems/world';
import { mountSpots } from '../worldHelpers';

/** Open sky: weather reaches it. */
export const RIDGE = 'test_malgeri_ridge';
/** A roof inside the same region: the `indoor` tag, so no weather. */
export const HUT = 'test_malgeri_hut';
/** An area that overrides the region to sheltered: no weather either. */
export const CAVE = 'test_malgeri_cave';

export const PLAIN = 'goblin';
export const WINDY = 'hobgoblin';
export const STILL = 'slime_king';

const table = (): NonNullable<SpotDef['encounters']> => [
  { monsterId: PLAIN, weight: 10, level: [1, 1] },
  { monsterId: WINDY, weight: 10, level: [1, 1], sky: ['gale', 'storm'] },
  { monsterId: STILL, weight: 10, level: [1, 1], sky: ['calm'] },
];

const spot = (id: string, areaId: string, tags?: string[]): SpotDef => ({
  id,
  name: id,
  icon: '⛰️',
  areaId,
  desc: 'A test spot.',
  activities: [],
  encounters: table(),
  connections: [],
  ...(tags ? { tags } : {}),
});

/** Mount the two areas and three spots; returns the function that removes them. */
export function mountMalgeri(): () => void {
  AREAS.test_malgeri_area = { id: 'test_malgeri_area', name: 'Test Malgeri', regionId: 'malgeri_range' };
  AREAS.test_malgeri_cave_area = { id: 'test_malgeri_cave_area', name: 'Test Malgeri Cave', regionId: 'malgeri_range', sheltered: true };
  const unmount = mountSpots({
    [RIDGE]: spot(RIDGE, 'test_malgeri_area'),
    [HUT]: spot(HUT, 'test_malgeri_area', ['indoor']),
    [CAVE]: spot(CAVE, 'test_malgeri_cave_area'),
  });
  return () => {
    unmount();
    delete AREAS.test_malgeri_area;
    delete AREAS.test_malgeri_cave_area;
  };
}
