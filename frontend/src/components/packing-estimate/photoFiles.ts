/**
 * Turns picked photo files into the bare base64 strings a PhotoRoom keeps.
 * HEIC photos (iPhone) are converted to JPEG by the backend first, since
 * Chrome can't display them and the analysis needs a readable image. Other
 * photos are shrunk here: a room's photos travel in one analysis request, and
 * the analysis only reads them at 1024px.
 */
import { message } from 'antd';
import * as packingService from '../../services/packingEstimateService';
import { compressIfNeeded } from '../../utils/imageCompressor';

const HEIC_NAME = /\.(heic|heif)$/i;

/** File-picker filter; Windows doesn't list .heic under image/* */
export const PHOTO_ACCEPT = 'image/*,.heic,.heif';

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || HEIC_NAME.test(file.name);
}

/** Any image, including a HEIC that Windows reports with an empty type */
export function isPhotoFile(file: File): boolean {
  return file.type.startsWith('image/') || HEIC_NAME.test(file.name);
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// One loading toast for every HEIC conversion in flight
let converting = 0;

async function convertHeic(file: File): Promise<string> {
  converting += 1;
  message.loading({ content: 'Converting HEIC photos...', key: 'heic-convert', duration: 0 });
  try {
    return await packingService.convertPhoto(file);
  } finally {
    converting -= 1;
    if (converting === 0) message.destroy('heic-convert');
  }
}

/** Base64 for each readable photo; reports the ones that couldn't be read */
export async function photoFilesToBase64(files: File[]): Promise<string[]> {
  const results = await Promise.allSettled(
    files.filter(isPhotoFile).map(async f => (
      isHeic(f) ? convertHeic(f) : readBase64(await compressIfNeeded(f))
    )),
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    message.error(`${failed} photo${failed > 1 ? 's' : ''} couldn't be read`);
  }
  return results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
}
