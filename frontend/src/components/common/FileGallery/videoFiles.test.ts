import { describe, expect, it } from 'vitest';
import type { FileItem } from './types';
import {
  fileMediaType, formatDuration, isVideoFile, isVideoUpload, videosStillComing, withBrowserUrls,
} from './videoFiles';

const item = (fields: Partial<FileItem>): FileItem => ({
  id: 'file-1',
  filename: 'a',
  originalName: 'a',
  url: '/a',
  size: 1,
  uploadDate: '2026-10-12T12:00:00',
  createdAt: '2026-10-12T12:00:00',
  ...fields,
});

const SERVER = 'https://api.example';

describe('fileMediaType', () => {
  it('goes by the name when the browser reports no type, as Windows does for .heic', () => {
    expect(fileMediaType({ name: 'IMG_0100.HEIC', type: '' })).toBe('image/heic');
    expect(fileMediaType({ name: 'IMG_0001.MOV', type: '' })).toBe('video/quicktime');
  });

  it('believes the browser when it knows', () => {
    expect(fileMediaType({ name: 'IMG_0001.MOV', type: 'video/mp4' })).toBe('video/mp4');
  });

  it('leaves anything else unknown, for the upload check to refuse', () => {
    expect(fileMediaType({ name: 'notes.xyz', type: '' })).toBe('');
    expect(fileMediaType({ name: 'noextension', type: '' })).toBe('');
  });
});

describe('isVideoUpload', () => {
  it('tells a video from a photo before it is sent', () => {
    expect(isVideoUpload({ name: 'a.mov', type: '' })).toBe(true);
    expect(isVideoUpload({ name: 'a.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoUpload({ name: 'a.heic', type: '' })).toBe(false);
  });
});

describe('isVideoFile', () => {
  it('reads either field a gallery item may carry', () => {
    expect(isVideoFile(item({ contentType: 'video/quicktime' }))).toBe(true);
    expect(isVideoFile(item({ mimeType: 'video/mp4' }))).toBe(true);
    expect(isVideoFile(item({ contentType: 'image/jpeg' }))).toBe(false);
    expect(isVideoFile(null)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('reads like a video player', () => {
    expect(formatDuration(4)).toBe('0:04');
    expect(formatDuration(73.55)).toBe('1:14');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('shows at least a second for a clip under one', () => {
    expect(formatDuration(0.4)).toBe('0:01');
  });

  it('shows nothing until the length is known', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(0)).toBe('');
  });
});

describe('withBrowserUrls', () => {
  it('replaces a bucket address with the preview route', () => {
    const file = withBrowserUrls({ id: 'f', contentType: 'image/jpeg', url: 'b2://bucket/claim/a.webp' }, SERVER);
    expect(file.url).toBe(`${SERVER}/api/files/preview/f`);
  });

  it('leaves an address a browser can open', () => {
    const file = withBrowserUrls({ id: 'f', contentType: 'image/jpeg', url: 'https://cdn/a.jpg', thumbnailUrl: 'https://cdn/t.jpg' }, SERVER);
    expect(file.url).toBe('https://cdn/a.jpg');
    expect(file.thumbnailUrl).toBe('https://cdn/t.jpg');
  });

  it('drops a thumbnail a browser cannot open, so the url is used instead', () => {
    const file = withBrowserUrls({ id: 'f', contentType: 'image/jpeg', url: 'gs://b/a', thumbnailUrl: 'claim/thumb_a.webp' }, SERVER);
    expect(file.thumbnailUrl).toBeUndefined();
  });

  it("gives a video its poster as the picture and the routes to play and save it", () => {
    const file = withBrowserUrls({ id: 'v', contentType: 'video/quicktime', url: 'b2://bucket/v.mov' }, SERVER);
    expect(file.url).toBe(`${SERVER}/api/files/preview/v`);
    expect(file.thumbnailUrl).toBe(`${SERVER}/api/files/preview/v`);
    expect(file.videoUrl).toBe(`${SERVER}/api/files/video/v`);
    expect(file.videoDownloadUrl).toBe(`${SERVER}/api/files/download/v`);
  });

  it("uses CompanyCam's thumbnail as a video's poster", () => {
    const file = withBrowserUrls({ id: 'v', contentType: 'video/mp4', url: 'b2://b/v', thumbnailUrl: 'https://img/t' }, SERVER);
    expect(file.url).toBe('https://img/t');
    expect(file.thumbnailUrl).toBe('https://img/t');
  });
});

describe('videosStillComing', () => {
  it('is true while one still has its poster or copy on the way', () => {
    expect(videosStillComing([item({ contentType: 'video/mp4', videoStatus: 'pending' })])).toBe(true);
    expect(videosStillComing([item({ contentType: 'video/mp4', videoStatus: 'processing' })])).toBe(true);
  });

  it('is false once they are done either way, or there are only photos', () => {
    expect(videosStillComing([item({ contentType: 'video/mp4', videoStatus: 'ready' })])).toBe(false);
    expect(videosStillComing([item({ contentType: 'video/mp4', videoStatus: 'failed' })])).toBe(false);
    expect(videosStillComing([item({ contentType: 'image/jpeg' })])).toBe(false);
  });
});
