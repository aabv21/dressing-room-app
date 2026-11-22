// Mapped over `expo-file-system` for the `integration` project (no native runtime): tests upload through
// `uploadGarmentPhotoBytes`, so constructing a `File` means a test took the wrong path.

export function File(): never {
  throw new Error(
    'integration/expo-file-system.stub.ts: `File` was constructed — integration tests should call ' +
      '`uploadGarmentPhotoBytes` with bytes instead of reading a file through expo-file-system.',
  );
}
