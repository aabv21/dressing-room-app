// scripts/perf-fixtures.ts
//
// Generates and serves the performance fixtures used by the closet grid's fixture mode and the
// on-device scroll-performance gate: 500 distinct 256x256 transparent WebP garment thumbnails.
//
// Usage:
//   node scripts/perf-fixtures.ts generate [count=500]
//   node scripts/perf-fixtures.ts serve [port=8787]

import { createServer } from 'node:http';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type FixtureSpec = {
  hue: number;
  pattern: 'solid' | 'stripes' | 'dots';
  shape: 'tee' | 'pants' | 'dress' | 'shoe';
};

const PATTERNS = ['solid', 'stripes', 'dots'] as const;
const SHAPES = ['tee', 'pants', 'dress', 'shoe'] as const;

/** Deterministic fixture spec for a 1-based index, spread across hues via the golden angle. */
export function fixtureSpec(index: number): FixtureSpec {
  const hue = (index * 137.508) % 360;
  const pattern = PATTERNS[index % PATTERNS.length] ?? 'solid';
  const shape = SHAPES[Math.floor(index / 3) % SHAPES.length] ?? 'tee';
  return { hue, pattern, shape };
}

/** Zero-padded, 1-based fixture file name, e.g. `fixtureFileName(1)` -> `0001.webp`. */
export function fixtureFileName(index: number): string {
  return `${String(index).padStart(4, '0')}.webp`;
}

// `restrict-template-expressions` flags bare numbers in template literals (it wants an explicit
// string conversion at each interpolation site); `n` centralizes that conversion so the path and
// pattern builders below read as plain arithmetic instead of a wall of `String(...)` calls.
function n(value: number): string {
  return String(value);
}

const SHAPE_PATHS: Record<FixtureSpec['shape'], (size: number) => string> = {
  tee: (size) => {
    const s = size;
    return `M ${n(s * 0.3)} ${n(s * 0.1)} L ${n(s * 0.1)} ${n(s * 0.3)} L ${n(s * 0.25)} ${n(s * 0.4)} L ${n(s * 0.25)} ${n(s * 0.9)} L ${n(s * 0.75)} ${n(s * 0.9)} L ${n(s * 0.75)} ${n(s * 0.4)} L ${n(s * 0.9)} ${n(s * 0.3)} L ${n(s * 0.7)} ${n(s * 0.1)} L ${n(s * 0.6)} ${n(s * 0.18)} L ${n(s * 0.4)} ${n(s * 0.18)} Z`;
  },
  pants: (size) => {
    const s = size;
    return `M ${n(s * 0.3)} ${n(s * 0.1)} L ${n(s * 0.7)} ${n(s * 0.1)} L ${n(s * 0.72)} ${n(s * 0.9)} L ${n(s * 0.55)} ${n(s * 0.9)} L ${n(s * 0.5)} ${n(s * 0.5)} L ${n(s * 0.45)} ${n(s * 0.9)} L ${n(s * 0.28)} ${n(s * 0.9)} Z`;
  },
  dress: (size) => {
    const s = size;
    return `M ${n(s * 0.38)} ${n(s * 0.1)} L ${n(s * 0.62)} ${n(s * 0.1)} L ${n(s * 0.68)} ${n(s * 0.4)} L ${n(s * 0.85)} ${n(s * 0.9)} L ${n(s * 0.15)} ${n(s * 0.9)} L ${n(s * 0.32)} ${n(s * 0.4)} Z`;
  },
  shoe: (size) => {
    const s = size;
    return `M ${n(s * 0.15)} ${n(s * 0.65)} L ${n(s * 0.45)} ${n(s * 0.65)} L ${n(s * 0.55)} ${n(s * 0.55)} L ${n(s * 0.75)} ${n(s * 0.6)} L ${n(s * 0.88)} ${n(s * 0.78)} L ${n(s * 0.88)} ${n(s * 0.85)} L ${n(s * 0.15)} ${n(s * 0.85)} Z`;
  },
};

function patternOverlay(spec: FixtureSpec, size: number): string {
  const shapePath = SHAPE_PATHS[spec.shape](size);
  const darker = `hsl(${n(spec.hue)}, 55%, 40%)`;
  if (spec.pattern === 'stripes') {
    const lines = Array.from({ length: 6 }, (_, i) => {
      const y = (size / 6) * i + size / 12;
      return `<line x1="0" y1="${n(y)}" x2="${n(size)}" y2="${n(y)}" stroke="${darker}" stroke-width="${n(size * 0.03)}" clip-path="url(#garment-clip)" />`;
    }).join('');
    return `<clipPath id="garment-clip"><path d="${shapePath}" /></clipPath>${lines}`;
  }
  if (spec.pattern === 'dots') {
    const dots: string[] = [];
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const cx = (size / 6) * col + size / 12;
        const cy = (size / 6) * row + size / 12;
        dots.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(size * 0.025)}" fill="${darker}" />`);
      }
    }
    return `<clipPath id="garment-clip"><path d="${shapePath}" /></clipPath><g clip-path="url(#garment-clip)">${dots.join('')}</g>`;
  }
  return '';
}

/** Renders an SVG garment silhouette for the given spec, with a transparent background. */
export function fixtureSvg(spec: FixtureSpec, size = 256): string {
  const shapePath = SHAPE_PATHS[spec.shape](size);
  const fill = `hsl(${n(spec.hue)}, 55%, 55%)`;
  const overlay = patternOverlay(spec, size);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(size)}" height="${n(size)}" viewBox="0 0 ${n(size)} ${n(size)}"><path d="${shapePath}" fill="${fill}" />${overlay}</svg>`;
}

/**
 * Resolves `urlPath` against `root` and returns the absolute path, or `null` if the decoded,
 * resolved path would leave `root`. This is the server's path-traversal guard.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, `.${decoded}`);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    return null;
  }
  return target;
}

const FIXTURES_DIR = '.perf-fixtures';
const FIXTURES_SUBDIR = 'perf';
const DEFAULT_COUNT = 500;
const DEFAULT_PORT = 8787;
const DEFAULT_SIZE = 256;

function repoRoot(): string {
  // scripts/perf-fixtures.ts -> repo root is one directory up.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function generate(count: number): Promise<void> {
  // Imported dynamically so the test suite and the `serve` command never load sharp's native
  // binding.
  const sharp = (await import('sharp')).default;
  const outDir = join(repoRoot(), FIXTURES_DIR, FIXTURES_SUBDIR);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repo's own `.perf-fixtures` folder, built from the repo root
  await mkdir(outDir, { recursive: true });
  for (let i = 1; i <= count; i += 1) {
    const svg = fixtureSvg(fixtureSpec(i), DEFAULT_SIZE);
    const outPath = join(outDir, fixtureFileName(i));
    await sharp(Buffer.from(svg))
      .resize(DEFAULT_SIZE, DEFAULT_SIZE)
      .webp({ quality: 80 })
      .toFile(outPath);
  }
  console.log(`Generated ${n(count)} fixtures in ${outDir}`);
}

/**
 * Every non-internal IPv4 address, labeled with its interface name. All of them are printed
 * because the first one isn't necessarily the Wi-Fi the phone is on (VPNs, bridges, Ethernet).
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): { name: string; address: string }[] {
  return Object.entries(interfaces).flatMap(([name, nets]) =>
    (nets ?? [])
      .filter((net) => net.family === 'IPv4' && !net.internal)
      .map((net) => ({ name, address: net.address })),
  );
}

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([['.webp', 'image/webp']]);

/**
 * `target` (already inside `root` by `resolveInside`) with every symlink resolved, or null when that
 * real path leaves `root`'s real path or doesn't exist: a link in the fixtures can't serve a file
 * from elsewhere.
 */
export async function realInside(root: string, target: string): Promise<string | null> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolving, not reading: the result is checked below
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    return realTarget.startsWith(realRoot + sep) ? realTarget : null;
  } catch {
    return null;
  }
}

function serve(port: number): void {
  const root = join(repoRoot(), FIXTURES_DIR);
  const server = createServer((req, res) => {
    const urlPath = req.url ?? '/';
    const withoutQuery = urlPath.split('?')[0] ?? '/';
    const target = resolveInside(root, withoutQuery);
    if (!target) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = target.slice(target.lastIndexOf('.'));
    const contentType = CONTENT_TYPES.get(ext);
    if (!contentType) {
      res.writeHead(404);
      res.end();
      return;
    }
    realInside(root, target)
      .then((real) => {
        if (real === null) throw new Error('outside the fixtures');
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- `real` is checked to be inside `.perf-fixtures` with every symlink resolved
        return readFile(real);
      })
      .then((data) => {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000',
        });
        res.end(data);
      })
      .catch(() => {
        res.writeHead(404);
        res.end();
      });
  });
  server.listen(port, () => {
    console.log(`Serving ${root} on http://127.0.0.1:${n(port)}`);
    const candidates = lanAddresses(networkInterfaces());
    if (candidates.length > 0) {
      console.log('LAN URLs (use the one on the same Wi-Fi as the phone):');
    }
    for (const { name, address } of candidates) {
      console.log(`  ${name}: http://${address}:${n(port)}`);
    }
  });
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (command === 'generate') {
    const count = arg ? Number.parseInt(arg, 10) : DEFAULT_COUNT;
    await generate(count);
    return;
  }
  if (command === 'serve') {
    const port = arg ? Number.parseInt(arg, 10) : DEFAULT_PORT;
    serve(port);
    return;
  }
  console.error('Usage: node scripts/perf-fixtures.ts <generate|serve> [arg]');
  process.exitCode = 1;
}

/** True when `moduleUrl` is the script Node was started with (`process.argv[1]`). */
export function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

// Guard the entry point so importing this module (e.g. from tests) has no side effects.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main();
}
