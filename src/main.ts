import { mount } from 'svelte';
import App from './ui/App.svelte';
import { boot } from './ui/game.svelte';
import { initTheme } from './ui/theme.svelte';
import './ui/tokens.css';

initTheme();
mount(App, { target: document.getElementById('app')! });
void boot();
