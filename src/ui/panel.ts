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
}
