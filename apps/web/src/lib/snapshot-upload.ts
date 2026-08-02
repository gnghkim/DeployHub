import { createHash } from 'node:crypto';
import sharp from 'sharp';

const MAX_INPUT_BYTES = 5_000_000;
const MAX_OUTPUT_BYTES = 1_500_000;
const OUTPUT_WIDTH = 1440;
const OUTPUT_HEIGHT = 900;
const MAX_INPUT_PIXELS = 40_000_000;

const MIME_BY_FORMAT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

export type SnapshotUploadErrorCode =
  | 'invalid_image'
  | 'input_too_large'
  | 'output_too_large';

export class SnapshotUploadError extends Error {
  constructor(readonly code: SnapshotUploadErrorCode) {
    super(code);
    this.name = 'SnapshotUploadError';
  }
}

type NormalizeDependencies = {
  normalize?: (input: Buffer) => Promise<Buffer>;
};

export type NormalizedSnapshotUpload = {
  imageData: Buffer;
  contentType: 'image/webp';
  width: 1440;
  height: 900;
  checksum: string;
};

async function normalizeImage(input: Buffer): Promise<Buffer> {
  return sharp(input, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: 'contain',
      background: { r: 17, g: 24, b: 39, alpha: 1 },
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}

export async function normalizeSnapshotUpload(
  file: File,
  dependencies: NormalizeDependencies = {},
): Promise<NormalizedSnapshotUpload> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new SnapshotUploadError('input_too_large');
  }

  const input = Buffer.from(await file.arrayBuffer());
  let format: keyof typeof MIME_BY_FORMAT;
  try {
    const metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();
    if (!(metadata.format && metadata.format in MIME_BY_FORMAT)) {
      throw new SnapshotUploadError('invalid_image');
    }
    format = metadata.format as keyof typeof MIME_BY_FORMAT;
  } catch (error) {
    if (error instanceof SnapshotUploadError) throw error;
    throw new SnapshotUploadError('invalid_image');
  }

  if (file.type.toLowerCase() !== MIME_BY_FORMAT[format]) {
    throw new SnapshotUploadError('invalid_image');
  }

  let imageData: Buffer;
  try {
    imageData = await (dependencies.normalize ?? normalizeImage)(input);
  } catch {
    throw new SnapshotUploadError('invalid_image');
  }
  if (imageData.byteLength === 0) {
    throw new SnapshotUploadError('invalid_image');
  }
  if (imageData.byteLength > MAX_OUTPUT_BYTES) {
    throw new SnapshotUploadError('output_too_large');
  }

  return {
    imageData,
    contentType: 'image/webp',
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    checksum: createHash('sha256').update(imageData).digest('hex'),
  };
}
