import type { Component } from 'svelte';

/** What a system's panel.ts default-exports. */
export interface PanelDef {
  /** The system the panel belongs to. Equals the folder name. */
  systemId: string;
  /** Shown in the navigation. */
  title: string;
  component: Component;
  /** Position in the navigation: lower comes first. Default 0. */
  order?: number;
  /** Whether the navigation lists it now, from the published view. Default: always. */
  shown?: (view: Readonly<Record<string, unknown>>) => boolean;
}

/**
 * What a system's overlay.ts default-exports: a component the shell mounts on
 * every view. `banner` sits above the panel and takes space while it shows;
 * `modal` covers the page. The component reads the view and decides when it
 * shows.
 */
export interface OverlayDef {
  /** The system the overlay belongs to. Equals the folder name. */
  systemId: string;
  place: 'banner' | 'modal';
  component: Component;
}
