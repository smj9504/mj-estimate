import type { FileItem } from './types';

// iPhone clips run large, and go up in one piece from the server's point of view
export const MAX_VIDEO_FILE_SIZE = 2 * 1024 * 1024 * 1024;

// How long one video may take to upload: longer than any connection we expect to see it on
export const VIDEO_UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;

/** File-picker filter for a photo gallery. Windows doesn't list .heic under image/* */
export const MEDIA_ACCEPT = 'image/*,video/*,.heic,.heif,.mov,.m4v';

export const MEDIA_ALLOWED_TYPES = ['image/*', 'video/*'];

const TYPE_BY_EXTENSION: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
};

/** A file's type, going by its name when the browser doesn't know: Windows reports
 *  an iPhone's .heic with no type at all */
export const fileMediaType = (file: Pick<File, 'name' | 'type'>): string =>
  file.type || TYPE_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';

export const isVideoUpload = (file: Pick<File, 'name' | 'type'>): boolean =>
  fileMediaType(file).startsWith('video/');

export const isVideoFile = (file?: FileItem | null): boolean =>
  (file?.contentType || file?.mimeType || '').startsWith('video/');

export const formatDuration = (seconds?: number | null): string => {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};

/** Files outside water mitigation come as the server stored them: their url can be a
 *  bucket address (b2://, gs://) that means nothing to a browser. The preview route
 *  serves any of them; a video's is its poster. */
export const withBrowserUrls = (file: any, server: string): FileItem => {
  const previewUrl = `${server}/api/files/preview/${file.id}`;
  const browserCanOpen = (url?: string) => /^(https?:|data:|blob:|\/)/.test(url || '');
  const url = browserCanOpen(file.url) ? file.url : previewUrl;
  const thumbnailUrl = browserCanOpen(file.thumbnailUrl) ? file.thumbnailUrl : undefined;
  if (!isVideoFile(file)) return { ...file, url, thumbnailUrl };
  return {
    ...file,
    url: thumbnailUrl || previewUrl,
    thumbnailUrl: thumbnailUrl || previewUrl,
    videoUrl: `${server}/api/files/video/${file.id}`,
    videoDownloadUrl: `${server}/api/files/download/${file.id}`,
  };
};

export const videosStillComing = (files: FileItem[]): boolean => files.some(
  file => isVideoFile(file) && (file.videoStatus === 'pending' || file.videoStatus === 'processing'),
);

/** Hand a video to the browser to save as it comes: fetching it into a blob first,
 *  as a photo's download does, would hold the whole file in memory */
export const saveVideo = (url: string): void => {
  const link = document.createElement('a');
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
