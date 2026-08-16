/**
 * PDF Annotator Types
 * Types for text annotations, signature overlays, and per-page annotation data
 */

export type { SignatureFieldPlacement } from '../../../types/contract';

export interface PdfTextAnnotation {
  id: string;
  pageIndex: number;
  /** X position as ratio (0-1) of page width */
  x: number;
  /** Y position as ratio (0-1) of page height */
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
}

export interface PdfSignatureAnnotation {
  id: string;
  pageIndex: number;
  /** X position as ratio (0-1) of page width */
  x: number;
  /** Y position as ratio (0-1) of page height */
  y: number;
  /** Width as ratio (0-1) of page width */
  width: number;
  /** Height as ratio (0-1) of page height */
  height: number;
  /** Base64 PNG data of the signature */
  imageData: string;
  /** ID of the template signature field this was captured for, if any.
   *  Lets re-edit match this annotation back to its field overlay. */
  fieldId?: string;
  /** Field type from the template mapping (signature | initial) */
  fieldType?: string;
  /** Signer role from the template mapping (homeowner | company_rep | witness) */
  signerRole?: string;
}

export interface PageAnnotations {
  texts: PdfTextAnnotation[];
  signatures: PdfSignatureAnnotation[];
}

export interface PdfAnnotationData {
  /** Annotation data keyed by page index */
  pages: Record<number, PageAnnotations>;
  /** Original PDF filename */
  originalFilename: string;
  /** Version for future schema migrations */
  version: number;
}

export type AnnotationTool = 'select' | 'text' | 'signature';

export interface AnnotatorState {
  currentPage: number;
  totalPages: number;
  tool: AnnotationTool;
  selectedAnnotationId: string | null;
  fontSize: number;
  fontColor: string;
  fontBold: boolean;
  fontItalic: boolean;
  scale: number;
}

export const DEFAULT_ANNOTATOR_STATE: AnnotatorState = {
  currentPage: 0,
  totalPages: 0,
  tool: 'select',
  selectedAnnotationId: null,
  fontSize: 14,
  fontColor: '#000000',
  fontBold: false,
  fontItalic: false,
  scale: 1,
};

export const FONT_SIZE_OPTIONS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

export const FONT_COLOR_OPTIONS = [
  '#000000', '#333333', '#666666',
  '#FF0000', '#0000FF', '#008000',
  '#FF6600', '#800080', '#006699',
];
