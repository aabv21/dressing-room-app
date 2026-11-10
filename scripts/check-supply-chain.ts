// scripts/check-supply-chain.ts
//
// Fails when pnpm-workspace.yaml loses the supply-chain settings CI can't otherwise see:
// `pnpm install --frozen-lockfile` installs exactly what the lockfile says and does not re-check
// trust evidence or release age, so a weakened policy (or a trust exception) would pass CI silently.
//
// Usage:
//   node scripts/check-supply-chain.ts

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKSPACE_FILE_PATH = fileURLToPath(new URL('../pnpm-workspace.yaml', import.meta.url));

/** Top-level `key: value` lines of a YAML file, with trailing comments dropped. */
function topLevelValues(yaml: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of yaml.split('\n')) {
    const match = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      values.set(match[1], (match[2] ?? '').replace(/\s+#.*$/, '').trim());
    }
  }
  return values;
}

/** Every way `yaml` (a pnpm-workspace.yaml) falls short of the repo's policy; empty when it passes. */
export function supplyChainProblems(yaml: string): string[] {
  const values = topLevelValues(yaml);
  const problems: string[] = [];
  if (values.get('trustPolicy') !== 'no-downgrade') {
    problems.push('trustPolicy must be no-downgrade');
  }
  const minimumReleaseAge = Number(values.get('minimumReleaseAge') ?? '');
  if (!Number.isFinite(minimumReleaseAge) || minimumReleaseAge <= 0) {
    problems.push('minimumReleaseAge must be set to a positive number of minutes');
  }
  if (values.has('trustPolicyExclude')) {
    problems.push('trustPolicyExclude must not be present');
  }
  return problems;
}

async function main(): Promise<void> {
  // A fixed path to the repo's own config, never user input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const problems = supplyChainProblems(await readFile(WORKSPACE_FILE_PATH, 'utf8'));
  if (problems.length > 0) {
    console.error(`pnpm-workspace.yaml: ${problems.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('pnpm-workspace.yaml: supply-chain settings OK');
}

/** True when `moduleUrl` is the script Node was started with (`process.argv[1]`). */
function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main();
}
