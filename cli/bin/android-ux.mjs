#!/usr/bin/env node
import { runCli } from '../src/index.mjs';

const argv = process.argv.slice(2);
const isHook = argv[0] === 'hook';

try {
  const code = await runCli(argv);
  process.exitCode = isHook ? 0 : code;
} catch (err) {
  if (isHook) {
    process.stdout.write('{}\n');
    process.exitCode = 0;
  } else {
    process.stderr.write(`Fatal error: ${err?.stack || err?.message || String(err)}\n`);
    process.exitCode = 1;
  }
}
