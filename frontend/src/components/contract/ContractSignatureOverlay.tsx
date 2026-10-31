/**
 * ContractSignatureOverlay - Reusable positioned signature/initial/date field overlay.
 * Renders on top of a PDF page image at mapped coordinates.
 */

import React from 'react';
import { EditOutlined } from '@ant-design/icons';
import { humanize } from '../common/ui';
import type { SignatureFieldPlacement } from '../../types/contract';

const FIELD_TYPE_LABELS: Record<string, string> = {
  signature: 'Sign Here',
  initial: 'Initial Here',
  date_signed: 'Date',
};

interface Props {
  field: SignatureFieldPlacement;
  containerWidth: number;
  containerHeight: number;
  capturedImage?: string;
  onClick: () => void;
  disabled?: boolean;
  /** For a screen to scroll to the line, or mark it */
  id?: string;
  className?: string;
}

const ContractSignatureOverlay: React.FC<Props> = ({
  field, containerWidth, containerHeight, capturedImage, onClick, disabled, id, className,
}) => {
  const left = field.x * containerWidth;
  const top = field.y * containerHeight;
  const width = field.width * containerWidth;
  const height = field.height * containerHeight;

  const isSig = field.fieldType === 'signature' || field.fieldType === 'initial';
  // Someone else's line says whose it is, rather than asking whoever holds the device to sign
  const label = isSig && field.signerRole && field.signerRole !== 'homeowner'
    ? humanize(field.signerRole)
    : FIELD_TYPE_LABELS[field.fieldType] || field.label;
  // A narrow initials box on a phone only has room for the word
  const compact = width < 72;

  return (
    <div
      id={id}
      className={className}
      style={{
        position: 'absolute',
        left, top, width, height,
        border: capturedImage
          ? '2px solid #52c41a'
          : '2px dashed #f5222d',
        borderRadius: 4,
        background: capturedImage
          ? 'rgba(82, 196, 26, 0.05)'
          : 'rgba(245, 34, 34, 0.06)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        transition: 'all 0.2s',
      }}
      onClick={disabled ? undefined : onClick}
    >
      {capturedImage && isSig ? (
        <img
          src={capturedImage}
          alt="Signature"
          style={{
            maxWidth: '95%',
            maxHeight: '90%',
            objectFit: 'contain',
          }}
        />
      ) : capturedImage ? (
        <span style={{ fontSize: 12, color: '#37352f', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {capturedImage}
        </span>
      ) : (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 4px',
            fontSize: 11,
            lineHeight: 1,
            color: '#f5222d',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {isSig && !compact && <EditOutlined style={{ fontSize: 12 }} aria-hidden="true" />}
          {compact && field.fieldType === 'initial' ? 'Initial' : label}
        </span>
      )}
    </div>
  );
};

export default ContractSignatureOverlay;
