<script lang="ts">
  import { send, viewOf } from '../../ui/game.svelte';
  import { theme } from '../../ui/theme.svelte';
  import FestivalReadout from './FestivalReadout.svelte';
  import festival from './index';
  import { mapDataUrl, readPalette } from './mapImage';
  import { royaleMap } from './royaleMap';

  // Mounted in the Location panel (docs/KERNEL.md decision 29), where the
  // old build showed the festival's panel. The terrain images are drawn
  // here, once per seed and theme (`mapImage.ts`): reading `theme.current`
  // redraws them on a theme switch.
  const view = $derived(viewOf(festival));
  const fieldSeed = $derived(view.royale?.seed ?? null);
  const previewSeed = $derived(view.preview?.seed ?? null);
  const fieldImage = $derived.by(() => {
    void theme.current;
    return fieldSeed === null ? '' : mapDataUrl(royaleMap(fieldSeed), readPalette());
  });
  const previewImage = $derived.by(() => {
    void theme.current;
    return previewSeed === null ? '' : mapDataUrl(royaleMap(previewSeed), readPalette());
  });
</script>

<FestivalReadout
  attempt={view.attempt}
  royale={view.royale}
  preview={view.preview}
  plan={view.plan}
  enter={view.enter}
  {fieldImage}
  {previewImage}
  onSend={(command) => send(command)}
/>
