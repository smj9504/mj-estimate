/// <reference types="react-scripts" />

declare module 'piexifjs' {
  interface ExifObject {
    '0th': Record<number, any>;
    Exif: Record<number, any>;
    GPS: Record<number, any>;
    '1st': Record<number, any>;
    Interop: Record<number, any>;
    thumbnail?: string;
  }

  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  export const InteropIFD: Record<string, number>;

  export function load(dataUrl: string): ExifObject;
  export function dump(exifObj: ExifObject): string;
  export function insert(exifBytes: string, dataUrl: string): string;
  export function remove(dataUrl: string): string;
}
