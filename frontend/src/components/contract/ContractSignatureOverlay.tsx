/**
 * ContractSignatureOverlay - Reusable positioned signature/initial/date field overlay.
 * Renders on top of a PDF page image at mapped coordinates.
 */

import React from 'react';
import { EditOutlined } from '@ant-design/icons';
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
}

const ContractSignatureOverlay: React.FC<Props> = ({
  field, containerWidth, containerHeight, capturedImage, onClick, disabled,
}) => {
  const left = field.x * containerWidth;
  const top = field.y * containerHeight;
  const width = field.width * containerWidth;
  const height = field.height * containerHeight;

  const isSig = field.fieldType === 'signature' || field.fieldType === 'initial';
  const label = FIELD_TYPE_LABELS[field.fieldType] || field.label;

  return (
    <div
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
      {capturedImage ? (
        <img
          src={capturedImage}
          alt="Signature"
          style={{
            maxWidth: '95%',
            maxHeight: '90%',
            objectFit: 'contain',
          }}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: 4 }}>
          {isSig && <EditOutlined style={{ fontSize: 16, color: '#f5222d', display: 'block', marginBottom: 2 }} />}
          <span style={{ fontSize: 11, color: '#f5222d', fontWeight: 500 }}>
            {label}
          </span>
        </div>
      )}
    </div>
  );
};

export default ContractSignatureOverlay;
