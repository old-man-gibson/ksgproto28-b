/**
 * The activity log and the fight feed. Port of the old `systems/log.ts` and
 * of the `text()` template helper in `text/log.ts`. See README.md in this
 * folder.
 */
import { defineEvent, defineSystem, on, registry, s, TPS, type DeepReadonly, type RecordOf } from '../../kernel';
import clock from '../clock';
import logTextData from './content/log_text.json';
import { migrations } from './migrations';

// ---- types ----

export interface LogTally {
  label: string;
  qty: number;
  /** `count` reads "Herb x4"; `amount` reads "12 gold". Default `count`. */
  style?: 'count' | 'amount';
}

export interface LogEntry {
  msg: string;
  kind: string;
  /** Clock tick of the latest contribution. */
  t: number;
  group?: string;
  prefix?: string;
  tally?: LogTally[];
  /** Clock tick the line opened on. Written with `window`. */
  since?: number;
  /** Ticks the line stays open. Absent: no time limit. */
  window?: number;
}

export interface DamageSlice {
  type: string;
  source: string;
  raw: number;
  armor: number;
  resisted: number;
  resistance: number;
  pierced: number;
  warded?: number;
  dealt: number;
}

export interface DamageStep {
  label: string;
  value?: number;
  mult?: number;
}

export interface DamageReport {
  label: string;
  target: string;
  steps: DamageStep[];
  slices: DamageSlice[];
  hits: number;
  crit: boolean;
  incoming?: boolean;
  total: number;
}

export interface FeedAffliction {
  prefix: string;
  tally: LogTally[];
  report?: DamageReport;
}

export interface FloatingAffliction extends FeedAffliction {
  group: string;
  ids: string[];
}

export interface FeedEntry {
  text: string;
  damage?: DamageReport;
  afflictions?: FeedAffliction[];
  group?: string;
  prefix?: string;
  tally?: LogTally[];
}

export interface LogState {
  log: LogEntry[];
  combatFeed: FeedEntry[];
  floatingFeed: FloatingAffliction[];
  /**
   * The open fight's own record of the feed, or null when none is open. The
   * old build kept it on the fight ledger (`state.fight.transcript`).
   */
  transcript: FeedEntry[] | null;
}

// ---- text templates ----

/** Schema of a text registry. A system that logs declares one with this. */
export const textSchema = s.object({
  id: s.id(),
  text: s.string({ label: 'Template', help: 'Placeholders are written {name}.' }),
});

const logText = registry(textSchema, logTextData, 'Log text');
export type TextRecord = RecordOf<typeof logText>;

/**
 * Fill `{name}` placeholders. A placeholder the caller does not supply stays
 * as written, so a template that names something the code never passes shows
 * in the log.
 */
export function fillText(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/** The placeholder names a template mentions. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
}

const TEXT = Object.fromEntries((logTextData as TextRecord[]).map((r) => [r.id, r.text]));

// ---- limits ----

/** Lines the activity log keeps. */
export const LOG_MAX = 60;
/** Lines the fight feed keeps. */
export const FEED_MAX = 40;
/** Folded lines a fight keeps for its transcript. Must stay above FEED_MAX. */
export const TRANSCRIPT_MAX = 60;

/** The group of the hunt line: kills, their gold and their material drops. */
export const HUNT_GROUP = 'hunt';
/** How long a hunt line stays open: 30 s of game time, in ticks. */
export const HUNT_WINDOW = 30 * TPS;
/** Groups whose line closes after a span of game time. */
const LOG_WINDOWS: Record<string, number> = { [HUNT_GROUP]: HUNT_WINDOW };
/** Labels a time-boxed line shows before "+N more". */
export const LOG_LABELS_MAX = 4;

// ---- rendering ----

/** Rounded for display only. A running total accumulates at full precision. */
function renderTally(t: DeepReadonly<LogTally>): string {
  const qty = Math.round(t.qty);
  if (t.style === 'amount') return `${qty} ${t.label}`;
  return qty > 1 ? `${t.label} ×${qty}` : t.label;
}

/**
 * "Crafted Iron Ingot x12" or "Gathered: Herb x4, Hardwood x2". With `max`, a
 * tally longer than that shows its first `max` labels and "+N more".
 */
export function renderLine(prefix: string, tally: readonly DeepReadonly<LogTally>[], max?: number): string {
  const cut = max !== undefined && tally.length > max;
  const parts = (cut ? tally.slice(0, max) : tally).map(renderTally);
  if (cut) parts.push(fillText(TEXT.common_more, { count: tally.length - max }));
  return `${prefix} ${parts.join(', ')}`.trim();
}

/** The labels a time-boxed line cuts off, as they read in the line. */
export function hiddenLabels(line: DeepReadonly<LogEntry>): string[] {
  if (line.window === undefined || !line.tally) return [];
  return line.tally.slice(LOG_LABELS_MAX).map(renderTally);
}

/** Whether `line` takes events at tick `t`. A line without a window never closes. */
function open(line: LogEntry, t: number): boolean {
  return line.window === undefined || t - (line.since ?? line.t) < line.window;
}

/** Re-read a line from its tally. A time-boxed line sorts gold first, then counts from largest down. */
function rewrite(line: LogEntry): void {
  if (line.prefix === undefined || !line.tally) return;
  if (line.window === undefined) {
    line.msg = renderLine(line.prefix, line.tally);
    return;
  }
  line.tally.sort((a, b) => Number(b.style === 'amount') - Number(a.style === 'amount') || b.qty - a.qty);
  line.msg = renderLine(line.prefix, line.tally, LOG_LABELS_MAX);
}

// ---- the activity log ----

/**
 * Append a line, folding a repeat into the one above it. Only the newest
 * entry can absorb a repeat. A group in `LOG_WINDOWS` also closes its line
 * after a span of game time.
 */
export function appendLog(state: LogState, entry: LogEntry): void {
  const last = state.log[state.log.length - 1];
  if (entry.group && last?.group === entry.group && last.prefix !== undefined && last.tally && open(last, entry.t)) {
    for (const add of entry.tally ?? []) {
      const seen = last.tally.find((t) => t.label === add.label);
      if (seen) seen.qty += add.qty;
      else last.tally.push({ ...add });
    }
    rewrite(last);
    last.t = entry.t; // the line is as recent as its latest contribution
    return;
  }
  const window = entry.window ?? (entry.group ? LOG_WINDOWS[entry.group] : undefined);
  // The line owns its tally: later events fold into it.
  const line: LogEntry = {
    ...entry,
    ...(entry.tally ? { tally: entry.tally.map((t) => ({ ...t })) } : {}),
    ...(window !== undefined ? { window, since: entry.t } : {}),
  };
  if (window !== undefined) rewrite(line);
  state.log.push(line);
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
}

/** Payload of one log line. `kind` defaults to `info`. */
export interface LogLinePayload {
  msg: string;
  kind?: string;
  group?: string;
  prefix?: string;
  tally?: LogTally[];
}

/** Request: append a line to the activity log. */
export const logLine = defineEvent<LogLinePayload>('log/line');

/** The payload of a groupable line. Consecutive lines sharing `group` fold into one tally. */
export function repeatLine(opts: { group: string; prefix: string; tally: LogTally[]; kind?: string }): LogLinePayload {
  return {
    msg: renderLine(opts.prefix, opts.tally),
    kind: opts.kind,
    group: opts.group,
    prefix: opts.prefix,
    tally: opts.tally,
  };
}

/** The payload of one hunt event (a kill, its gold, a material drop). */
export function huntLine(tally: LogTally[]): LogLinePayload {
  return repeatLine({ group: HUNT_GROUP, prefix: TEXT.combat_hunt, tally, kind: 'combat' });
}

// ---- the fight feed ----

/** A report that shares nothing with the one it came from. Each feed list folds its own copy. */
function cloneReport(r: DamageReport): DamageReport {
  return { ...r, steps: r.steps.map((s) => ({ ...s })), slices: r.slices.map((s) => ({ ...s })) };
}

/**
 * Two reports of one running line, added up. Slices accumulate; steps are
 * replaced by the newest. Rates (`resistance`, `pierced`) are taken from the
 * newest slice.
 */
function mergeReport(prev: DamageReport | undefined, next: DamageReport): DamageReport {
  if (!prev) return cloneReport(next);
  const slices = prev.slices.map((s) => ({ ...s }));
  for (const add of next.slices) {
    const seen = slices.find((s) => s.type === add.type && s.source === add.source);
    if (!seen) {
      slices.push({ ...add });
      continue;
    }
    seen.raw += add.raw;
    seen.armor += add.armor;
    seen.resisted += add.resisted;
    seen.dealt += add.dealt;
    if (seen.warded !== undefined || add.warded !== undefined) {
      seen.warded = (seen.warded ?? 0) + (add.warded ?? 0);
    }
    seen.resistance = add.resistance;
    seen.pierced = add.pierced;
  }
  return {
    ...next,
    steps: next.steps.map((s) => ({ ...s })),
    slices,
    hits: prev.hits + next.hits,
    crit: prev.crit || next.crit,
    total: prev.total + next.total,
  };
}

/** Append into one feed list, folding a repeat into the newest entry. */
function fold(list: FeedEntry[], entry: FeedEntry, max: number): void {
  const last = list[list.length - 1];
  if (entry.group && last?.group === entry.group && last.prefix !== undefined && last.tally) {
    for (const add of entry.tally ?? []) {
      const seen = last.tally.find((t) => t.label === add.label);
      if (seen) seen.qty += add.qty;
      else last.tally.push({ ...add });
    }
    last.text = renderLine(last.prefix, last.tally);
    if (entry.damage) last.damage = mergeReport(last.damage, entry.damage);
    return;
  }
  // Each list owns its copy: the two fold independently and trim at different depths.
  list.push({
    ...entry,
    ...(entry.tally ? { tally: entry.tally.map((t) => ({ ...t })) } : {}),
    ...(entry.damage ? { damage: cloneReport(entry.damage) } : {}),
  });
  if (list.length > max) list.splice(0, list.length - max);
}

/** The one door a fight line goes through: the live feed and the open transcript. */
export function appendFeed(state: LogState, entry: FeedEntry): void {
  fold(state.combatFeed, entry, FEED_MAX);
  if (state.transcript) fold(state.transcript, entry, TRANSCRIPT_MAX);
}

/** The fight feed's version of a groupable line. */
export function feedRepeat(
  state: LogState,
  opts: { group: string; prefix: string; tally: LogTally[]; damage?: DamageReport },
): void {
  appendFeed(state, {
    text: renderLine(opts.prefix, opts.tally),
    group: opts.group,
    prefix: opts.prefix,
    // Copied: the caller rebuilds its tally every tick.
    tally: opts.tally.map((t) => ({ ...t })),
    ...(opts.damage ? { damage: opts.damage } : {}),
  });
}

/**
 * An affliction run is not a line. It accumulates here, is drawn against the
 * newest line, and settles onto that line when it ends.
 */
export function feedFloating(
  state: LogState,
  opts: { group: string; prefix: string; tally: LogTally[]; ids: string[]; damage?: DamageReport },
): void {
  let run = state.floatingFeed.find((f) => f.group === opts.group);
  if (!run) {
    run = { group: opts.group, prefix: opts.prefix, tally: [], ids: [] };
    state.floatingFeed.push(run);
  }
  for (const add of opts.tally) {
    const seen = run.tally.find((t) => t.label === add.label);
    if (seen) seen.qty += add.qty;
    else run.tally.push({ ...add });
  }
  for (const id of opts.ids) if (!run.ids.includes(id)) run.ids.push(id);
  if (opts.damage) run.report = mergeReport(run.report, opts.damage);
}

/** The run of a group while it is still going. */
export function floatingRun(state: DeepReadonly<LogState>, group: string): DeepReadonly<FloatingAffliction> | undefined {
  return state.floatingFeed.find((f) => f.group === group);
}

function stick(list: FeedEntry[], run: FloatingAffliction): void {
  const last = list[list.length - 1];
  if (!last) return;
  if (!last.afflictions) last.afflictions = [];
  last.afflictions.push({
    prefix: run.prefix,
    tally: run.tally.map((t) => ({ ...t })),
    ...(run.report ? { report: cloneReport(run.report) } : {}),
  });
}

/**
 * The run is over. Its total goes onto the newest line in each list. Returns
 * false when no run of that group was open.
 */
export function settleFloating(state: LogState, group: string): boolean {
  const at = state.floatingFeed.findIndex((f) => f.group === group);
  if (at < 0) return false;
  const [run] = state.floatingFeed.splice(at, 1);
  if (!run.tally.length) return true;
  // Nothing to stick to: the run becomes a line of its own.
  if (!state.combatFeed.length) {
    appendFeed(state, { text: renderLine(run.prefix, run.tally) });
    return true;
  }
  stick(state.combatFeed, run);
  if (state.transcript) stick(state.transcript, run);
  return true;
}

/** A transcript with its damage reports removed, for a save. */
export function transcriptForSave(entries: readonly DeepReadonly<FeedEntry>[]): FeedEntry[] {
  return entries.map((e) => {
    const { damage: _dropped, ...rest } = e as FeedEntry;
    if (!e.afflictions?.length) return rest;
    return {
      ...rest,
      afflictions: (e.afflictions as FeedAffliction[]).map(({ report: _r, ...run }) => run),
    };
  });
}

/** Request: append a line to the fight feed. */
export const feedLine = defineEvent<FeedEntry>('log/feed');
/** Request: append a groupable line to the fight feed. */
export const feedRepeatLine = defineEvent<{ group: string; prefix: string; tally: LogTally[]; damage?: DamageReport }>(
  'log/feed-repeat',
);
/** Request: add to a floating affliction run. */
export const feedFloatingRun = defineEvent<{
  group: string;
  prefix: string;
  tally: LogTally[];
  ids: string[];
  damage?: DamageReport;
}>('log/feed-floating');
/** Request: end a floating run and put its total on the newest line. */
export const feedSettle = defineEvent<{ group: string }>('log/feed-settle');
/** Request: open the transcript of a fight. Any open transcript is replaced. */
export const transcriptOpen = defineEvent<void>('log/transcript-open');
/** Request: close the open transcript. The fight record copies it before asking. */
export const transcriptClose = defineEvent<void>('log/transcript-close');

// ---- the system ----

export interface LogView {
  log: LogEntry[];
  combatFeed: FeedEntry[];
  floating: FloatingAffliction[];
}

const copy = <T>(value: DeepReadonly<T>): T => JSON.parse(JSON.stringify(value)) as T;

export default defineSystem<LogState, LogView>({
  id: 'log',
  version: 1,
  migrations,
  initial: () => ({ log: [], combatFeed: [], floatingFeed: [], transcript: null }),
  content: { log_text: logText },

  events: [
    on(logLine, (ctx, event) => {
      const ev = event.payload;
      appendLog(ctx.state, {
        msg: ev.msg,
        kind: ev.kind ?? 'info',
        t: ctx.read(clock).totalTicks,
        ...(ev.group ? { group: ev.group, prefix: ev.prefix, tally: ev.tally } : {}),
      });
    }),
    on(feedLine, (ctx, event) => appendFeed(ctx.state, event.payload)),
    on(feedRepeatLine, (ctx, event) => feedRepeat(ctx.state, event.payload)),
    on(feedFloatingRun, (ctx, event) => feedFloating(ctx.state, event.payload)),
    on(feedSettle, (ctx, event) => {
      if (!settleFloating(ctx.state, event.payload.group))
        ctx.skip('log/feed-settle', `no floating run "${event.payload.group}" is open`);
    }),
    on(transcriptOpen, (ctx) => {
      ctx.state.transcript = [];
    }),
    on(transcriptClose, (ctx) => {
      if (!ctx.state.transcript) return ctx.skip('log/transcript-close', 'no transcript is open');
      ctx.state.transcript = null;
    }),
  ],

  view: ({ state }) => ({
    log: copy<LogEntry[]>(state.log),
    combatFeed: copy<FeedEntry[]>(state.combatFeed),
    floating: copy<FloatingAffliction[]>(state.floatingFeed),
  }),
});
