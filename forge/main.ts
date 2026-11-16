// The forge page. Served by the dev server at /forge/. It is not a build
// input, so a release build does not contain it.
import { mount } from 'svelte';
import { initTheme } from '../src/ui/theme.svelte';
import '../src/ui/tokens.css';
import Forge from './Forge.svelte';

initTheme();
mount(Forge, { target: document.getElementById('app')! });
