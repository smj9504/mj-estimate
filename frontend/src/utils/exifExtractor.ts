/**
 * EXIF metadata extraction from photos
 * Uses exifr for fast client-side parsing
 */
import exifr from 'exifr';

export interface PhotoMetadata {
  latitude?: number;
  longitude?: number;
  captured_at?: string;   // ISO string
  device_model?: string;
}

/**
 * Extract GPS, timestamp, and device info from a photo file's EXIF data.
 * Does NOT call browser Geolocation API (caller provides cached geo).
 */
export async function extractMetadata(file: File): Promise<PhotoMetadata> {
  const metadata: PhotoMetadata = {};

  // Try EXIF extraction for images
  if (file.type.startsWith('image/')) {
    try {
      const exif = await exifr.parse(file, {
        gps: true,
        pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'latitude', 'longitude'],
      });

      if (exif) {
        if (exif.latitude != null && exif.longitude != null) {
          metadata.latitude = exif.latitude;
          metadata.longitude = exif.longitude;
        }

        const dateField = exif.DateTimeOriginal || exif.CreateDate;
        if (dateField) {
          metadata.captured_at = dateField instanceof Date
            ? dateField.toISOString()
            : new Date(dateField).toISOString();
        }

        if (exif.Make || exif.Model) {
          metadata.device_model = [exif.Make, exif.Model].filter(Boolean).join(' ');
        }
      }
    } catch {
      // EXIF parsing failed, continue with fallbacks
    }
  }

  // Fallback: use file lastModified as captured_at
  if (!metadata.captured_at && file.lastModified) {
    metadata.captured_at = new Date(file.lastModified).toISOString();
  }

  return metadata;
}

/** Generate a fingerprint for a file (for deduplication/resume) */
export function getFingerprint(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}`;
}
