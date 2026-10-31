import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_NAME, PACKAGE_VERSION, STANDARDS_VERSION, SCHEMA_VERSION } from './version.mjs';
import { createJsonEnvelope } from './diagnostics.mjs';
import { scanKotlinSource, tokenizeKotlin } from './scanner/kotlin-scanner.mjs';
import { parseMotionMd, findMotionMdForTarget } from './scanner/motion-md.mjs';
import { analyzeLottieJson } from './scanner/lottie-scanner.mjs';
import { MOTION_RULE_CATALOG, MOTION_RULE_BY_ID } from './domains/motion/catalog.mjs';
import { runMotionDomainChecks } from './domains/motion/rules.mjs';
import { runStaticScan, runDetectCommand } from './commands/detect.mjs';
import { runContextCommand, gatherProjectContext, detectActiveHookMode } from './commands/context.mjs';
import { runIgnoresCommand, pruneStaleWaivers } from './commands/ignores.mjs';
import { runTraceCommand, parseRfc4180Csv, analyzeTraceWithRunner, compareTraceSummaries, roundHalfEvenFixed, isPythonPerfettoWrapper, resolveTraceProcessor } from './commands/trace.mjs';
import { runDoctorCommand, runDoctorChecks, detectHostProfile } from './commands/doctor.mjs';
import { runHookCommand, executeHookPayload, normalizeHookPayload } from './commands/hook.mjs';
import { runHooksCommand } from './commands/hooks.mjs';
import { runInstallCommand } from './commands/install.mjs';

export {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  STANDARDS_VERSION,
  SCHEMA_VERSION,
  scanKotlinSource,
  tokenizeKotlin,
  parseMotionMd,
  findMotionMdForTarget,
  analyzeLottieJson,
  MOTION_RULE_CATALOG,
  MOTION_RULE_BY_ID,
  runMotionDomainChecks,
  runStaticScan,
  runDetectCommand,
  runContextCommand,
  gatherProjectContext,
  detectActiveHookMode,
  runIgnoresCommand,
  pruneStaleWaivers,
  runTraceCommand,
  parseRfc4180Csv,
  analyzeTraceWithRunner,
  compareTraceSummaries,
  roundHalfEvenFixed,
  isPythonPerfettoWrapper,
  resolveTraceProcessor,
  runDoctorCommand,
  runDoctorChecks,
  detectHostProfile,
  runHookCommand,
  executeHookPayload,
  normalizeHookPayload,
  runHooksCommand,
  runInstallCommand,
};

const ROOT_USAGE = `android-ux v${PACKAGE_VERSION} (standards ${STANDARDS_VERSION})

Deterministic CLI spine and multi-domain UX rule runner for Android & Jetpack Compose.

Usage:
  android-ux <command> [options]
  android-ux [paths...]           (shorthand for \`android-ux detect [paths...]\`)

Commands:
  doctor    Diagnose OS/arch, Node/hook PATH, android CLI, adb, Perfetto, media tools & waiver health
  context   Read-only session bootstrap (MOTION.md contract, epistemic Gradle/Compose facts, --signals)
  detect    Run static UX checks on .kt, Lottie .json, and MOTION.md (separates findings vs candidates)
  ignores   Manage narrow, auditable waivers in .android-ux/config*.json (list, add, remove, prune)
  trace     Analyze Perfetto .perfetto-trace files (UI thread, RenderThread, FrameTimeline, --compare)
  install   Install/update skills and non-blocking hooks across Claude, Codex, Cursor, Copilot & Jetski
  hooks     Inspect or toggle non-blocking context hooks (status, on, off, reset)
  hook      Internal stdin->stdout JSON harness hook handler (always exits 0)

Global options:
  --version, -v   Print package and standards version
  --help, -h      Show help (pass after a command for command-specific options)
`;

const DETECT_SHORTHAND_FLAGS = new Set([
  '--scope',
  '--stats',
  '--draft',
  '--base',
  '--fail-on',
  '--list-rules',
  '--format',
  '--github',
  '--quiet',
  '-q',
  '--no-advisory',
  '--no-config',
  '--no-inline-ignores',
  '--report-unused-ignores',
]);

export async function runCli(argv = process.argv.slice(2), io = defaultIo()) {
  const args = [...argv];

  if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
    io.stdout.write(ROOT_USAGE);
    return 0;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    if (args.includes('--json')) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('version'), null, 2)}\n`);
    } else {
      io.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION} (standards ${STANDARDS_VERSION})\n`);
    }
    return 0;
  }

  const first = args[0];
  switch (first) {
    case 'doctor':
      return runDoctorCommand(args, io);
    case 'context':
      return runContextCommand(args, io);
    case 'detect':
      return runDetectCommand(args, io);
    case 'ignores':
    case 'ignore':
      return runIgnoresCommand(args, io);
    case 'trace':
      return runTraceCommand(args, io);
    case 'hook':
      return runHookCommand(args, io);
    case 'hooks':
      return runHooksCommand(args, io);
    case 'install':
    case 'update':
      return runInstallCommand(args, io);
    default:
      break;
  }

  // Shorthand `npx android-ux <path>` or `npx android-ux --stats ...` -> `detect`
  const flagPrefix = first.split('=')[0];
  if (DETECT_SHORTHAND_FLAGS.has(flagPrefix)) {
    return runDetectCommand(args, io);
  }

  if (!first.startsWith('-')) {
    const resolvedCandidate = path.resolve(io.cwd, first);
    const looksLikePath =
      first === '.' ||
      first === '..' ||
      first.includes('/') ||
      first.includes('\\') ||
      /\.(kt|kts|json|md)$/i.test(first) ||
      fs.existsSync(resolvedCandidate);

    if (looksLikePath) {
      return runDetectCommand(args, io);
    }

    io.stderr.write(`Error: unknown command or non-existent path "${first}". Run \`android-ux --help\`.\n`);
    return 1;
  }

  io.stderr.write(`Error: unknown option "${first}". Run \`android-ux --help\`.\n`);
  return 1;
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
