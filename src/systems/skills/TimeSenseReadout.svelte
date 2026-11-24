<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import type { TimeSenseView } from './index';

  /**
   * The clock as Chronosense reads it (the old header clock chip and its moon
   * glyphs): one line for the time, and from the season level one line per
   * moon. Before the sense manifests the player cannot read the clock. Props
   * only, so a test renders it with a view; the Character panel passes the
   * game's.
   *
   * Layout rule: fixed-height lines. The minute turning changes text, never
   * the height; the moon lines arrive once, at the season level.
   */
  interface Props {
    sense: DeepReadonly<TimeSenseView> | null;
  }

  let { sense }: Props = $props();
</script>

<p class="line time" data-testid="time-sense">
  {sense ? `Time: ${sense.text}` : 'Time: unknown until Chronosense manifests (one full day lived).'}
</p>
{#each sense?.moons ?? [] as moon (moon.text)}
  <p class="line" data-testid="time-sense-moon">{moon.icon} {moon.text}</p>
{/each}

<style>
  /* One line each at a fixed height. */
  .line {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The date-level reading is about 50 characters: two fixed lines on a phone. */
  @media (max-width: 640px) {
    .line.time {
      height: 3rem;
      white-space: normal;
    }
  }
</style>
