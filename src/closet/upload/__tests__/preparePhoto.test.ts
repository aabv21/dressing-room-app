import { SaveFormat } from 'expo-image-manipulator';

import { cutOutGarment } from '../cutout';
import { preparePhoto, resizeFor } from '../preparePhoto';

type Size = { width: number; height: number };

const mockDeletedUris: string[] = [];
const mockMovedUris: string[] = [];

jest.mock('expo-file-system', () => {
  class FakeDirectory {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}/${name}`;
    }
    create(): void {
      // The uploads directory always "exists" here.
    }
  }
  class FakeFile {
    uri: string;
    name: string;
    exists = true;
    constructor(parentOrUri: string | { uri: string }, name?: string) {
      this.uri = typeof parentOrUri === 'string' ? parentOrUri : `${parentOrUri.uri}/${name ?? ''}`;
      this.name = this.uri.split('/').at(-1) ?? '';
    }
    delete(): void {
      mockDeletedUris.push(this.uri);
    }
    moveSync(destination: { uri: string }): void {
      mockMovedUris.push(`${this.uri} -> ${destination.uri}`);
    }
  }
  return { Directory: FakeDirectory, File: FakeFile, Paths: { document: { uri: 'file:///document' } } };
});

jest.mock('../cutout', () => ({ cutOutGarment: jest.fn() }));

type FakeImage = Size & {
  release: jest.Mock;
  saveAsync: jest.Mock<Promise<Size & { uri: string }>, [unknown]>;
};
type FakeContext = {
  resize: jest.Mock<FakeContext, [{ width?: number; height?: number }]>;
  renderAsync: jest.Mock<Promise<FakeImage>, []>;
  release: jest.Mock;
};
type LoadOptions = { maxWidth?: number; maxHeight?: number };

const mockManipulate = jest.fn<FakeContext, [string | FakeImage, LoadOptions | undefined]>();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: (source: string | FakeImage, options?: LoadOptions) => mockManipulate(source, options),
  },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

const cutOutMock = jest.mocked(cutOutGarment);
const manipulateMock = mockManipulate;

const saveCalls: { size: Size; options: unknown }[] = [];
const resizeCalls: unknown[] = [];
const renderedImages: FakeImage[] = [];

/** Scales `size` down to fit the load options, never up: what the native decoders do. */
function decodedSize(size: Size, options: LoadOptions | undefined): Size {
  const scale = Math.min(1, (options?.maxWidth ?? Infinity) / size.width, (options?.maxHeight ?? Infinity) / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/** A fake manipulation context: rendering reports the image's current size, `resize` scales it. */
function fakeContext(source: Size): FakeContext {
  let size = source;
  const context: FakeContext = {
    resize: jest.fn((target: { width?: number; height?: number }) => {
      resizeCalls.push(target);
      const scale = target.width !== undefined ? target.width / size.width : (target.height ?? size.height) / size.height;
      size = { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
      return context;
    }),
    renderAsync: jest.fn(() => {
      const rendered = size;
      const image: FakeImage = {
        ...rendered,
        release: jest.fn(),
        saveAsync: jest.fn((options: unknown) => {
          saveCalls.push({ size: rendered, options });
          return Promise.resolve({ uri: `file:///cache/ImageManipulator/${String(saveCalls.length)}.webp`, ...rendered });
        }),
      };
      renderedImages.push(image);
      return Promise.resolve(image);
    }),
    release: jest.fn(),
  };
  return context;
}

/**
 * The photo on disk has `size`; a URI source is decoded with the load options (unless the decoder
 * is made to ignore them), and an image source starts at that image's size.
 */
function sourceOfSize(size: Size, { ignoreLoadOptions = false } = {}): void {
  manipulateMock.mockImplementation((source, options) =>
    fakeContext(
      typeof source === 'string'
        ? ignoreLoadOptions
          ? size
          : decodedSize(size, options)
        : { width: source.width, height: source.height },
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  saveCalls.length = 0;
  resizeCalls.length = 0;
  renderedImages.length = 0;
  mockDeletedUris.length = 0;
  mockMovedUris.length = 0;
});

describe('resizeFor', () => {
  test('a landscape image shrinks by width', () => {
    expect(resizeFor(4000, 3000, 784)).toEqual({ width: 784 });
  });

  test('a portrait image shrinks by height', () => {
    expect(resizeFor(3000, 4000, 784)).toEqual({ height: 784 });
  });

  test('a smaller image is never upscaled', () => {
    expect(resizeFor(500, 300, 784)).toBeNull();
  });

  test('an image already at the target size is left alone', () => {
    expect(resizeFor(784, 784, 784)).toBeNull();
  });
});

describe('preparePhoto', () => {
  test('decodes the photo once, capped at 784 px, and builds the thumbnail from that image', async () => {
    cutOutMock.mockResolvedValue(null);
    sourceOfSize({ width: 8000, height: 6000 });

    await preparePhoto('file:///document/uploads/g-source.jpg');

    expect(manipulateMock).toHaveBeenCalledTimes(2);
    expect(manipulateMock.mock.calls[0]).toEqual(['file:///document/uploads/g-source.jpg', { maxWidth: 784, maxHeight: 784 }]);
    // The thumbnail starts from the rendered full image, never from the source file again.
    const [thumbSource, thumbOptions] = manipulateMock.mock.calls[1] ?? [];
    expect(thumbSource).toBe(renderedImages[0]);
    expect(thumbOptions).toBeUndefined();
    expect(saveCalls.map(({ size }) => size)).toEqual([
      { width: 784, height: 588 },
      { width: 256, height: 192 },
    ]);
  });

  test('uses the cut-out when there is one, and deletes it once both WebPs are saved', async () => {
    cutOutMock.mockResolvedValue('file:///cache/garment-cutout/a.png');
    sourceOfSize({ width: 2048, height: 1536 });

    await preparePhoto('file:///document/uploads/g-source.jpg');

    expect(cutOutMock).toHaveBeenCalledWith('file:///document/uploads/g-source.jpg');
    expect(manipulateMock.mock.calls[0]?.[0]).toBe('file:///cache/garment-cutout/a.png');
    expect(mockDeletedUris).toEqual(['file:///cache/garment-cutout/a.png']);
  });

  test('without a cut-out it uses the source photo and deletes nothing', async () => {
    cutOutMock.mockResolvedValue(null);
    sourceOfSize({ width: 3000, height: 4000 });

    await preparePhoto('file:///document/uploads/g-source.jpg');

    expect(manipulateMock.mock.calls[0]?.[0]).toBe('file:///document/uploads/g-source.jpg');
    expect(mockDeletedUris).toEqual([]);
  });

  test('saves the full image as WebP 0.8 at 784 px and the thumbnail as WebP 0.7 at 256 px', async () => {
    cutOutMock.mockResolvedValue(null);
    sourceOfSize({ width: 3000, height: 4000 });

    const result = await preparePhoto('file:///document/uploads/g-source.jpg');

    // The decode already fits 784, so only the thumbnail needs a resize.
    expect(resizeCalls).toEqual([{ height: 256 }]);
    expect(saveCalls).toEqual([
      { size: { width: 588, height: 784 }, options: { format: SaveFormat.WEBP, compress: 0.8 } },
      { size: { width: 192, height: 256 }, options: { format: SaveFormat.WEBP, compress: 0.7 } },
    ]);
    // Both outputs leave the purgeable cache for the uploads folder the queue item lives in.
    expect(result).toEqual({ fullUri: 'file:///document/uploads/1.webp', thumbUri: 'file:///document/uploads/2.webp' });
    expect(mockMovedUris).toEqual([
      'file:///cache/ImageManipulator/1.webp -> file:///document/uploads/1.webp',
      'file:///cache/ImageManipulator/2.webp -> file:///document/uploads/2.webp',
    ]);
  });

  test('resizeFor still guards the full image if the decoder returns it larger', async () => {
    cutOutMock.mockResolvedValue(null);
    sourceOfSize({ width: 3000, height: 4000 }, { ignoreLoadOptions: true });

    await preparePhoto('file:///document/uploads/g-source.jpg');

    expect(resizeCalls).toEqual([{ height: 784 }, { height: 256 }]);
    expect(saveCalls.map(({ size }) => size)).toEqual([
      { width: 588, height: 784 },
      { width: 192, height: 256 },
    ]);
    // The thumbnail comes from the resized full image (the second render), not the oversized decode.
    expect(manipulateMock.mock.calls[1]?.[0]).toBe(renderedImages[1]);
  });

  test('a small photo is encoded without resizing', async () => {
    cutOutMock.mockResolvedValue(null);
    sourceOfSize({ width: 200, height: 120 });

    await preparePhoto('file:///document/uploads/g-source.jpg');

    expect(resizeCalls).toEqual([]);
    expect(saveCalls.map(({ size }) => size)).toEqual([
      { width: 200, height: 120 },
      { width: 200, height: 120 },
    ]);
  });

  test('releases every native context and image', async () => {
    cutOutMock.mockResolvedValue(null);
    const contexts: FakeContext[] = [];
    manipulateMock.mockImplementation((source, options) => {
      const context = fakeContext(typeof source === 'string' ? decodedSize({ width: 3000, height: 4000 }, options) : source);
      contexts.push(context);
      return context;
    });

    await preparePhoto('file:///document/uploads/g-source.jpg');

    expect(contexts).toHaveLength(2);
    for (const context of contexts) expect(context.release).toHaveBeenCalledTimes(1);
    expect(renderedImages.length).toBeGreaterThan(0);
    for (const image of renderedImages) expect(image.release).toHaveBeenCalledTimes(1);
  });

  test('when the thumbnail fails, the saved full image and the cut-out are deleted and the error propagates', async () => {
    cutOutMock.mockResolvedValue('file:///cache/garment-cutout/a.png');
    sourceOfSize({ width: 2048, height: 1536 });
    let call = 0;
    const realImpl = manipulateMock.getMockImplementation();
    manipulateMock.mockImplementation((source, options) => {
      call += 1;
      if (call === 2) throw new Error('decode failed');
      if (realImpl === undefined) throw new Error('missing implementation');
      return realImpl(source, options);
    });

    await expect(preparePhoto('file:///document/uploads/g-source.jpg')).rejects.toThrow('decode failed');

    expect(mockDeletedUris).toEqual(['file:///document/uploads/1.webp', 'file:///cache/garment-cutout/a.png']);
  });
});
