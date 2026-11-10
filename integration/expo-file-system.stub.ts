// integration/expo-file-system.stub.ts
//
// Stands in for `expo-file-system` under the `integration` Jest project (see jest.config.ts's
// `moduleNameMapper`): `src/closet/garmentRepository.ts` imports `File` for
// `uploadGarmentPhoto`, and the real module needs Expo's native runtime, which plain Node lacks.
// Integration tests upload through `uploadGarmentPhotoBytes` instead (the unit tests cover the
// file read), so constructing a `File` here means a test took the wrong path: fail loudly.

export function File(): never {
  throw new Error(
    'integration/expo-file-system.stub.ts: `File` was constructed — integration tests should call ' +
      '`uploadGarmentPhotoBytes` with bytes instead of reading a file through expo-file-system.',
  );
}
