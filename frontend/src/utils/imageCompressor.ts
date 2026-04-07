/**
 * Client-side image compression for crew uploads.
 * Reduces phone photos from 5-15MB to ~1MB before upload.
 */
import imageCompression from 'browser-image-compression';

const COMPRESSION_OPTIONS = {
  maxSizeMB: 1.5,             // Target max size
  maxWidthOrHeight: 2560,     // Keep good resolution for detail
  useWebWorker: true,         // Non-blocking compression
  preserveExif: true,         // Keep GPS, date, device info
  fileType: 'image/jpeg',     // Standardize output
};

/**
 * Compress an image file if it's over the threshold.
 * Videos and small images pass through unchanged.
 */
export async function compressIfNeeded(file: File): Promise<File> {
  // Skip videos
  if (!file.type.startsWith('image/')) return file;

  // Skip small images (already compressed or screenshots)
  if (file.size < 500 * 1024) return file; // < 500KB

  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    // Only use compressed if it's actually smaller
    if (compressed.size < file.size) {
      return new File([compressed], file.name, {
        type: compressed.type,
        lastModified: file.lastModified,
      });
    }
    return file;
  } catch {
    // Compression failed, use original
    return file;
  }
}

/**
 * Compress multiple images in parallel using web workers.
 * Returns files in the same order.
 */
export async function compressBatch(
  files: File[],
  onProgress?: (completed: number, total: number) => void,
): Promise<File[]> {
  const total = files.length;
  let completed = 0;

  const results = await Promise.all(
    files.map(async (file) => {
      const result = await compressIfNeeded(file);
      completed++;
      onProgress?.(completed, total);
      return result;
    }),
  );

  return results;
}
