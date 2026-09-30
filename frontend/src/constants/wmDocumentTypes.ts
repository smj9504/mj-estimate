/**
 * Water Mitigation document types — the single source of truth for the
 * document_type value, its display label, and its tag color.
 *
 * This list unifies three previously separate (and mutually inconsistent)
 * lists: the label/color map in WMDocumentList, the creation list in
 * WaterMitigationDocumentsTab (DOCUMENT_TYPES), and the manual-upload list in
 * WMDocumentUploadModal (UPLOAD_DOCUMENT_TYPES). It also covers the values
 * written by the backend (annotated_pdf, photo_report, sketch_report), which
 * previously rendered as an unstyled grey raw string.
 *
 * The backend column is an unconstrained String(50), so values not listed here
 * can still exist; getDocumentTypeInfo() falls back to showing them verbatim.
 */

export interface WMDocumentTypeOption {
  value: string;
  label: string;
  color: string;
}

export const WM_DOCUMENT_TYPES: WMDocumentTypeOption[] = [
  { value: 'COS', label: 'Certificate of Satisfaction', color: 'green' },
  { value: 'EWA', label: 'Emergency Work Agreement', color: 'blue' },
  { value: 'Invoice', label: 'Invoice', color: 'gold' },
  { value: 'Sketch', label: 'Sketch', color: 'cyan' },
  { value: 'sketch_report', label: 'Sketch Report', color: 'cyan' },
  { value: 'Photo', label: 'Photo', color: 'magenta' },
  { value: 'photo_report', label: 'Photo Report', color: 'magenta' },
  { value: 'annotated_pdf', label: 'Annotated PDF', color: 'purple' },
  { value: 'W9', label: 'W-9', color: 'geekblue' },
  { value: 'Custom', label: 'Custom', color: 'default' },
  { value: 'Other', label: 'Other', color: 'default' },
];

/**
 * Legacy aliases — values that exist in saved rows but are not offered as
 * choices. They map onto a canonical entry above so old documents keep
 * rendering with the right label/color.
 */
const LEGACY_ALIASES: Record<string, string> = {
  'Photo Report': 'photo_report',
};

const TYPE_MAP: Record<string, WMDocumentTypeOption> = WM_DOCUMENT_TYPES.reduce(
  (acc, opt) => {
    acc[opt.value] = opt;
    return acc;
  },
  {} as Record<string, WMDocumentTypeOption>
);

/**
 * Resolve a stored document_type to its label + tag color.
 * Unknown values render verbatim in the default (grey) color.
 */
export const getDocumentTypeInfo = (
  type: string
): { label: string; color: string } => {
  const canonical = LEGACY_ALIASES[type] || type;
  return TYPE_MAP[canonical] || { label: type, color: 'default' };
};
