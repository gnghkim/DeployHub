import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  normalizeSnapshotUpload,
  SnapshotUploadError,
} from './snapshot-upload';

const MAX_INPUT_BYTES = 5_000_000;
const MAX_OUTPUT_BYTES = 1_500_000;

const fixtures = new Map<'png' | 'jpeg' | 'webp', Buffer>();

beforeAll(async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    fixtures.set(
      format,
      await sharp({
        create: {
          width: 64,
          height: 32,
          channels: 3,
          background: '#ef4444',
        },
      })[format]().toBuffer(),
    );
  }
});

function upload(data: Buffer, type: string, name = 'snapshot'): File {
  const bytes = new ArrayBuffer(data.byteLength);
  new Uint8Array(bytes).set(data);
  return new File([bytes], name, { type });
}

describe('normalizeSnapshotUpload', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('decodes and normalizes a valid %s upload', async (format, type) => {
    const result = await normalizeSnapshotUpload(upload(fixtures.get(format)!, type));
    const metadata = await sharp(result.imageData).metadata();

    expect(result).toMatchObject({
      contentType: 'image/webp',
      width: 1440,
      height: 900,
    });
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata).toMatchObject({ format: 'webp', width: 1440, height: 900 });
  });

  it('rejects a forged MIME type that disagrees with decoded image data', async () => {
    await expect(
      normalizeSnapshotUpload(upload(fixtures.get('png')!, 'image/jpeg')),
    ).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects undecodable data even when it claims an allowed MIME type', async () => {
    await expect(
      normalizeSnapshotUpload(upload(Buffer.from('not an image'), 'image/png')),
    ).rejects.toBeInstanceOf(SnapshotUploadError);
  });

  it('rejects non-image MIME types', async () => {
    await expect(
      normalizeSnapshotUpload(upload(fixtures.get('png')!, 'text/plain')),
    ).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects inputs over the 5 MB byte limit before decoding', async () => {
    await expect(
      normalizeSnapshotUpload(upload(Buffer.alloc(MAX_INPUT_BYTES + 1), 'image/png')),
    ).rejects.toMatchObject({ code: 'input_too_large' });
  });

  it('uses contain sizing with a dark neutral letterbox and strips metadata', async () => {
    const tagged = await sharp(fixtures.get('png')!)
      .withMetadata({ orientation: 3 })
      .png()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const result = await normalizeSnapshotUpload(upload(tagged, 'image/png'));
    const metadata = await sharp(result.imageData).metadata();
    const topLeft = await sharp(result.imageData)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect(Math.abs((topLeft[0] ?? 0) - 17)).toBeLessThanOrEqual(3);
    expect(Math.abs((topLeft[1] ?? 0) - 24)).toBeLessThanOrEqual(3);
    expect(Math.abs((topLeft[2] ?? 0) - 39)).toBeLessThanOrEqual(3);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });

  it('rejects a normalized output over the 1.5 MB byte limit', async () => {
    await expect(normalizeSnapshotUpload(
      upload(fixtures.get('png')!, 'image/png'),
      { normalize: async () => Buffer.alloc(MAX_OUTPUT_BYTES + 1) },
    )).rejects.toMatchObject({ code: 'output_too_large' });
  });
});
