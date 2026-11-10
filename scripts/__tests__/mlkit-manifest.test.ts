/** @jest-environment node */
// garment-cutout replaces the merged `com.google.mlkit.vision.DEPENDENCIES` value (expo-camera
// declares the same key), so its value must keep every model expo-camera asks for: a new one in
// an expo-camera upgrade would otherwise be dropped without a build error.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPENDENCIES = /android:name="com\.google\.mlkit\.vision\.DEPENDENCIES"[^>]*?android:value="([^"]*)"/s;

function mlkitModels(manifestPath: string): string[] {
  // Two fixed manifests inside this repo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const xml = readFileSync(manifestPath, 'utf8');
  const match = DEPENDENCIES.exec(xml);
  if (match?.[1] === undefined) throw new Error(`${manifestPath} declares no ML Kit dependencies`);
  return match[1].split(',').map((model) => model.trim());
}

test("garment-cutout's ML Kit model list keeps every model expo-camera declares", () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const ours = mlkitModels(join(root, 'modules', 'garment-cutout', 'android', 'src', 'main', 'AndroidManifest.xml'));
  const camera = mlkitModels(join(root, 'node_modules', 'expo-camera', 'android', 'src', 'main', 'AndroidManifest.xml'));

  expect(ours).toContain('subject_segment');
  expect(ours).toEqual(expect.arrayContaining(camera));
});
