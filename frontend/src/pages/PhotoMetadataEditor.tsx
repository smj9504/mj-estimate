import React, { useState, useCallback } from 'react';
import {
  Card, Upload, Button, Descriptions, Typography, Space, Tabs, Input,
  DatePicker, InputNumber, message, Empty, Spin, Tag, Tooltip, Row, Col,
  Divider, Image, Popconfirm, Select, Badge, Modal,
} from 'antd';
import {
  UploadOutlined, DownloadOutlined, CameraOutlined, EnvironmentOutlined,
  InfoCircleOutlined, EditOutlined, FileImageOutlined, SettingOutlined,
  DeleteOutlined, ReloadOutlined, CopyOutlined, BgColorsOutlined,
  PictureOutlined, TagsOutlined, DatabaseOutlined, ImportOutlined,
} from '@ant-design/icons';
import exifr from 'exifr';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Dragger } = Upload;

// ---------------------------------------------------------------------------
// piexifjs – lazy loaded to avoid CJS/ESM import issues
// ---------------------------------------------------------------------------
function getPiexif(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require('piexifjs');
}

// Tag constants (from piexifjs) – hardcoded to avoid import-time dependency
const IMG_TAGS = {
  ProcessingSoftware: 11, ImageDescription: 270, Make: 271, Model: 272,
  Orientation: 274, XResolution: 282, YResolution: 283, ResolutionUnit: 296,
  Software: 305, DateTime: 306, Artist: 315, HostComputer: 316,
  YCbCrPositioning: 531, Copyright: 33432, Rating: 18246, RatingPercent: 18249,
} as const;

const EXIF_TAGS = {
  ExposureTime: 33434, FNumber: 33437, ExposureProgram: 34850,
  ISOSpeedRatings: 34855, ExifVersion: 36864,
  DateTimeOriginal: 36867, DateTimeDigitized: 36868,
  CompressedBitsPerPixel: 37122,
  ShutterSpeedValue: 37377, ApertureValue: 37378, BrightnessValue: 37379,
  ExposureBiasValue: 37380, MaxApertureValue: 37381, SubjectDistance: 37382,
  MeteringMode: 37383, LightSource: 37384, Flash: 37385, FocalLength: 37386,
  UserComment: 37510, SubSecTime: 37520, SubSecTimeOriginal: 37521, SubSecTimeDigitized: 37522,
  FlashpixVersion: 40960, ColorSpace: 40961, PixelXDimension: 40962, PixelYDimension: 40963,
  FocalPlaneXResolution: 41486, FocalPlaneYResolution: 41487, FocalPlaneResolutionUnit: 41488,
  SensingMethod: 41495, FileSource: 41728, SceneType: 41729,
  CustomRendered: 41985, ExposureMode: 41986, WhiteBalance: 41987,
  DigitalZoomRatio: 41988, FocalLengthIn35mmFilm: 41989, SceneCaptureType: 41990,
  GainControl: 41991, Contrast: 41992, Saturation: 41993, Sharpness: 41994,
  SubjectDistanceRange: 41996,
  ImageUniqueID: 42016, CameraOwnerName: 42032, BodySerialNumber: 42033,
  LensMake: 42035, LensModel: 42036, LensSerialNumber: 42037, Gamma: 42240,
} as const;

const GPS_TAGS = {
  GPSVersionID: 0, GPSLatitudeRef: 1, GPSLatitude: 2, GPSLongitudeRef: 3,
  GPSLongitude: 4, GPSAltitudeRef: 5, GPSAltitude: 6, GPSTimeStamp: 7,
  GPSSpeedRef: 12, GPSSpeed: 13, GPSImgDirectionRef: 16, GPSImgDirection: 17,
  GPSMapDatum: 18, GPSDateStamp: 29, GPSHPositioningError: 31,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MetadataField {
  key: string;
  label: string;
  value: any;
  rawValue?: any;        // original pre-format value for editing
  editable?: boolean;
  type?: 'text' | 'number' | 'date' | 'select' | 'rational' | 'readonly';
  selectOptions?: { label: string; value: any }[];
  piexifIFD?: string;    // '0th' | 'Exif' | 'GPS' | '1st' | 'Interop'
  piexifTag?: number;
  writeTransform?: 'gps_lat' | 'gps_lng' | 'gps_alt' | 'date_exif' | 'user_comment' | 'rational' | 'rational_pair';
}

interface MetadataCategory {
  key: string;
  label: string;
  icon: React.ReactNode;
  fields: MetadataField[];
  badge?: number; // count of fields with values
}

// ---------------------------------------------------------------------------
// Constants – piexif tag numbers
// ---------------------------------------------------------------------------
const IMG = IMG_TAGS;
const EX = EXIF_TAGS;
const GPS = GPS_TAGS;

// Orientation options for select
const ORIENTATION_OPTIONS = [
  { label: '1 - Normal', value: 1 },
  { label: '2 - Flip Horizontal', value: 2 },
  { label: '3 - Rotate 180°', value: 3 },
  { label: '4 - Flip Vertical', value: 4 },
  { label: '5 - Transpose', value: 5 },
  { label: '6 - Rotate 90° CW', value: 6 },
  { label: '7 - Transverse', value: 7 },
  { label: '8 - Rotate 90° CCW', value: 8 },
];

const RESOLUTION_UNIT_OPTIONS = [
  { label: '2 - inches', value: 2 },
  { label: '3 - centimeters', value: 3 },
];

const COLOR_SPACE_OPTIONS = [
  { label: '1 - sRGB', value: 1 },
  { label: '65535 - Uncalibrated', value: 65535 },
];

const EXPOSURE_PROGRAM_OPTIONS = [
  { label: '0 - Not defined', value: 0 },
  { label: '1 - Manual', value: 1 },
  { label: '2 - Normal program', value: 2 },
  { label: '3 - Aperture priority', value: 3 },
  { label: '4 - Shutter priority', value: 4 },
  { label: '5 - Creative', value: 5 },
  { label: '6 - Action', value: 6 },
  { label: '7 - Portrait', value: 7 },
  { label: '8 - Landscape', value: 8 },
];

const METERING_MODE_OPTIONS = [
  { label: '0 - Unknown', value: 0 },
  { label: '1 - Average', value: 1 },
  { label: '2 - Center-weighted', value: 2 },
  { label: '3 - Spot', value: 3 },
  { label: '4 - Multi-spot', value: 4 },
  { label: '5 - Pattern', value: 5 },
  { label: '6 - Partial', value: 6 },
];

const WHITE_BALANCE_OPTIONS = [
  { label: '0 - Auto', value: 0 },
  { label: '1 - Manual', value: 1 },
];

const SCENE_CAPTURE_OPTIONS = [
  { label: '0 - Standard', value: 0 },
  { label: '1 - Landscape', value: 1 },
  { label: '2 - Portrait', value: 2 },
  { label: '3 - Night scene', value: 3 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatGPS(lat?: number, lng?: number): string {
  if (lat == null || lng == null) return 'N/A';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`;
}

function formatExposure(val: any): string {
  if (val == null) return '';
  if (typeof val === 'number') {
    if (val > 0 && val < 1) return `1/${Math.round(1 / val)}`;
    return String(val);
  }
  return String(val);
}

function formatValue(val: any): string {
  if (val == null || val === undefined) return '';
  if (val instanceof Date) return dayjs(val).format('YYYY-MM-DD HH:mm:ss');
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return String(val); }
  }
  return String(val);
}

function decimalToDMS(dd: number): [number, number][] {
  const abs = Math.abs(dd);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = Math.round((minFloat - m) * 60 * 10000);
  return [[d, 1], [m, 1], [s, 10000]];
}

/** Convert number to piexif rational [numerator, denominator] */
function toRational(val: number): [number, number] {
  if (Number.isInteger(val)) return [val, 1];
  // use 10000 precision
  const denom = 10000;
  return [Math.round(val * denom), denom];
}

// ---------------------------------------------------------------------------
// ICC Profile utilities
// ---------------------------------------------------------------------------

const ICC_SIG = 'ICC_PROFILE';

const ICC_MARKER_BYTES = [0x49, 0x43, 0x43, 0x5F, 0x50, 0x52, 0x4F, 0x46, 0x49, 0x4C, 0x45, 0x00];

interface JpegSegment { marker: number; offset: number; length: number; }

/** Scan JPEG for marker segments. Skips padding 0xFF bytes and handles RST markers. */
function jpegSegments(jpeg: Uint8Array): JpegSegment[] {
  const result: JpegSegment[] = [];
  let i = 2; // skip SOI
  while (i < jpeg.length - 1) {
    // Skip padding 0xFF bytes
    while (i < jpeg.length - 1 && jpeg[i] === 0xFF && jpeg[i + 1] === 0xFF) i++;
    if (i >= jpeg.length - 1 || jpeg[i] !== 0xFF) break;
    const marker = jpeg[i + 1];
    // Standalone markers (RST0-RST7, SOI, EOI, TEM)
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8 || marker === 0xD9 || marker === 0x01) {
      if (marker === 0xD9) break; // EOI
      i += 2;
      continue;
    }
    if (marker === 0xDA) break; // SOS – image data follows, no more metadata segments
    if (i + 3 >= jpeg.length) break;
    const segLen = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (segLen < 2) break; // invalid
    result.push({ marker, offset: i, length: segLen });
    i += 2 + segLen;
  }
  return result;
}

function extractIccProfile(jpeg: Uint8Array): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  for (const seg of jpegSegments(jpeg)) {
    if (seg.marker !== 0xE2 || seg.length < 16) continue;
    const payloadStart = seg.offset + 4; // after FF E2 LL LL
    // Check "ICC_PROFILE\0" (12 bytes)
    let isIcc = true;
    for (let j = 0; j < ICC_SIG.length; j++) {
      if (jpeg[payloadStart + j] !== ICC_SIG.charCodeAt(j)) { isIcc = false; break; }
    }
    if (!isIcc || jpeg[payloadStart + 12] !== 0) continue; // null terminator
    // seq = jpeg[payloadStart + 13], total = jpeg[payloadStart + 14]
    const dataStart = payloadStart + 14;
    const dataLen = seg.length - 2 - 14; // segLen includes its own 2 bytes
    if (dataLen > 0 && dataStart + dataLen <= jpeg.length) {
      chunks.push(jpeg.slice(dataStart, dataStart + dataLen));
    }
  }
  if (chunks.length === 0) return null;
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const chunk of chunks) { merged.set(chunk, off); off += chunk.length; }
  return merged;
}

function removeIccFromJpeg(jpeg: Uint8Array): Uint8Array {
  // Collect offsets of ICC APP2 segments to skip
  const skipRanges: [number, number][] = [];
  for (const seg of jpegSegments(jpeg)) {
    if (seg.marker !== 0xE2 || seg.length < 16) continue;
    const payloadStart = seg.offset + 4;
    let isIcc = true;
    for (let j = 0; j < ICC_SIG.length; j++) {
      if (jpeg[payloadStart + j] !== ICC_SIG.charCodeAt(j)) { isIcc = false; break; }
    }
    if (isIcc && jpeg[payloadStart + 12] === 0) {
      skipRanges.push([seg.offset, seg.offset + 2 + seg.length]);
    }
  }
  if (skipRanges.length === 0) return jpeg;

  const parts: Uint8Array[] = [];
  let prev = 0;
  for (const [start, end] of skipRanges) {
    if (start > prev) parts.push(jpeg.slice(prev, start));
    prev = end;
  }
  if (prev < jpeg.length) parts.push(jpeg.slice(prev));
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result;
}

function injectIccIntoJpeg(jpeg: Uint8Array, iccProfile: Uint8Array): Uint8Array {
  const clean = removeIccFromJpeg(jpeg);
  const MAX_CHUNK = 65519 - 14;
  const numChunks = Math.ceil(iccProfile.length / MAX_CHUNK);
  const app2Segments: Uint8Array[] = [];
  for (let c = 0; c < numChunks; c++) {
    const chunkStart = c * MAX_CHUNK;
    const chunkData = iccProfile.slice(chunkStart, chunkStart + MAX_CHUNK);
    const segLen = 2 + 12 + 2 + chunkData.length;
    const seg = new Uint8Array(2 + segLen);
    seg[0] = 0xFF; seg[1] = 0xE2;
    seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;
    for (let j = 0; j < ICC_MARKER_BYTES.length; j++) seg[4 + j] = ICC_MARKER_BYTES[j];
    seg[16] = c + 1; seg[17] = numChunks;
    seg.set(chunkData, 18);
    app2Segments.push(seg);
  }
  const totalApp2 = app2Segments.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(clean.length + totalApp2);
  result.set(clean.slice(0, 2), 0);
  let off = 2;
  for (const seg of app2Segments) { result.set(seg, off); off += seg.length; }
  result.set(clean.slice(2), off);
  return result;
}

/** Read a 4-char ASCII tag from ICC bytes */
function iccStr(icc: Uint8Array, offset: number, len: number = 4): string {
  let s = '';
  for (let i = offset; i < offset + len && i < icc.length; i++) {
    s += String.fromCharCode(icc[i]);
  }
  return s;
}

function iccU32(icc: Uint8Array, offset: number): number {
  return (icc[offset] << 24) | (icc[offset + 1] << 16) | (icc[offset + 2] << 8) | icc[offset + 3];
}

function iccU16(icc: Uint8Array, offset: number): number {
  return (icc[offset] << 8) | icc[offset + 1];
}

/** s15Fixed16Number → float */
function iccS15Fixed16(icc: Uint8Array, offset: number): number {
  const raw = iccU32(icc, offset);
  const signed = raw > 0x7FFFFFFF ? raw - 0x100000000 : raw;
  return signed / 65536;
}

/** Read text from desc or mluc tag */
/** Read a single UTF-16BE string from mluc record */
function iccReadUtf16(icc: Uint8Array, start: number, byteLen: number): string {
  let txt = '';
  for (let bi = start; bi < start + byteLen && bi + 1 < icc.length; bi += 2) {
    const code = iccU16(icc, bi);
    if (code === 0) break;
    txt += String.fromCharCode(code);
  }
  return txt;
}

/** Read primary text from desc/mluc/text tag */
function iccReadTextTag(icc: Uint8Array, dataOffset: number, dataSize: number): string {
  if (dataOffset + 4 > icc.length) return '';
  const typeSig = iccStr(icc, dataOffset, 4);
  if (typeSig === 'desc') {
    const strLen = iccU32(icc, dataOffset + 8);
    const bytes = icc.slice(dataOffset + 12, dataOffset + 12 + Math.max(0, strLen - 1));
    return Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  }
  if (typeSig === 'mluc') {
    const recCount = iccU32(icc, dataOffset + 8);
    if (recCount > 0 && dataOffset + 24 <= icc.length) {
      const strLength = iccU32(icc, dataOffset + 16);
      const strOffset = iccU32(icc, dataOffset + 20);
      return iccReadUtf16(icc, dataOffset + strOffset, strLength);
    }
  }
  if (typeSig === 'text') {
    return Array.from(icc.slice(dataOffset + 8, dataOffset + dataSize)).map(b => String.fromCharCode(b)).join('').replace(/\0/g, '');
  }
  return '';
}

interface MlucEntry { lang: string; text: string; }

/** Read ALL localized strings from an mluc tag */
function iccReadMlucAll(icc: Uint8Array, dataOffset: number): MlucEntry[] {
  if (dataOffset + 4 > icc.length) return [];
  const typeSig = iccStr(icc, dataOffset, 4);
  if (typeSig !== 'mluc') return [];
  const recCount = iccU32(icc, dataOffset + 8);
  const recSize = iccU32(icc, dataOffset + 12); // typically 12
  const entries: MlucEntry[] = [];
  for (let r = 0; r < recCount; r++) {
    const recOff = dataOffset + 16 + r * recSize;
    if (recOff + 12 > icc.length) break;
    const langCode = iccStr(icc, recOff, 2);
    const countryCode = iccStr(icc, recOff + 2, 2);
    const strLength = iccU32(icc, recOff + 4);
    const strOffset = iccU32(icc, recOff + 8);
    const txt = iccReadUtf16(icc, dataOffset + strOffset, strLength);
    const locale = countryCode.trim() ? `${langCode}-${countryCode}`.trim() : langCode.trim();
    if (txt) entries.push({ lang: locale, text: txt });
  }
  return entries;
}

interface IccProfileInfo {
  profileSize: string;
  cmmType: string;
  version: string;
  profileClass: string;
  colorSpaceData: string;
  connectionSpace: string;
  dateTime: string;
  fileSignature: string;
  primaryPlatform: string;
  cmmFlags: string;
  deviceManufacturer: string;
  deviceModel: string;
  deviceAttributes: string;
  renderingIntent: string;
  connectionSpaceIlluminant: string;
  profileCreator: string;
  profileId: string;
  profileDescription: string;
  copyright: string;
  technology: string;
  tagCount: number;
  tagList: string[];
  /** All multi-language entries: tagSig → [{ lang, text }] */
  mlEntries: Record<string, MlucEntry[]>;
}

function parseIccProfile(icc: Uint8Array): IccProfileInfo | null {
  if (!icc || icc.length < 128) return null;

  const classMap: Record<string, string> = {
    'scnr': 'Input Device Profile', 'mntr': 'Display Device Profile', 'prtr': 'Output Device Profile',
    'link': 'DeviceLink Profile', 'spac': 'ColorSpace Profile', 'abst': 'Abstract Profile', 'nmcl': 'NamedColor Profile',
  };
  const csMap: Record<string, string> = {
    'RGB ': 'RGB', 'CMYK': 'CMYK', 'GRAY': 'Gray', 'Lab ': 'Lab', 'XYZ ': 'XYZ',
    'YCbr': 'YCbCr', 'Luv ': 'Luv', 'Yxy ': 'Yxy', 'HSV ': 'HSV', 'HLS ': 'HLS',
  };
  const platMap: Record<string, string> = {
    'APPL': 'Apple Computer Inc.', 'MSFT': 'Microsoft Corporation',
    'SGI ': 'Silicon Graphics Inc.', 'SUNW': 'Sun Microsystems',
    '\0\0\0\0': '(none)',
  };
  const intentMap: Record<number, string> = {
    0: 'Perceptual', 1: 'Relative Colorimetric', 2: 'Saturation', 3: 'Absolute Colorimetric',
  };
  const techMap: Record<string, string> = {
    'fscn': 'Film Scanner', 'dcam': 'Digital Camera', 'rscn': 'Reflective Scanner',
    'ijet': 'Ink Jet Printer', 'twax': 'Thermal Wax Printer', 'epho': 'Electrophotographic Printer',
    'esta': 'Electrostatic Printer', 'dsub': 'Dye Sublimation Printer', 'rpho': 'Photographic Paper Printer',
    'fprn': 'Film Writer', 'vidm': 'Video Monitor', 'vidc': 'Video Camera',
    'pjtv': 'Projection Television', 'CRT ': 'CRT Display', 'PMD ': 'Passive Matrix Display',
    'AMD ': 'Active Matrix Display', 'KPCD': 'Photo CD', 'imgs': 'Photo Image Setter',
    'grav': 'Gravure', 'offs': 'Offset Lithography', 'silk': 'Silkscreen',
    'flex': 'Flexography', 'mpfs': 'Motion Picture Film Scanner', 'mpfr': 'Motion Picture Film Recorder',
    'dmpc': 'Digital Motion Picture Camera', 'dcpj': 'Digital Cinema Projector',
  };

  // CMM Type (lookup common values)
  const cmmRaw = iccStr(icc, 4, 4);
  const cmmMap: Record<string, string> = {
    'APPL': 'Apple Computer Inc.', 'appl': 'Apple Computer Inc.',
    'ADBE': 'Adobe Systems Inc.', 'Lino': 'Linotype', 'MSFT': 'Microsoft',
    'KCMS': 'Kodak', 'HCMM': 'Heidelberg', 'argl': 'ArgyllCMS',
    'lcms': 'Little CMS', 'LMlc': 'Little CMS',
  };

  const cls = iccStr(icc, 12, 4);
  const cs = iccStr(icc, 16, 4);
  const pcs = iccStr(icc, 20, 4);
  const plat = iccStr(icc, 40, 4);

  // Date
  const year = iccU16(icc, 24);
  const month = iccU16(icc, 26);
  const day = iccU16(icc, 28);
  const hour = iccU16(icc, 30);
  const min = iccU16(icc, 32);
  const sec = iccU16(icc, 34);
  const dateStr = year > 0
    ? `${year}:${String(month).padStart(2, '0')}:${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : '';

  // CMM Flags (bytes 44-47)
  const flagBits = iccU32(icc, 44);
  const flagParts: string[] = [];
  flagParts.push(flagBits & 1 ? 'Embedded' : 'Not Embedded');
  flagParts.push(flagBits & 2 ? 'Dependent' : 'Independent');

  // Device Attributes (bytes 56-63)
  const attrHi = iccU32(icc, 56);
  const attrParts: string[] = [];
  attrParts.push(attrHi & 1 ? 'Transparency' : 'Reflective');
  attrParts.push(attrHi & 2 ? 'Matte' : 'Glossy');
  attrParts.push(attrHi & 4 ? 'Negative' : 'Positive');
  attrParts.push(attrHi & 8 ? 'Black & White' : 'Color');

  // Rendering Intent
  const intent = iccU32(icc, 64);

  // Connection Space Illuminant (D50 XYZ: bytes 68-79)
  const illumX = iccS15Fixed16(icc, 68);
  const illumY = iccS15Fixed16(icc, 72);
  const illumZ = iccS15Fixed16(icc, 76);

  // Profile Creator (bytes 80-83)
  const creator = iccStr(icc, 80, 4).trim();

  // Profile ID (bytes 84-99, MD5)
  const idBytes = icc.slice(84, 100);
  const isZero = Array.from(idBytes).every(b => b === 0);
  const profileId = isZero ? '0' : Array.from(idBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Manufacturer & Model with lookup
  const mfgRaw = iccStr(icc, 48, 4).trim();
  const mdlRaw = iccStr(icc, 52, 4).trim();

  // Tags
  let tagCount = 0;
  const tagList: string[] = [];
  let description = '';
  let copyright = '';
  let technology = '';
  const mlEntries: Record<string, MlucEntry[]> = {};

  // Tag signature → human-readable name
  const tagNameMap: Record<string, string> = {
    'desc': 'Profile Description', 'cprt': 'Copyright',
    'dmnd': 'Device Manufacturer Description', 'dmdd': 'Device Model Description',
    'vued': 'Viewing Conditions Description', 'wtpt': 'Media White Point',
    'bkpt': 'Media Black Point', 'rXYZ': 'Red Matrix Column',
    'gXYZ': 'Green Matrix Column', 'bXYZ': 'Blue Matrix Column',
    'rTRC': 'Red TRC', 'gTRC': 'Green TRC', 'bTRC': 'Blue TRC',
    'chad': 'Chromatic Adaptation', 'tech': 'Technology',
    'lumi': 'Luminance', 'meas': 'Measurement',
  };

  if (icc.length >= 132) {
    tagCount = iccU32(icc, 128);
    for (let t = 0; t < tagCount && (132 + t * 12 + 12) <= icc.length; t++) {
      const tagOff = 132 + t * 12;
      const sig = iccStr(icc, tagOff, 4);
      const dataOffset = iccU32(icc, tagOff + 4);
      const dataSize = iccU32(icc, tagOff + 8);
      tagList.push(sig);

      if (dataOffset + dataSize > icc.length) continue;

      if (sig === 'desc') {
        const txt = iccReadTextTag(icc, dataOffset, dataSize);
        if (txt) description = txt;
      }
      if (sig === 'cprt') {
        const txt = iccReadTextTag(icc, dataOffset, dataSize);
        if (txt) copyright = txt;
      }
      if (sig === 'tech' && dataSize >= 12) {
        const techCode = iccStr(icc, dataOffset + 8, 4);
        technology = techMap[techCode] || techCode;
      }
      // dmnd = device manufacturer description
      if (sig === 'dmnd' && !cmmMap[mfgRaw]) {
        const txt = iccReadTextTag(icc, dataOffset, dataSize);
        if (txt && txt.length > mfgRaw.length) {
          cmmMap['__dmnd'] = txt;
        }
      }
      // dmdd = device model description
      if (sig === 'dmdd') {
        const txt = iccReadTextTag(icc, dataOffset, dataSize);
        if (txt) cmmMap['__dmdd'] = txt;
      }

      // Extract ALL mluc records for any text-like tag
      const typeSig = iccStr(icc, dataOffset, 4);
      if (typeSig === 'mluc') {
        const entries = iccReadMlucAll(icc, dataOffset);
        if (entries.length > 0) {
          const tagName = tagNameMap[sig] || sig;
          mlEntries[tagName] = entries;
        }
      }
    }
  }

  return {
    profileSize: formatBytes(iccU32(icc, 0)),
    cmmType: cmmMap[cmmRaw] || cmmRaw.replace(/\0/g, '').trim() || '(none)',
    version: `${icc[8]}.${(icc[9] >> 4)}.${icc[9] & 0xF}`,
    profileClass: classMap[cls] || cls.trim(),
    colorSpaceData: csMap[cs] || cs.trim(),
    connectionSpace: csMap[pcs] || pcs.trim(),
    dateTime: dateStr,
    fileSignature: iccStr(icc, 36, 4),
    primaryPlatform: platMap[plat] || plat.replace(/\0/g, '').trim() || '(none)',
    cmmFlags: flagParts.join(', '),
    deviceManufacturer: cmmMap['__dmnd'] || cmmMap[mfgRaw] || mfgRaw || '(none)',
    deviceModel: cmmMap['__dmdd'] || mdlRaw || '',
    deviceAttributes: attrParts.join(', '),
    renderingIntent: intentMap[intent] || String(intent),
    connectionSpaceIlluminant: `${illumX.toFixed(4)} ${illumY.toFixed(4)} ${illumZ.toFixed(5)}`,
    profileCreator: cmmMap[creator] || platMap[creator] || creator || '(none)',
    profileId,
    profileDescription: description,
    copyright,
    technology,
    tagCount,
    tagList,
    mlEntries,
  };
}

const ICC_ACTION_OPTIONS = [
  { label: 'Keep Original', value: 'keep' },
  { label: 'Remove ICC Profile', value: 'remove' },
];

// ---------------------------------------------------------------------------
// XMP utilities
// ---------------------------------------------------------------------------

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

/** Extract raw XMP XML string from JPEG */
function extractXmpXml(jpeg: Uint8Array): string | null {
  for (const seg of jpegSegments(jpeg)) {
    if (seg.marker !== 0xE1) continue;
    const payloadStart = seg.offset + 4;
    // Check for XMP namespace header
    let match = true;
    for (let j = 0; j < XMP_HEADER.length; j++) {
      if (payloadStart + j >= jpeg.length || jpeg[payloadStart + j] !== XMP_HEADER.charCodeAt(j)) {
        match = false; break;
      }
    }
    if (!match) continue;
    const xmlStart = payloadStart + XMP_HEADER.length;
    const xmlEnd = seg.offset + 2 + seg.length;
    const bytes = jpeg.slice(xmlStart, xmlEnd);
    return Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  }
  return null;
}

/** Replace XMP APP1 segment in JPEG with new XML */
/** Remove XMP APP1 segment from JPEG entirely */
function removeXmpFromJpeg(jpeg: Uint8Array): Uint8Array {
  const skipRanges: [number, number][] = [];
  for (const seg of jpegSegments(jpeg)) {
    if (seg.marker !== 0xE1) continue;
    const payloadStart = seg.offset + 4;
    let match = true;
    for (let j = 0; j < XMP_HEADER.length; j++) {
      if (payloadStart + j >= jpeg.length || jpeg[payloadStart + j] !== XMP_HEADER.charCodeAt(j)) {
        match = false; break;
      }
    }
    if (match) skipRanges.push([seg.offset, seg.offset + 2 + seg.length]);
  }
  if (skipRanges.length === 0) return jpeg;
  const parts: Uint8Array[] = [];
  let prev = 0;
  for (const [start, end] of skipRanges) {
    if (start > prev) parts.push(jpeg.slice(prev, start));
    prev = end;
  }
  if (prev < jpeg.length) parts.push(jpeg.slice(prev));
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result;
}

function replaceXmpInJpeg(jpeg: Uint8Array, newXml: string): Uint8Array {
  // Find and remove existing XMP APP1
  const parts: Uint8Array[] = [];
  let prevEnd = 0;
  let insertionPoint = 2; // after SOI by default
  let found = false;

  for (const seg of jpegSegments(jpeg)) {
    if (seg.marker === 0xE1 && !found) {
      const payloadStart = seg.offset + 4;
      let match = true;
      for (let j = 0; j < XMP_HEADER.length; j++) {
        if (payloadStart + j >= jpeg.length || jpeg[payloadStart + j] !== XMP_HEADER.charCodeAt(j)) {
          match = false; break;
        }
      }
      if (match) {
        // Remove this segment
        if (seg.offset > prevEnd) parts.push(jpeg.slice(prevEnd, seg.offset));
        insertionPoint = parts.reduce((s, p) => s + p.length, 0);
        prevEnd = seg.offset + 2 + seg.length;
        found = true;
        continue;
      }
    }
  }
  if (prevEnd < jpeg.length) parts.push(jpeg.slice(prevEnd));

  // Build new XMP APP1 segment
  const headerBytes = new Uint8Array(XMP_HEADER.length);
  for (let i = 0; i < XMP_HEADER.length; i++) headerBytes[i] = XMP_HEADER.charCodeAt(i);
  const xmlBytes = new TextEncoder().encode(newXml);
  const segPayloadLen = 2 + headerBytes.length + xmlBytes.length; // 2 for length field itself
  const segHeader = new Uint8Array(4);
  segHeader[0] = 0xFF; segHeader[1] = 0xE1;
  segHeader[2] = (segPayloadLen >> 8) & 0xFF; segHeader[3] = segPayloadLen & 0xFF;

  const newSeg = new Uint8Array(4 + headerBytes.length + xmlBytes.length);
  newSeg.set(segHeader, 0);
  newSeg.set(headerBytes, 4);
  newSeg.set(xmlBytes, 4 + headerBytes.length);

  if (!found) {
    // No existing XMP – insert after SOI
    const merged = new Uint8Array(2 + newSeg.length + (jpeg.length - 2));
    merged.set(jpeg.slice(0, 2), 0);
    merged.set(newSeg, 2);
    merged.set(jpeg.slice(2), 2 + newSeg.length);
    return merged;
  }

  // Reassemble with new segment at the insertion point
  const totalBefore = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalBefore + newSeg.length);
  let off = 0;
  // Write parts up to insertion point
  let accumulated = 0;
  for (const p of parts) {
    if (accumulated + p.length <= insertionPoint) {
      result.set(p, off); off += p.length;
      accumulated += p.length;
    } else if (accumulated < insertionPoint) {
      const split = insertionPoint - accumulated;
      result.set(p.slice(0, split), off); off += split;
      result.set(newSeg, off); off += newSeg.length;
      result.set(p.slice(split), off); off += p.length - split;
      accumulated += p.length;
    } else {
      result.set(p, off); off += p.length;
      accumulated += p.length;
    }
  }
  return result;
}

/** Modify a value in XMP XML string using DOM parsing */
function modifyXmpValue(xml: string, fieldKey: string, newValue: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // XMP namespace mappings
    const NS: Record<string, string> = {
      'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      'dc': 'http://purl.org/dc/elements/1.1/',
      'xmp': 'http://ns.adobe.com/xap/1.0/',
      'xmpMM': 'http://ns.adobe.com/xap/1.0/mm/',
      'photoshop': 'http://ns.adobe.com/photoshop/1.0/',
      'tiff': 'http://ns.adobe.com/tiff/1.0/',
      'exif': 'http://ns.adobe.com/exif/1.0/',
      'xmpRights': 'http://ns.adobe.com/xap/1.0/rights/',
    };

    // Map field keys to namespace + local name
    const fieldMap: Record<string, [string, string]> = {
      'xmp_title': ['dc', 'title'],
      'xmp_description': ['dc', 'description'],
      'xmp_creator': ['dc', 'creator'],
      'xmp_subject': ['dc', 'subject'],
      'xmp_rights': ['dc', 'rights'],
      'xmp_Rating': ['xmp', 'Rating'],
      'xmp_Label': ['xmp', 'Label'],
      'xmp_CreatorTool': ['xmp', 'CreatorTool'],
      'xmp_CreateDate': ['xmp', 'CreateDate'],
      'xmp_ModifyDate': ['xmp', 'ModifyDate'],
      'xmp_MetadataDate': ['xmp', 'MetadataDate'],
      'xmp_DateCreated': ['photoshop', 'DateCreated'],
      'xmp_Artist': ['tiff', 'Artist'],
      'xmp_Copyright': ['tiff', 'Copyright'],
      'xmp_ImageDescription': ['tiff', 'ImageDescription'],
    };

    const mapping = fieldMap[fieldKey];
    if (!mapping) return xml;

    const [prefix, localName] = mapping;
    const nsUri = NS[prefix];
    if (!nsUri) return xml;

    // Find rdf:Description element
    const descriptions = doc.getElementsByTagNameNS(NS.rdf, 'Description');
    if (descriptions.length === 0) return xml;
    const rdfDesc = descriptions[0];

    // Check as attribute first (simple values)
    const attrName = `${prefix}:${localName}`;
    if (rdfDesc.hasAttribute(attrName)) {
      rdfDesc.setAttribute(attrName, newValue);
    } else {
      // Check as child element
      const existing = rdfDesc.getElementsByTagNameNS(nsUri, localName);
      if (existing.length > 0) {
        const el = existing[0];
        // Check for rdf:Alt/rdf:Bag/rdf:Seq (language alternatives or lists)
        const altList = el.getElementsByTagNameNS(NS.rdf, 'Alt');
        const bagList = el.getElementsByTagNameNS(NS.rdf, 'Bag');
        const seqList = el.getElementsByTagNameNS(NS.rdf, 'Seq');
        const container = altList[0] || bagList[0] || seqList[0];

        if (container) {
          const lis = container.getElementsByTagNameNS(NS.rdf, 'li');
          if (lis.length > 0) {
            lis[0].textContent = newValue;
          } else {
            const li = doc.createElementNS(NS.rdf, 'rdf:li');
            li.textContent = newValue;
            container.appendChild(li);
          }
        } else {
          el.textContent = newValue;
        }
      } else {
        // Create new element
        const newEl = doc.createElementNS(nsUri, `${prefix}:${localName}`);
        newEl.textContent = newValue;
        rdfDesc.appendChild(newEl);
      }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (e) {
    console.error('XMP modify error:', e);
    return xml;
  }
}

// ---------------------------------------------------------------------------
// Segment-based parse helpers
// ---------------------------------------------------------------------------
async function parseAllSegments(f: File) {
  // Parse with merge to get a combined view
  const merged = await exifr.parse(f, {
    tiff: true, exif: true, gps: true, ifd1: true,
    iptc: true, xmp: true, icc: true, makerNote: false,
    interop: true, translateValues: true, translateKeys: true,
    reviveValues: true, mergeOutput: true,
  }).catch(() => ({})) || {};

  // Parse ICC separately (non-translated for raw data)
  const iccData = await exifr.parse(f, {
    tiff: false, exif: false, gps: false,
    icc: true, iptc: false, xmp: false,
    translateValues: false, translateKeys: false,
    mergeOutput: false,
  }).catch(() => null);

  // Parse IPTC separately
  const iptcData = await exifr.parse(f, {
    tiff: false, exif: false, gps: false,
    icc: false, iptc: true, xmp: false,
    translateValues: true, translateKeys: true,
    mergeOutput: false,
  }).catch(() => null);

  // Parse XMP separately
  const xmpData = await exifr.parse(f, {
    tiff: false, exif: false, gps: false,
    icc: false, iptc: false, xmp: true,
    translateValues: true, translateKeys: true,
    mergeOutput: false,
  }).catch(() => null);

  return { merged, iccData, iptcData, xmpData };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const PhotoMetadataEditor: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [allData, setAllData] = useState<{
    merged: Record<string, any>;
    iccData: Record<string, any> | null;
    iptcData: Record<string, any> | null;
    xmpData: Record<string, any> | null;
  } | null>(null);
  const [categories, setCategories] = useState<MetadataCategory[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [imageInfo, setImageInfo] = useState<{ width: number; height: number } | null>(null);
  const [activeTab, setActiveTab] = useState('file');
  const [rawIccProfile, setRawIccProfile] = useState<Uint8Array | null>(null);
  const [iccAction, setIccAction] = useState<string>('keep');
  const [rawXmpXml, setRawXmpXml] = useState<string | null>(null);
  const [xmpAction, setXmpAction] = useState<string>('keep');

  // ── Parse all metadata ──────────────────────────────────────────────
  const parseMetadata = useCallback(async (f: File) => {
    setLoading(true);
    try {
      const segments = await parseAllSegments(f);

      // Extract raw ICC profile and XMP from JPEG binary
      let rawIcc: Uint8Array | null = null;
      let xmpXml: string | null = null;
      try {
        const buf = await f.arrayBuffer();
        const jpegBytes = new Uint8Array(buf);
        rawIcc = extractIccProfile(jpegBytes);
        xmpXml = extractXmpXml(jpegBytes);
      } catch { /* not JPEG or extraction failed */ }
      setRawIccProfile(rawIcc);
      setRawXmpXml(xmpXml);
      setIccAction('keep');

      const url = URL.createObjectURL(f);
      const img = new window.Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          setImageInfo({ width: img.naturalWidth, height: img.naturalHeight });
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });

      setPreviewUrl(url);
      setAllData(segments);

      const cats = buildCategories(f, segments, img, rawIcc);
      setCategories(cats);
      setEditedValues({});
      setActiveTab('file');
    } catch (err) {
      console.error('Metadata parse error:', err);
      message.error('Failed to parse metadata');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Build categories ────────────────────────────────────────────────
  const buildCategories = (
    f: File,
    segments: { merged: Record<string, any>; iccData: any; iptcData: any; xmpData: any },
    img: HTMLImageElement,
    rawIcc: Uint8Array | null,
  ): MetadataCategory[] => {
    const d = segments.merged || {};
    const cats: MetadataCategory[] = [];
    const usedKeys = new Set<string>();

    const track = (...keys: string[]) => keys.forEach(k => usedKeys.add(k));

    // ── 1. File Info ──
    cats.push({
      key: 'file', label: 'File Information', icon: <FileImageOutlined />,
      fields: [
        { key: 'f_name', label: 'File Name (download)', value: f.name, editable: true, type: 'text' },
        { key: 'f_size', label: 'File Size', value: formatBytes(f.size), type: 'readonly' },
        { key: 'f_type', label: 'MIME Type', value: f.type || 'Unknown', type: 'readonly' },
        { key: 'f_modified', label: 'Last Modified', value: dayjs(f.lastModified).format('YYYY-MM-DD HH:mm:ss'), type: 'readonly' },
        { key: 'f_width', label: 'Width (px)', value: img.naturalWidth || 'N/A', type: 'readonly' },
        { key: 'f_height', label: 'Height (px)', value: img.naturalHeight || 'N/A', type: 'readonly' },
        { key: 'f_aspect', label: 'Aspect Ratio', value: img.naturalWidth && img.naturalHeight ? (img.naturalWidth / img.naturalHeight).toFixed(3) : 'N/A', type: 'readonly' },
        { key: 'f_megapixels', label: 'Megapixels', value: img.naturalWidth && img.naturalHeight ? ((img.naturalWidth * img.naturalHeight) / 1e6).toFixed(1) + ' MP' : 'N/A', type: 'readonly' },
      ],
    });

    // ── 2. EXIF: Image IFD (IFD0 / 0th) ──
    track('Make', 'Model', 'Software', 'ImageDescription', 'Artist', 'Copyright',
      'Orientation', 'XResolution', 'YResolution', 'ResolutionUnit', 'DateTime',
      'HostComputer', 'YCbCrPositioning', 'ProcessingSoftware', 'Rating', 'RatingPercent',
      'ImageWidth', 'ImageLength');
    cats.push({
      key: 'ifd0', label: 'EXIF: Image (IFD0)', icon: <PictureOutlined />,
      fields: [
        { key: 'ImageDescription', label: 'Image Description', value: d.ImageDescription, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.ImageDescription },
        { key: 'Make', label: 'Camera Make', value: d.Make, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.Make },
        { key: 'Model', label: 'Camera Model', value: d.Model, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.Model },
        { key: 'Orientation', label: 'Orientation', value: d.Orientation, rawValue: typeof d.Orientation === 'string' ? undefined : d.Orientation, editable: true, type: 'select', selectOptions: ORIENTATION_OPTIONS, piexifIFD: '0th', piexifTag: IMG.Orientation },
        { key: 'XResolution', label: 'X Resolution', value: d.XResolution, editable: true, type: 'number', piexifIFD: '0th', piexifTag: IMG.XResolution, writeTransform: 'rational' },
        { key: 'YResolution', label: 'Y Resolution', value: d.YResolution, editable: true, type: 'number', piexifIFD: '0th', piexifTag: IMG.YResolution, writeTransform: 'rational' },
        { key: 'ResolutionUnit', label: 'Resolution Unit', value: d.ResolutionUnit, editable: true, type: 'select', selectOptions: RESOLUTION_UNIT_OPTIONS, piexifIFD: '0th', piexifTag: IMG.ResolutionUnit },
        { key: 'Software', label: 'Software', value: d.Software, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.Software },
        { key: 'DateTime', label: 'DateTime (Modified)', value: d.ModifyDate || d.DateTime, editable: true, type: 'date', piexifIFD: '0th', piexifTag: IMG.DateTime, writeTransform: 'date_exif' },
        { key: 'Artist', label: 'Artist', value: d.Artist, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.Artist },
        { key: 'Copyright', label: 'Copyright', value: d.Copyright, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.Copyright },
        { key: 'HostComputer', label: 'Host Computer', value: d.HostComputer, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.HostComputer },
        { key: 'ProcessingSoftware', label: 'Processing Software', value: d.ProcessingSoftware, editable: true, type: 'text', piexifIFD: '0th', piexifTag: IMG.ProcessingSoftware },
        { key: 'Rating', label: 'Rating (0-5)', value: d.Rating, editable: true, type: 'number', piexifIFD: '0th', piexifTag: IMG.Rating },
        { key: 'RatingPercent', label: 'Rating Percent', value: d.RatingPercent, editable: true, type: 'number', piexifIFD: '0th', piexifTag: IMG.RatingPercent },
        { key: 'YCbCrPositioning', label: 'YCbCr Positioning', value: d.YCbCrPositioning, editable: true, type: 'number', piexifIFD: '0th', piexifTag: IMG.YCbCrPositioning },
        { key: 'ImageWidth', label: 'TIFF Image Width', value: d.ImageWidth, type: 'readonly' },
        { key: 'ImageLength', label: 'TIFF Image Height', value: d.ImageLength, type: 'readonly' },
      ],
    });

    // ── 3. EXIF: Photo (ExifIFD) ──
    track('ExposureTime', 'FNumber', 'ExposureProgram', 'ISO', 'ISOSpeedRatings',
      'ExifVersion', 'DateTimeOriginal', 'CreateDate', 'DateTimeDigitized',
      'ComponentsConfiguration', 'CompressedBitsPerPixel', 'ShutterSpeedValue',
      'ApertureValue', 'BrightnessValue', 'ExposureBiasValue', 'MaxApertureValue',
      'SubjectDistance', 'MeteringMode', 'LightSource', 'Flash', 'FocalLength',
      'SubjectArea', 'UserComment', 'SubSecTime', 'SubSecTimeOriginal',
      'SubSecTimeDigitized', 'FlashpixVersion', 'ColorSpace', 'ExifImageWidth',
      'ExifImageHeight', 'PixelXDimension', 'PixelYDimension',
      'FocalPlaneXResolution', 'FocalPlaneYResolution', 'FocalPlaneResolutionUnit',
      'SensingMethod', 'FileSource', 'SceneType', 'CustomRendered',
      'ExposureMode', 'WhiteBalance', 'DigitalZoomRatio', 'FocalLengthIn35mmFormat',
      'FocalLengthIn35mmFilm', 'SceneCaptureType', 'GainControl', 'Contrast',
      'Saturation', 'Sharpness', 'SubjectDistanceRange',
      'ImageUniqueID', 'CameraOwnerName', 'BodySerialNumber',
      'LensSpecification', 'LensMake', 'LensModel', 'LensSerialNumber', 'Gamma',
      'OffsetTime', 'OffsetTimeOriginal', 'OffsetTimeDigitized', 'ModifyDate');

    const isoVal = d.ISO ?? d.ISOSpeedRatings;
    cats.push({
      key: 'exif', label: 'EXIF: Photo', icon: <CameraOutlined />,
      fields: [
        { key: 'ExposureTime', label: 'Exposure Time', value: d.ExposureTime, rawValue: d.ExposureTime, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.ExposureTime, writeTransform: 'rational' },
        { key: 'FNumber', label: 'F-Number', value: d.FNumber, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.FNumber, writeTransform: 'rational' },
        { key: 'ExposureProgram', label: 'Exposure Program', value: d.ExposureProgram, editable: true, type: 'select', selectOptions: EXPOSURE_PROGRAM_OPTIONS, piexifIFD: 'Exif', piexifTag: EX.ExposureProgram },
        { key: 'ISO', label: 'ISO Speed', value: isoVal, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.ISOSpeedRatings },
        { key: 'DateTimeOriginal', label: 'Date/Time Original', value: d.DateTimeOriginal, editable: true, type: 'date', piexifIFD: 'Exif', piexifTag: EX.DateTimeOriginal, writeTransform: 'date_exif' },
        { key: 'CreateDate', label: 'Date/Time Digitized', value: d.CreateDate || d.DateTimeDigitized, editable: true, type: 'date', piexifIFD: 'Exif', piexifTag: EX.DateTimeDigitized, writeTransform: 'date_exif' },
        { key: 'OffsetTime', label: 'Offset Time', value: d.OffsetTime, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: 36880 },
        { key: 'OffsetTimeOriginal', label: 'Offset Time Original', value: d.OffsetTimeOriginal, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: 36881 },
        { key: 'ShutterSpeedValue', label: 'Shutter Speed (APEX)', value: d.ShutterSpeedValue, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.ShutterSpeedValue, writeTransform: 'rational' },
        { key: 'ApertureValue', label: 'Aperture (APEX)', value: d.ApertureValue, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.ApertureValue, writeTransform: 'rational' },
        { key: 'BrightnessValue', label: 'Brightness', value: d.BrightnessValue, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.BrightnessValue, writeTransform: 'rational' },
        { key: 'ExposureBiasValue', label: 'Exposure Bias', value: d.ExposureBiasValue, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.ExposureBiasValue, writeTransform: 'rational' },
        { key: 'MaxApertureValue', label: 'Max Aperture', value: d.MaxApertureValue, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.MaxApertureValue, writeTransform: 'rational' },
        { key: 'SubjectDistance', label: 'Subject Distance (m)', value: d.SubjectDistance, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.SubjectDistance, writeTransform: 'rational' },
        { key: 'MeteringMode', label: 'Metering Mode', value: d.MeteringMode, editable: true, type: 'select', selectOptions: METERING_MODE_OPTIONS, piexifIFD: 'Exif', piexifTag: EX.MeteringMode },
        { key: 'LightSource', label: 'Light Source', value: d.LightSource, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.LightSource },
        { key: 'Flash', label: 'Flash', value: d.Flash, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.Flash },
        { key: 'FocalLength', label: 'Focal Length (mm)', value: d.FocalLength, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.FocalLength, writeTransform: 'rational' },
        { key: 'UserComment', label: 'User Comment', value: d.UserComment, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.UserComment, writeTransform: 'user_comment' },
        { key: 'SubSecTime', label: 'Sub-second Time', value: d.SubSecTime, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.SubSecTime },
        { key: 'SubSecTimeOriginal', label: 'Sub-second Original', value: d.SubSecTimeOriginal, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.SubSecTimeOriginal },
        { key: 'ColorSpace', label: 'Color Space', value: d.ColorSpace, editable: true, type: 'select', selectOptions: COLOR_SPACE_OPTIONS, piexifIFD: 'Exif', piexifTag: EX.ColorSpace },
        { key: 'ExifImageWidth', label: 'Pixel X Dimension', value: d.ExifImageWidth ?? d.PixelXDimension, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.PixelXDimension },
        { key: 'ExifImageHeight', label: 'Pixel Y Dimension', value: d.ExifImageHeight ?? d.PixelYDimension, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.PixelYDimension },
        { key: 'FocalPlaneXResolution', label: 'Focal Plane X Res', value: d.FocalPlaneXResolution, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.FocalPlaneXResolution, writeTransform: 'rational' },
        { key: 'FocalPlaneYResolution', label: 'Focal Plane Y Res', value: d.FocalPlaneYResolution, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.FocalPlaneYResolution, writeTransform: 'rational' },
        { key: 'SensingMethod', label: 'Sensing Method', value: d.SensingMethod, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.SensingMethod },
        { key: 'FileSource', label: 'File Source', value: d.FileSource, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.FileSource },
        { key: 'SceneType', label: 'Scene Type', value: d.SceneType, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.SceneType },
        { key: 'CustomRendered', label: 'Custom Rendered', value: d.CustomRendered, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.CustomRendered },
        { key: 'ExposureMode', label: 'Exposure Mode', value: d.ExposureMode, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.ExposureMode },
        { key: 'WhiteBalance', label: 'White Balance', value: d.WhiteBalance, editable: true, type: 'select', selectOptions: WHITE_BALANCE_OPTIONS, piexifIFD: 'Exif', piexifTag: EX.WhiteBalance },
        { key: 'DigitalZoomRatio', label: 'Digital Zoom Ratio', value: d.DigitalZoomRatio, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.DigitalZoomRatio, writeTransform: 'rational' },
        { key: 'FocalLengthIn35mmFormat', label: 'Focal Length 35mm', value: d.FocalLengthIn35mmFormat ?? d.FocalLengthIn35mmFilm, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.FocalLengthIn35mmFilm },
        { key: 'SceneCaptureType', label: 'Scene Capture Type', value: d.SceneCaptureType, editable: true, type: 'select', selectOptions: SCENE_CAPTURE_OPTIONS, piexifIFD: 'Exif', piexifTag: EX.SceneCaptureType },
        { key: 'GainControl', label: 'Gain Control', value: d.GainControl, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.GainControl },
        { key: 'Contrast', label: 'Contrast', value: d.Contrast, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.Contrast },
        { key: 'Saturation', label: 'Saturation', value: d.Saturation, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.Saturation },
        { key: 'Sharpness', label: 'Sharpness', value: d.Sharpness, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.Sharpness },
        { key: 'SubjectDistanceRange', label: 'Subject Distance Range', value: d.SubjectDistanceRange, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.SubjectDistanceRange },
        { key: 'ImageUniqueID', label: 'Image Unique ID', value: d.ImageUniqueID, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.ImageUniqueID },
        { key: 'CameraOwnerName', label: 'Camera Owner', value: d.CameraOwnerName, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.CameraOwnerName },
        { key: 'BodySerialNumber', label: 'Body Serial Number', value: d.BodySerialNumber, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.BodySerialNumber },
        { key: 'LensMake', label: 'Lens Make', value: d.LensMake, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.LensMake },
        { key: 'LensModel', label: 'Lens Model', value: d.LensModel, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.LensModel },
        { key: 'LensSerialNumber', label: 'Lens Serial Number', value: d.LensSerialNumber, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.LensSerialNumber },
        { key: 'LensSpecification', label: 'Lens Specification', value: d.LensSpecification, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: 42034 },
        { key: 'Gamma', label: 'Gamma', value: d.Gamma, editable: true, type: 'number', piexifIFD: 'Exif', piexifTag: EX.Gamma, writeTransform: 'rational' },
        { key: 'ExifVersion', label: 'EXIF Version', value: d.ExifVersion, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.ExifVersion },
        { key: 'FlashpixVersion', label: 'Flashpix Version', value: d.FlashpixVersion, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: EX.FlashpixVersion },
        { key: 'ComponentsConfiguration', label: 'Components Config', value: d.ComponentsConfiguration, editable: true, type: 'text', piexifIFD: 'Exif', piexifTag: 37121 },
      ],
    });

    // ── 4. GPS ──
    track('latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef',
      'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'GPSTimeStamp',
      'GPSDateStamp', 'GPSSpeed', 'GPSSpeedRef', 'GPSImgDirection',
      'GPSImgDirectionRef', 'GPSMapDatum', 'GPSProcessingMethod',
      'GPSVersionID', 'GPSDestBearing', 'GPSDestBearingRef',
      'GPSHPositioningError');
    cats.push({
      key: 'gps', label: 'GPS', icon: <EnvironmentOutlined />,
      fields: [
        { key: 'latitude', label: 'Latitude', value: d.latitude, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSLatitude, writeTransform: 'gps_lat' },
        { key: 'longitude', label: 'Longitude', value: d.longitude, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSLongitude, writeTransform: 'gps_lng' },
        { key: 'GPSFormatted', label: 'Coordinates (formatted)', value: formatGPS(d.latitude, d.longitude), type: 'readonly' },
        { key: 'GPSAltitude', label: 'Altitude (m)', value: d.GPSAltitude, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSAltitude, writeTransform: 'gps_alt' },
        { key: 'GPSAltitudeRef', label: 'Altitude Ref (0=above, 1=below)', value: d.GPSAltitudeRef, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSAltitudeRef },
        { key: 'GPSSpeed', label: 'Speed', value: d.GPSSpeed, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSSpeed, writeTransform: 'rational' },
        { key: 'GPSSpeedRef', label: 'Speed Unit (K/M/N)', value: d.GPSSpeedRef, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: GPS.GPSSpeedRef },
        { key: 'GPSImgDirection', label: 'Image Direction', value: d.GPSImgDirection, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSImgDirection, writeTransform: 'rational' },
        { key: 'GPSImgDirectionRef', label: 'Direction Ref (T/M)', value: d.GPSImgDirectionRef, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: GPS.GPSImgDirectionRef },
        { key: 'GPSDateStamp', label: 'GPS Date', value: d.GPSDateStamp, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: GPS.GPSDateStamp },
        { key: 'GPSMapDatum', label: 'Map Datum', value: d.GPSMapDatum, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: GPS.GPSMapDatum },
        { key: 'GPSVersionID', label: 'GPS Version', value: d.GPSVersionID, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: GPS.GPSVersionID },
        { key: 'GPSHPositioningError', label: 'H Positioning Error', value: d.GPSHPositioningError, editable: true, type: 'number', piexifIFD: 'GPS', piexifTag: GPS.GPSHPositioningError, writeTransform: 'rational' },
        { key: 'GPSTimeStamp', label: 'GPS Time', value: d.GPSTimeStamp, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: GPS.GPSTimeStamp },
        { key: 'GPSProcessingMethod', label: 'Processing Method', value: d.GPSProcessingMethod, editable: true, type: 'text', piexifIFD: 'GPS', piexifTag: 27 },
      ],
    });

    // ── 5. EXIF: Thumbnail (IFD1) ──
    track('ThumbnailOffset', 'ThumbnailLength', 'ThumbnailImage', 'thumbnail');
    cats.push({
      key: 'ifd1', label: 'EXIF: Thumbnail (IFD1)', icon: <FileImageOutlined />,
      fields: [
        { key: 'ThumbnailOffset', label: 'Thumbnail Offset', value: d.ThumbnailOffset, type: 'readonly' },
        { key: 'ThumbnailLength', label: 'Thumbnail Length', value: d.ThumbnailLength, type: 'readonly' },
        { key: 'thumb_present', label: 'Thumbnail Present', value: d.thumbnail ? 'Yes' : 'No', type: 'readonly' },
      ],
    });

    // ── 6. ICC Profile ──
    // Source A: raw binary extraction → full header parse
    const iccParsed = rawIcc ? parseIccProfile(rawIcc) : null;
    // Source B: exifr ICC data (fallback if binary extraction fails)
    const iccExifr = segments.iccData || {};
    const addedIccKeys = new Set<string>();
    const iccFields: MetadataField[] = [];

    if (iccParsed) {
      // Binary parse succeeded – show all header fields
      const rows: [string, string, string][] = [
        ['icc_cmm', 'Profile CMM Type', iccParsed.cmmType],
        ['icc_ver', 'Profile Version', iccParsed.version],
        ['icc_class', 'Profile Class', iccParsed.profileClass],
        ['icc_cs', 'Color Space Data', iccParsed.colorSpaceData],
        ['icc_pcs', 'Profile Connection Space', iccParsed.connectionSpace],
        ['icc_date', 'Profile Date Time', iccParsed.dateTime],
        ['icc_sig', 'Profile File Signature', iccParsed.fileSignature],
        ['icc_plat', 'Primary Platform', iccParsed.primaryPlatform],
        ['icc_flags', 'CMM Flags', iccParsed.cmmFlags],
        ['icc_mfg', 'Device Manufacturer', iccParsed.deviceManufacturer],
        ['icc_mdl', 'Device Model', iccParsed.deviceModel],
        ['icc_attr', 'Device Attributes', iccParsed.deviceAttributes],
        ['icc_intent', 'Rendering Intent', iccParsed.renderingIntent],
        ['icc_illum', 'Connection Space Illuminant', iccParsed.connectionSpaceIlluminant],
        ['icc_creator', 'Profile Creator', iccParsed.profileCreator],
        ['icc_id', 'Profile ID', iccParsed.profileId],
        ['icc_desc', 'Profile Description', iccParsed.profileDescription],
      ];
      if (iccParsed.copyright) rows.push(['icc_cprt', 'Copyright', iccParsed.copyright]);
      if (iccParsed.technology) rows.push(['icc_tech', 'Technology', iccParsed.technology]);
      rows.push(['icc_size', 'Profile Size', iccParsed.profileSize]);
      rows.push(['icc_tags', 'Tag Count', String(iccParsed.tagCount)]);
      if (iccParsed.tagList.length > 0) {
        rows.push(['icc_taglist', 'Tags', iccParsed.tagList.join(', ')]);
      }
      for (const [key, label, value] of rows) {
        iccFields.push({ key, label, value: value || '', type: 'readonly' });
        addedIccKeys.add(key);
      }
      // Add multi-language (mluc) entries
      for (const [tagName, entries] of Object.entries(iccParsed.mlEntries)) {
        // Skip first entry if it matches the primary description/copyright already shown
        const skip = (tagName === 'Profile Description' && entries.length > 0 && entries[0].text === iccParsed.profileDescription)
          || (tagName === 'Copyright' && entries.length > 0 && entries[0].text === iccParsed.copyright);
        const startIdx = skip ? 1 : 0;
        for (let ei = startIdx; ei < entries.length; ei++) {
          const e = entries[ei];
          const langLabel = e.lang ? ` ML (${e.lang})` : ` ML [${ei}]`;
          iccFields.push({
            key: `icc_ml_${tagName}_${ei}`,
            label: `${tagName}${langLabel}`,
            value: e.text,
            type: 'readonly',
          });
        }
      }
    } else {
      // Fallback: use exifr's parsed ICC data + merged data
      const iccFallbackKeys: [string, string][] = [
        ['ProfileDescription', 'Profile Description'],
        ['ProfileVersion', 'Profile Version'],
        ['ProfileClass', 'Profile Class'],
        ['ColorSpaceData', 'Color Space Data'],
        ['ProfileConnectionSpace', 'Profile Connection Space'],
        ['ProfileDateTime', 'Profile Date Time'],
        ['ProfileFileSignature', 'Profile File Signature'],
        ['PrimaryPlatform', 'Primary Platform'],
        ['DeviceManufacturer', 'Device Manufacturer'],
        ['DeviceModel', 'Device Model'],
        ['RenderingIntent', 'Rendering Intent'],
        ['ConnectionSpaceIlluminant', 'Connection Space Illuminant'],
        ['ProfileCreator', 'Profile Creator'],
        ['DeviceModelDesc', 'Device Model Description'],
        ['Technology', 'Technology'],
        ['ViewingCondDesc', 'Viewing Conditions'],
        ['Luminance', 'Luminance'],
        ['MediaWhitePoint', 'Media White Point'],
        ['MediaBlackPoint', 'Media Black Point'],
        ['RedMatrixColumn', 'Red Matrix Column'],
        ['GreenMatrixColumn', 'Green Matrix Column'],
        ['BlueMatrixColumn', 'Blue Matrix Column'],
        ['RedTRC', 'Red TRC'],
        ['GreenTRC', 'Green TRC'],
        ['BlueTRC', 'Blue TRC'],
        ['ChromaticAdaptation', 'Chromatic Adaptation'],
        ['MeasurementObserver', 'Measurement Observer'],
        ['MeasurementBacking', 'Measurement Backing'],
        ['MeasurementGeometry', 'Measurement Geometry'],
        ['MeasurementFlare', 'Measurement Flare'],
        ['MeasurementIlluminant', 'Measurement Illuminant'],
      ];

      // Check exifr ICC data first, then merged data
      for (const [key, label] of iccFallbackKeys) {
        const val = iccExifr[key] ?? d[key];
        if (val != null) {
          iccFields.push({ key: `icc_${key}`, label, value: val, type: 'readonly' });
          addedIccKeys.add(key);
        }
      }
      // Also add any other exifr ICC keys not in the known list
      for (const [k, v] of Object.entries(iccExifr)) {
        if (v != null && !addedIccKeys.has(k)) {
          iccFields.push({ key: `icc_${k}`, label: k, value: v, type: 'readonly' });
          addedIccKeys.add(k);
        }
      }
    }

    // Suppress ICC keys from "Other" tab
    const iccMergedKeys = [
      'ProfileVersion', 'ProfileClass', 'ColorSpaceData', 'ProfileConnectionSpace',
      'ProfileDateTime', 'ProfileFileSignature', 'PrimaryPlatform', 'ProfileCreator',
      'DeviceManufacturer', 'DeviceModel', 'RenderingIntent', 'ConnectionSpaceIlluminant',
      'ProfileDescription', 'DeviceModelDesc', 'ViewingCondDesc', 'Luminance',
      'MeasurementObserver', 'MeasurementBacking', 'MeasurementGeometry',
      'MeasurementFlare', 'MeasurementIlluminant', 'Technology', 'MediaWhitePoint',
      'MediaBlackPoint', 'RedMatrixColumn', 'GreenMatrixColumn', 'BlueMatrixColumn',
      'RedTRC', 'GreenTRC', 'BlueTRC', 'ChromaticAdaptation',
    ];
    iccMergedKeys.forEach(k => usedKeys.add(k));

    cats.push({
      key: 'icc', label: 'ICC Profile', icon: <BgColorsOutlined />,
      badge: iccFields.filter(f => f.value != null && f.value !== '').length,
      fields: iccFields.length > 0 ? iccFields : [
        { key: 'icc_none', label: 'Status', value: 'No ICC profile embedded in this image', type: 'readonly' },
      ],
    });

    // ── 7. IPTC ──
    const iptc = segments.iptcData || {};
    const iptcAllKeys = [
      'ObjectName', 'Urgency', 'Category', 'SupplementalCategories',
      'Keywords', 'SpecialInstructions', 'DateCreated', 'TimeCreated',
      'Byline', 'BylineTitle', 'City', 'SubLocation', 'ProvinceState',
      'CountryPrimaryLocationCode', 'CountryPrimaryLocationName',
      'Headline', 'Credit', 'Source', 'CopyrightNotice', 'Caption',
      'WriterEditor', 'DigitalCreationDate', 'DigitalCreationTime',
    ];
    const iptcFields: MetadataField[] = [];
    const addedIptcKeys = new Set<string>();

    for (const [k, v] of Object.entries(iptc)) {
      if (v != null && !addedIptcKeys.has(k)) {
        iptcFields.push({ key: `iptc_${k}`, label: k, value: v, type: 'readonly' });
        addedIptcKeys.add(k);
        usedKeys.add(k);
      }
    }

    for (const k of iptcAllKeys) {
      if (d[k] != null && !addedIptcKeys.has(k)) {
        iptcFields.push({ key: `iptc_${k}`, label: k, value: d[k], type: 'readonly' });
        addedIptcKeys.add(k);
        usedKeys.add(k);
      }
    }

    cats.push({
      key: 'iptc', label: 'IPTC', icon: <TagsOutlined />,
      badge: iptcFields.filter(f => f.value != null).length,
      fields: iptcFields.length > 0 ? iptcFields : [
        { key: 'iptc_none', label: 'Status', value: 'No IPTC data found', type: 'readonly' },
      ],
    });

    // ── 8. XMP ──
    const xmp = segments.xmpData || {};
    // Editable XMP fields (key → [label, type])
    const xmpEditableKeys: Record<string, [string, MetadataField['type']]> = {
      'title': ['Title', 'text'],
      'description': ['Description', 'text'],
      'creator': ['Creator', 'text'],
      'subject': ['Subject / Keywords', 'text'],
      'rights': ['Rights', 'text'],
      'Rating': ['Rating', 'number'],
      'Label': ['Label', 'text'],
      'CreatorTool': ['Creator Tool', 'text'],
      'CreateDate': ['Create Date', 'text'],
      'ModifyDate': ['Modify Date', 'text'],
      'MetadataDate': ['Metadata Date', 'text'],
      'DateCreated': ['Date Created (Photoshop)', 'text'],
      'Artist': ['Artist (TIFF)', 'text'],
      'Copyright': ['Copyright (TIFF)', 'text'],
      'ImageDescription': ['Image Description (TIFF)', 'text'],
    };
    const xmpReadonlyKeys = [
      'Format', 'DocumentID', 'InstanceID', 'OriginalDocumentID',
    ];
    const xmpFields: MetadataField[] = [];
    const addedXmpKeys = new Set<string>();
    const hasXmpSource = rawXmpXml != null; // can we write back?

    // Add editable fields first (known keys)
    for (const [k, [label, fieldType]] of Object.entries(xmpEditableKeys)) {
      const val = xmp[k] ?? d[k];
      const displayVal = Array.isArray(val) ? val.join(', ') : val;
      xmpFields.push({
        key: `xmp_${k}`,
        label,
        value: displayVal,
        editable: hasXmpSource,
        type: fieldType,
      });
      addedXmpKeys.add(k);
      usedKeys.add(k);
    }

    // Add readonly fields
    for (const k of xmpReadonlyKeys) {
      const val = xmp[k] ?? d[k];
      if (val != null) {
        xmpFields.push({ key: `xmp_${k}`, label: k, value: val, type: 'readonly' });
        addedXmpKeys.add(k);
        usedKeys.add(k);
      }
    }

    // Add any remaining XMP keys from exifr
    for (const [k, v] of Object.entries(xmp)) {
      if (v != null && !addedXmpKeys.has(k)) {
        xmpFields.push({ key: `xmp_${k}`, label: k, value: v, type: 'readonly' });
        addedXmpKeys.add(k);
        usedKeys.add(k);
      }
    }

    cats.push({
      key: 'xmp', label: 'XMP', icon: <DatabaseOutlined />,
      badge: xmpFields.filter(f => f.value != null && f.value !== '' && f.value !== undefined).length,
      fields: xmpFields.length > 0 ? xmpFields : [
        { key: 'xmp_none', label: 'Status', value: 'No XMP data found', type: 'readonly' },
      ],
    });

    // ── 9. All Raw Data (everything not yet shown) ──
    const allUsed = new Set(Array.from(usedKeys).concat(Array.from(addedIccKeys), Array.from(addedIptcKeys), Array.from(addedXmpKeys)));
    // Also add the field keys from above
    cats.forEach(c => c.fields.forEach(f => allUsed.add(f.key)));

    const extraFields: MetadataField[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (!allUsed.has(k) && v != null && k !== 'thumbnail' && k !== 'MakerNote' && k !== 'errors') {
        extraFields.push({ key: `raw_${k}`, label: k, value: v, type: 'readonly' });
      }
    }

    if (extraFields.length > 0) {
      cats.push({
        key: 'raw', label: 'Other / Raw', icon: <InfoCircleOutlined />,
        badge: extraFields.length,
        fields: extraFields,
      });
    }

    // Add badge counts
    cats.forEach(c => {
      if (c.badge === undefined) {
        c.badge = c.fields.filter(f => f.value != null && f.value !== '' && f.value !== 'N/A').length;
      }
    });

    return cats;
  };

  // ── Handle file ─────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith('image/')) {
      message.error('Please select an image file');
      return;
    }
    setFile(f);
    parseMetadata(f);
  }, [parseMetadata]);

  // ── Edit ────────────────────────────────────────────────────────────
  const handleEdit = (fieldKey: string, value: any) => {
    setEditedValues(prev => ({ ...prev, [fieldKey]: value }));
  };

  const hasEdits = Object.keys(editedValues).length > 0 || iccAction !== 'keep' || xmpAction !== 'keep';

  // ── Download with edits ─────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    if (!file) return;

    const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';
    if (!isJpeg) {
      message.warning('EXIF editing is only supported for JPEG files. Downloading original.');
      const url = URL.createObjectURL(file);
      triggerDownload(url, file.name);
      URL.revokeObjectURL(url);
      return;
    }

    try {
      setLoading(true);
      const arrayBuffer = await file.arrayBuffer();
      const dataUrl = 'data:image/jpeg;base64,' + arrayBufferToBase64(arrayBuffer);

      let exifObj: any;
      try {
        exifObj = getPiexif().load(dataUrl);
      } catch {
        exifObj = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, Interop: {} };
      }

      // Apply all edits
      for (const cat of categories) {
        for (const field of cat.fields) {
          if (!field.editable || !field.piexifIFD || field.piexifTag == null) continue;
          if (editedValues[field.key] === undefined) continue;

          const val = editedValues[field.key];
          const ifd = field.piexifIFD;
          const tag = field.piexifTag;

          if (!exifObj[ifd]) exifObj[ifd] = {};

          switch (field.writeTransform) {
            case 'gps_lat': {
              if (val != null) {
                const lat = Number(val);
                exifObj.GPS[GPS.GPSLatitude] = decimalToDMS(lat);
                exifObj.GPS[GPS.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
              }
              break;
            }
            case 'gps_lng': {
              if (val != null) {
                const lng = Number(val);
                exifObj.GPS[GPS.GPSLongitude] = decimalToDMS(lng);
                exifObj.GPS[GPS.GPSLongitudeRef] = lng >= 0 ? 'E' : 'W';
              }
              break;
            }
            case 'gps_alt': {
              if (val != null) {
                const alt = Number(val);
                exifObj.GPS[GPS.GPSAltitude] = toRational(Math.abs(alt));
                exifObj.GPS[GPS.GPSAltitudeRef] = alt >= 0 ? 0 : 1;
              }
              break;
            }
            case 'date_exif': {
              const dVal = dayjs(val);
              if (dVal.isValid()) {
                exifObj[ifd][tag] = dVal.format('YYYY:MM:DD HH:mm:ss');
              }
              break;
            }
            case 'user_comment': {
              exifObj[ifd][tag] = val ? `ASCII\0\0\0${val}` : '';
              break;
            }
            case 'rational': {
              const num = Number(val);
              if (!isNaN(num)) {
                exifObj[ifd][tag] = toRational(num);
              }
              break;
            }
            default: {
              // Direct write – number or string
              if (field.type === 'number' || field.type === 'select') {
                const num = Number(val);
                exifObj[ifd][tag] = isNaN(num) ? val : num;
              } else {
                exifObj[ifd][tag] = val ?? '';
              }
            }
          }
        }
      }

      const px = getPiexif();
      const exifBytes = px.dump(exifObj);
      const newDataUrl = px.insert(exifBytes, dataUrl);

      // Convert to Uint8Array for ICC and XMP manipulation
      const intermediateBlob = dataURLToBlob(newDataUrl);
      let jpegBuf = new Uint8Array(await intermediateBlob.arrayBuffer());

      // Apply XMP action
      if (xmpAction === 'remove') {
        jpegBuf = removeXmpFromJpeg(jpegBuf);
      } else {
        // Apply individual XMP edits
        const xmpEdits = Object.entries(editedValues).filter(([k]) => k.startsWith('xmp_'));
        if (xmpEdits.length > 0 && rawXmpXml) {
          let modifiedXml = rawXmpXml;
          for (const [key, val] of xmpEdits) {
            modifiedXml = modifyXmpValue(modifiedXml, key, String(val ?? ''));
          }
          jpegBuf = replaceXmpInJpeg(jpegBuf, modifiedXml);
        }
      }

      // Apply ICC action
      if (iccAction === 'remove') {
        jpegBuf = removeIccFromJpeg(jpegBuf);
      }

      const finalBlob = new Blob([jpegBuf], { type: 'image/jpeg' });
      const url = URL.createObjectURL(finalBlob);
      // Use custom filename if edited, otherwise default
      const customName = editedValues['f_name'];
      let downloadName: string;
      if (customName) {
        downloadName = String(customName);
      } else {
        const ext = file.name.lastIndexOf('.');
        const baseName = ext > 0 ? file.name.substring(0, ext) : file.name;
        downloadName = `${baseName}_edited.jpg`;
      }
      triggerDownload(url, downloadName);
      URL.revokeObjectURL(url);

      const actions: string[] = [];
      const exifEditCount = Object.keys(editedValues).filter(k => !k.startsWith('xmp_')).length;
      const xmpEditCount = Object.keys(editedValues).filter(k => k.startsWith('xmp_')).length;
      if (exifEditCount > 0) actions.push('EXIF modified');
      if (xmpAction === 'remove') actions.push('XMP removed');
      else if (xmpEditCount > 0) actions.push(`XMP modified (${xmpEditCount})`);
      if (iccAction === 'remove') actions.push('ICC removed');
      message.success(`Image downloaded (${actions.join(', ') || 'no changes'})`);
    } catch (err) {
      console.error('EXIF write error:', err);
      message.error('Failed to write metadata. Downloading original.');
      const url = URL.createObjectURL(file);
      triggerDownload(url, file.name);
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }, [file, categories, editedValues, iccAction, rawXmpXml]);

  // ── Strip all metadata ──────────────────────────────────────────────
  const handleStripAndDownload = useCallback(async () => {
    if (!file) return;
    try {
      setLoading(true);
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available');
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const blobUrl = URL.createObjectURL(blob);
        const ext = file.name.lastIndexOf('.');
        const baseName = ext > 0 ? file.name.substring(0, ext) : file.name;
        triggerDownload(blobUrl, `${baseName}_stripped.jpg`);
        URL.revokeObjectURL(blobUrl);
        URL.revokeObjectURL(url);
        message.success('All metadata stripped (EXIF, ICC, IPTC, XMP removed)');
        setLoading(false);
      }, 'image/jpeg', 0.95);
    } catch (err) {
      console.error('Strip error:', err);
      message.error('Failed to strip metadata');
      setLoading(false);
    }
  }, [file]);

  // ── Copy JSON ───────────────────────────────────────────────────────
  const handleCopyJSON = useCallback(() => {
    if (!allData) return;
    const clean: Record<string, any> = {};
    const all = { ...allData.merged, icc: allData.iccData, iptc: allData.iptcData, xmp: allData.xmpData };
    for (const [k, v] of Object.entries(all)) {
      if (k === 'thumbnail' || k === 'MakerNote') continue;
      clean[k] = v instanceof Date ? v.toISOString() : v;
    }
    navigator.clipboard.writeText(JSON.stringify(clean, null, 2));
    message.success('All metadata copied to clipboard');
  }, [allData]);

  const handleReset = () => { setEditedValues({}); setIccAction('keep'); setXmpAction('keep'); };

  // ── Import JSON modal state ─────────────────────────────────────────
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJson, setImportJson] = useState('');

  const handleImportJSON = useCallback(() => {
    if (!importJson.trim()) {
      message.warning('Please paste JSON data');
      return;
    }

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      message.error('Invalid JSON format');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      message.error('JSON must be a key-value object');
      return;
    }

    // Build a lookup: field.key -> field, also by field.label (case-insensitive)
    const fieldByKey = new Map<string, MetadataField>();
    const fieldByLabel = new Map<string, MetadataField>();
    for (const cat of categories) {
      for (const field of cat.fields) {
        if (!field.editable) continue;
        fieldByKey.set(field.key, field);
        fieldByLabel.set(field.label.toLowerCase(), field);
      }
    }

    const newEdits: Record<string, any> = { ...editedValues };
    let matched = 0;
    let skipped = 0;

    for (const [jsonKey, jsonVal] of Object.entries(parsed)) {
      if (jsonVal == null) continue;

      // Try to match by field.key first, then by label
      let field = fieldByKey.get(jsonKey);
      if (!field) {
        field = fieldByLabel.get(jsonKey.toLowerCase());
      }
      // Also try common aliases
      if (!field) {
        const aliases: Record<string, string> = {
          'DateTimeOriginal': 'DateTimeOriginal',
          'DateTaken': 'DateTimeOriginal',
          'Date Taken': 'DateTimeOriginal',
          'DateCreated': 'CreateDate',
          'Date Created': 'CreateDate',
          'DateTimeDigitized': 'CreateDate',
          'DateModified': 'DateTime',
          'Date Modified': 'DateTime',
          'ModifyDate': 'DateTime',
          'Latitude': 'latitude',
          'lat': 'latitude',
          'Longitude': 'longitude',
          'lng': 'longitude',
          'lon': 'longitude',
          'Description': 'ImageDescription',
          'Comment': 'UserComment',
          'Author': 'Artist',
          'CameraMake': 'Make',
          'Camera Make': 'Make',
          'CameraModel': 'Model',
          'Camera Model': 'Model',
          'FStop': 'FNumber',
          'f-number': 'FNumber',
          'ISOSpeed': 'ISO',
          'ISOSpeedRatings': 'ISO',
          'Aperture': 'FNumber',
          'Owner': 'CameraOwnerName',
          'CameraOwner': 'CameraOwnerName',
          'GPSAltitude': 'GPSAltitude',
          'Altitude': 'GPSAltitude',
        };
        const alias = aliases[jsonKey];
        if (alias) field = fieldByKey.get(alias);
      }

      if (!field) {
        skipped++;
        continue;
      }

      // Convert value for the field type
      let converted: any = jsonVal;
      if (field.type === 'date') {
        const d = dayjs(jsonVal);
        converted = d.isValid() ? d.toISOString() : jsonVal;
      } else if (field.type === 'number') {
        const num = Number(jsonVal);
        converted = isNaN(num) ? jsonVal : num;
      } else if (field.type === 'select') {
        // Try to match by value or by label text
        const numVal = Number(jsonVal);
        if (field.selectOptions?.some(o => o.value === jsonVal)) {
          converted = jsonVal;
        } else if (!isNaN(numVal) && field.selectOptions?.some(o => o.value === numVal)) {
          converted = numVal;
        } else {
          // Try matching by label text
          const match = field.selectOptions?.find(o =>
            o.label.toLowerCase().includes(String(jsonVal).toLowerCase())
          );
          converted = match ? match.value : jsonVal;
        }
      } else {
        converted = String(jsonVal);
      }

      newEdits[field.key] = converted;
      matched++;
    }

    setEditedValues(newEdits);
    setImportModalOpen(false);
    setImportJson('');

    if (matched > 0) {
      message.success(`${matched} field(s) imported${skipped > 0 ? `, ${skipped} key(s) skipped (read-only or unknown)` : ''}`);
    } else {
      message.warning(`No matching editable fields found. ${skipped} key(s) were read-only or unrecognized.`);
    }
  }, [importJson, categories, editedValues]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setImportJson(text);
        message.success('Pasted from clipboard');
      }
    } catch {
      message.error('Unable to read clipboard. Please paste manually.');
    }
  }, []);

  // ── Render field value ──────────────────────────────────────────────
  const renderFieldValue = (field: MetadataField) => {
    const isEdited = editedValues[field.key] !== undefined;
    const currentVal = isEdited ? editedValues[field.key] : (field.rawValue !== undefined ? field.rawValue : field.value);

    if (!field.editable) {
      const display = formatValue(field.value);
      if (!display) return <Text type="secondary">-</Text>;
      return <Text style={{ wordBreak: 'break-all' }} copyable={display.length > 10 ? { text: display } : undefined}>{display}</Text>;
    }

    if (field.type === 'select' && field.selectOptions) {
      return (
        <Select
          value={currentVal}
          onChange={(v) => handleEdit(field.key, v)}
          style={{ width: '100%' }}
          size="small"
          allowClear
          placeholder={field.label}
          options={field.selectOptions}
        />
      );
    }

    if (field.type === 'date') {
      const dateVal = currentVal ? dayjs(currentVal) : null;
      return (
        <DatePicker
          showTime
          value={dateVal?.isValid() ? dateVal : null}
          onChange={(v) => handleEdit(field.key, v?.toISOString())}
          style={{ width: '100%' }}
          placeholder="Select date/time"
          size="small"
        />
      );
    }

    if (field.type === 'number') {
      const isGps = field.key === 'latitude' || field.key === 'longitude';
      return (
        <InputNumber
          value={currentVal}
          onChange={(v) => handleEdit(field.key, v)}
          style={{ width: '100%' }}
          step={isGps ? 0.000001 : field.writeTransform === 'rational' ? 0.1 : 1}
          precision={isGps ? 6 : field.writeTransform === 'rational' ? 2 : undefined}
          placeholder={field.label}
          size="small"
        />
      );
    }

    // text
    return (
      <Input
        value={currentVal ?? ''}
        onChange={(e) => handleEdit(field.key, e.target.value)}
        placeholder={field.label}
        size="small"
        suffix={isEdited ? <Tag color="blue" style={{ marginRight: 0, fontSize: 10 }}>edited</Tag> : undefined}
      />
    );
  };

  // ── Tab items ───────────────────────────────────────────────────────
  const tabItems = categories.map(cat => {
    const editableCount = cat.fields.filter(f => f.editable).length;
    const editedCount = cat.fields.filter(f => editedValues[f.key] !== undefined).length;

    return {
      key: cat.key,
      label: (
        <Space size={4}>
          {cat.icon}
          <span>{cat.label}</span>
          {cat.badge != null && cat.badge > 0 && (
            <Badge count={cat.badge} size="small" style={{ backgroundColor: '#52c41a' }} overflowCount={99} />
          )}
          {editedCount > 0 && (
            <Badge count={editedCount} size="small" style={{ backgroundColor: '#1890ff' }} overflowCount={99} />
          )}
        </Space>
      ),
      children: (
        <div>
          {editableCount > 0 && (
            <div style={{ marginBottom: 8, fontSize: 12, color: '#8c8c8c' }}>
              <EditOutlined style={{ color: '#1890ff', marginRight: 4 }} />
              {editableCount} editable field(s) in this section
              {editedCount > 0 && <Tag color="blue" style={{ marginLeft: 8 }}>{editedCount} modified</Tag>}
            </div>
          )}
          {/* ICC Profile action controls */}
          {cat.key === 'icc' && rawIccProfile && (
            <div style={{
              padding: '10px 14px', marginBottom: 12, borderRadius: 6,
              background: iccAction !== 'keep' ? '#fff7e6' : '#f6ffed',
              border: `1px solid ${iccAction !== 'keep' ? '#ffd591' : '#b7eb8f'}`,
            }}>
              <Space>
                <Text strong style={{ fontSize: 13 }}>ICC Action:</Text>
                <Select
                  value={iccAction}
                  onChange={setIccAction}
                  options={ICC_ACTION_OPTIONS}
                  size="small"
                  style={{ width: 200 }}
                />
                {iccAction === 'remove' && (
                  <Tag color="warning">ICC profile will be removed on download</Tag>
                )}
              </Space>
            </div>
          )}
          {cat.key === 'xmp' && rawXmpXml && (
            <div style={{
              padding: '10px 14px', marginBottom: 12, borderRadius: 6,
              background: xmpAction !== 'keep' ? '#fff1f0' : '#f6ffed',
              border: `1px solid ${xmpAction !== 'keep' ? '#ffa39e' : '#b7eb8f'}`,
            }}>
              <Space>
                <Text strong style={{ fontSize: 13 }}>XMP Action:</Text>
                <Select
                  value={xmpAction}
                  onChange={setXmpAction}
                  options={[
                    { label: 'Keep / Edit', value: 'keep' },
                    { label: 'Remove All XMP', value: 'remove' },
                  ]}
                  size="small"
                  style={{ width: 200 }}
                />
                {xmpAction === 'remove' && (
                  <Tag color="error">All XMP data will be removed on download</Tag>
                )}
              </Space>
            </div>
          )}
          <Descriptions
            bordered
            size="small"
            column={1}
            styles={{ label: { width: 200, fontWeight: 500, background: '#fafafa', fontSize: 13 }, content: { minWidth: 200 } }}
          >
            {cat.fields
              .filter(f => f.value != null || f.editable)
              .map(field => (
                <Descriptions.Item
                  key={field.key}
                  label={
                    <Space size={4}>
                      <span>{field.label}</span>
                      {field.editable && (
                        <Tooltip title="Editable – changes will be written to EXIF">
                          <EditOutlined style={{ color: '#1890ff', fontSize: 11 }} />
                        </Tooltip>
                      )}
                      {editedValues[field.key] !== undefined && (
                        <Tooltip title="Click to revert">
                          <Tag
                            color="blue"
                            style={{ cursor: 'pointer', fontSize: 10, marginLeft: 2 }}
                            closable
                            onClose={(e) => { e.preventDefault(); setEditedValues(prev => { const n = { ...prev }; delete n[field.key]; return n; }); }}
                          >
                            modified
                          </Tag>
                        </Tooltip>
                      )}
                    </Space>
                  }
                >
                  {renderFieldValue(field)}
                </Descriptions.Item>
              ))}
            {cat.fields.filter(f => f.value != null || f.editable).length === 0 && (
              <Descriptions.Item label="No data">
                <Text type="secondary">No metadata found in this segment</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>
      ),
    };
  });

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <FileImageOutlined /> Photo Metadata Viewer & Editor
        </Title>
        <Text type="secondary">
          EXIF (IFD0 + ExifIFD) / GPS / ICC Profile / IPTC / XMP — view all segments, edit EXIF fields, download modified image
        </Text>
      </Space>

      <Row gutter={[20, 20]}>
        {/* Left panel */}
        <Col xs={24} lg={7}>
          <Card size="small" title="Image" style={{ position: 'sticky', top: 80 }}>
            {!file ? (
              <Dragger
                accept="image/*"
                showUploadList={false}
                beforeUpload={(f) => { handleFile(f); return false; }}
                style={{ padding: 20 }}
              >
                <p className="ant-upload-drag-icon"><UploadOutlined style={{ fontSize: 48, color: '#1890ff' }} /></p>
                <p className="ant-upload-text">Click or drag an image here</p>
                <p className="ant-upload-hint">JPEG, PNG, TIFF, WebP, HEIC</p>
              </Dragger>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {previewUrl && (
                  <Image
                    src={previewUrl}
                    alt="Preview"
                    style={{ width: '100%', borderRadius: 8, maxHeight: 280, objectFit: 'contain' }}
                  />
                )}

                {imageInfo && (
                  <div style={{ textAlign: 'center' }}>
                    <Tag>{imageInfo.width} x {imageInfo.height}</Tag>
                    <Tag>{file.type.split('/')[1]?.toUpperCase()}</Tag>
                    <Tag>{formatBytes(file.size)}</Tag>
                  </div>
                )}

                {/* Segment summary */}
                {categories.length > 0 && (
                  <div style={{ fontSize: 12, color: '#666', lineHeight: '22px' }}>
                    {categories.filter(c => (c.badge ?? 0) > 0).map(c => (
                      <Tag
                        key={c.key}
                        style={{ cursor: 'pointer', marginBottom: 4 }}
                        onClick={() => setActiveTab(c.key)}
                      >
                        {c.label.replace(/EXIF: /, '')}: {c.badge}
                      </Tag>
                    ))}
                  </div>
                )}

                <Divider style={{ margin: '4px 0' }} />

                <Space direction="vertical" style={{ width: '100%' }} size={6}>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    block
                    onClick={handleDownload}
                    disabled={!hasEdits}
                    loading={loading}
                  >
                    {hasEdits
                      ? `Download${Object.keys(editedValues).length > 0 ? ` (${Object.keys(editedValues).length} edits)` : ''}${iccAction !== 'keep' ? ' + ICC remove' : ''}${xmpAction !== 'keep' ? ' + XMP remove' : ''}`
                      : 'No Edits Yet'}
                  </Button>

                  <Button
                    icon={<DownloadOutlined />}
                    block
                    onClick={() => {
                      if (!file) return;
                      const url = URL.createObjectURL(file);
                      triggerDownload(url, file.name);
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download Original
                  </Button>

                  <Popconfirm
                    title="Strip ALL metadata?"
                    description="Removes EXIF, GPS, ICC, IPTC, XMP — all metadata."
                    onConfirm={handleStripAndDownload}
                  >
                    <Button icon={<DeleteOutlined />} danger block>
                      Strip All & Download
                    </Button>
                  </Popconfirm>

                  <Button icon={<CopyOutlined />} block onClick={handleCopyJSON}>
                    Copy All as JSON
                  </Button>

                  <Button icon={<ImportOutlined />} block onClick={() => setImportModalOpen(true)}>
                    Import JSON
                  </Button>

                  {hasEdits && (
                    <Button icon={<ReloadOutlined />} block onClick={handleReset}>
                      Reset All Edits ({Object.keys(editedValues).length})
                    </Button>
                  )}

                  <Divider style={{ margin: '2px 0' }} />

                  <Button
                    block size="small"
                    onClick={() => {
                      if (previewUrl) URL.revokeObjectURL(previewUrl);
                      setFile(null); setPreviewUrl(null); setAllData(null);
                      setCategories([]); setEditedValues({}); setImageInfo(null);
                      setRawIccProfile(null); setIccAction('keep'); setRawXmpXml(null); setXmpAction('keep');
                    }}
                  >
                    Upload New Image
                  </Button>
                </Space>
              </Space>
            )}
          </Card>
        </Col>

        {/* Right panel – tabs */}
        <Col xs={24} lg={17}>
          {loading && !categories.length ? (
            <Card><Spin tip="Parsing all metadata segments..." style={{ width: '100%', padding: 40 }} /></Card>
          ) : categories.length > 0 ? (
            <Card size="small" styles={{ body: { padding: '8px 16px' } }}>
              {hasEdits && (
                <div style={{
                  padding: '8px 12px', marginBottom: 8,
                  background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <Text>
                    <EditOutlined style={{ color: '#1890ff', marginRight: 6 }} />
                    {Object.keys(editedValues).length} field(s) modified — JPEG only for EXIF write
                  </Text>
                  <Button size="small" onClick={handleReset} icon={<ReloadOutlined />}>Reset All</Button>
                </div>
              )}
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={tabItems}
                tabPosition="top"
                size="small"
                type="card"
                style={{ minHeight: 400 }}
              />
            </Card>
          ) : !file ? (
            <Card>
              <Empty
                description={
                  <Space direction="vertical" size={4}>
                    <Text>Upload an image to view its metadata</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Supports: EXIF (IFD0, ExifIFD, IFD1), GPS, ICC Profile, IPTC, XMP
                    </Text>
                  </Space>
                }
              />
            </Card>
          ) : null}
        </Col>
      </Row>

      {/* Import JSON Modal */}
      <Modal
        title={
          <Space>
            <ImportOutlined />
            <span>Import Metadata from JSON</span>
          </Space>
        }
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); setImportJson(''); }}
        onOk={handleImportJSON}
        okText="Apply"
        okButtonProps={{ disabled: !importJson.trim() }}
        width={640}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">
            Paste a JSON object to apply values to editable fields. Keys are matched by field name
            (e.g. <Text code>Make</Text>, <Text code>Model</Text>, <Text code>DateTimeOriginal</Text>, <Text code>latitude</Text>).
            Read-only fields and unrecognized keys are skipped.
          </Text>

          <Button icon={<CopyOutlined />} onClick={handlePasteFromClipboard} size="small">
            Paste from Clipboard
          </Button>

          <Input.TextArea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder={`{\n  "Make": "Canon",\n  "Model": "EOS R5",\n  "DateTimeOriginal": "2024-06-15T10:30:00",\n  "latitude": 37.5665,\n  "longitude": 126.9780,\n  "Artist": "John Doe",\n  "Copyright": "2024 John Doe"\n}`}
            rows={12}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />

          {importJson.trim() && (() => {
            try {
              const obj = JSON.parse(importJson);
              const keys = Object.keys(obj);

              // Count how many will match
              const fieldByKey = new Map<string, string>();
              const fieldByLabel = new Map<string, string>();
              for (const cat of categories) {
                for (const field of cat.fields) {
                  if (!field.editable) continue;
                  fieldByKey.set(field.key, field.label);
                  fieldByLabel.set(field.label.toLowerCase(), field.key);
                }
              }

              let matchCount = 0;
              for (const k of keys) {
                if (fieldByKey.has(k) || fieldByLabel.has(k.toLowerCase())) matchCount++;
              }

              return (
                <div style={{ fontSize: 12 }}>
                  <Tag color="blue">{keys.length} keys in JSON</Tag>
                  <Tag color="green">{matchCount} will match editable fields</Tag>
                  <Tag color="orange">{keys.length - matchCount} will be skipped</Tag>
                </div>
              );
            } catch {
              return <Tag color="red">Invalid JSON</Tag>;
            }
          })()}
        </Space>
      </Modal>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function dataURLToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const raw = atob(parts[1]);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default PhotoMetadataEditor;
