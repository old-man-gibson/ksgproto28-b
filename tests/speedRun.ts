/**
 * One attempt of the speed test in its own process (docs/PERFORMANCE.md
 * section 5.2). `tests/speed.test.ts` starts it once per attempt:
 *
 *     node --expose-gc node_modules/vite-node/vite-node.mjs --config tests/speedRun.config.ts tests/speedRun.ts -- <state>
 *
 * with the state's save envelope as JSON on standard input. The old build's
 * medians were measured the same way: vite-node, one fresh process per run.
 * Prints one line, `SPEED_ATTEMPT <json>` (an `Attempt` of
 * `tests/speedCatchUp.ts`), and exits 0; on an error it prints the reason on
 * standard error and exits 1.
 */
import { attempt, ATTEMPT_MARK } from './speedCatchUp';
import { liftFloorOneLimit, SPEED_STATES, type SpeedState } from './speedStates';

async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const name = process.argv[2] as SpeedState;
  if (!SPEED_STATES.includes(name)) throw new Error(`unknown state "${process.argv[2]}"; one of ${SPEED_STATES.join(', ')}`);
  const json = await readInput();
  if (json.length === 0) throw new Error(`${name}: no save on standard input`);
  // The baseline lifted the Vermin Hall's fight limit in every measuring process. This process ends after the attempt.
  if (name === 'floor1') liftFloorOneLimit();
  console.log(ATTEMPT_MARK + JSON.stringify(attempt(json)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
