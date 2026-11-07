/** @jest-environment node */
// scripts/__tests__/check-supply-chain.test.ts
import { readFileSync } from 'node:fs';

import { supplyChainProblems } from '../check-supply-chain.ts';

const GOOD = `packages:
  - '.'
minimumReleaseAge: 4320 # minutes (3 days)
minimumReleaseAgeExclude: []
trustPolicy: no-downgrade # installs fail if trust evidence regresses
blockExoticSubdeps: true
`;

test("the repo's own pnpm-workspace.yaml passes", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the repo's own config, not user input.
  expect(supplyChainProblems(readFileSync(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8'))).toEqual([]);
});

test('a config with both settings and no exclusions passes', () => {
  expect(supplyChainProblems(GOOD)).toEqual([]);
});

test('a missing or weakened trustPolicy fails', () => {
  expect(supplyChainProblems(GOOD.replace(/^trustPolicy:.*$/m, ''))).toEqual(['trustPolicy must be no-downgrade']);
  expect(supplyChainProblems(GOOD.replace('trustPolicy: no-downgrade', 'trustPolicy: off'))).toEqual([
    'trustPolicy must be no-downgrade',
  ]);
});

test('a missing or zero minimumReleaseAge fails', () => {
  expect(supplyChainProblems(GOOD.replace(/^minimumReleaseAge:.*$/m, ''))).toEqual([
    'minimumReleaseAge must be set to a positive number of minutes',
  ]);
  expect(supplyChainProblems(GOOD.replace('minimumReleaseAge: 4320', 'minimumReleaseAge: 0'))).toEqual([
    'minimumReleaseAge must be set to a positive number of minutes',
  ]);
});

test('any trustPolicyExclude key fails, even an empty one', () => {
  expect(supplyChainProblems(`${GOOD}trustPolicyExclude:\n  - 'semver@6.3.1'\n`)).toEqual([
    'trustPolicyExclude must not be present',
  ]);
  expect(supplyChainProblems(`${GOOD}trustPolicyExclude: []\n`)).toEqual(['trustPolicyExclude must not be present']);
});
