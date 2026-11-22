/** @jest-environment node */
// The camera and photo-library usage strings App Review reads: they name both uses ("Should I buy
// it?" compares a piece with the closet too), and app.json's plugin strings match locales/en.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Fixed files inside this repo.
const readJson = (path: string): unknown => JSON.parse(readFileSync(`${root}${path}`, 'utf8')) as unknown;

type Locale = { ios: { NSCameraUsageDescription: string; NSPhotoLibraryUsageDescription: string } };
type Plugin = string | [string, { cameraPermission?: string; photosPermission?: string }];
type AppJson = { expo: { plugins: Plugin[] } };

const en = readJson('locales/en.json') as Locale;
const es = readJson('locales/es.json') as Locale;

function pluginOptions(name: string): { cameraPermission?: string; photosPermission?: string } {
  const plugin = (readJson('app.json') as AppJson).expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === name);
  return Array.isArray(plugin) ? plugin[1] : {};
}

test('the camera and photo strings cover the closet and comparing a piece with it, in both languages', () => {
  for (const text of [en.ios.NSCameraUsageDescription, en.ios.NSPhotoLibraryUsageDescription]) {
    expect(text).toMatch(/closet/);
    expect(text).toMatch(/compare a piece/);
  }
  for (const text of [es.ios.NSCameraUsageDescription, es.ios.NSPhotoLibraryUsageDescription]) {
    expect(text).toMatch(/clóset/);
    expect(text).toMatch(/comparar una prenda/);
  }
});

test("app.json's plugin strings are locales/en.json's", () => {
  expect(pluginOptions('expo-camera').cameraPermission).toBe(en.ios.NSCameraUsageDescription);
  expect(pluginOptions('expo-image-picker').photosPermission).toBe(en.ios.NSPhotoLibraryUsageDescription);
});
