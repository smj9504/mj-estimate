/**
 * WMFloorPlanSource
 *
 * Segmented control that switches a floor between "Draw" (Konva sketch) and
 * "Import Image" modes. When "Import Image" is selected it shows a drop-zone
 * area that accepts file-picker clicks and clipboard paste (Ctrl+V).
 *
 * Usage:
 *   <WMFloorPlanSource
 *     sourceType={floorSketch.sourceType}
 *     backgroundImageUrl={floorSketch.backgroundImageUrl ?? null}
 *     onSourceTypeChange={handleSourceTypeChange}
 *     onImageImported={handleImageImported}
 *     onImageRemoved={handleImageRemoved}
 *   />
 */

import React, { useEffect } from 'react';
import {
  Segmented,
  Upload,
  Button,
  Space,
  Typography,
  Image,
  Tooltip,
  Alert,
} from 'antd';
import {
  EditOutlined,
  PictureOutlined,
  UploadOutlined,
  DeleteOutlined,
  ScissorOutlined,
  AimOutlined,
} from '@ant-design/icons';
import type { FloorPlanSourceType } from '../../../types/wmSketch';
import { useImageImport } from './hooks/useImageImport';

// ============================================================================
// Props
// ============================================================================

export interface WMFloorPlanSourceProps {
  sourceType: FloorPlanSourceType;
  backgroundImageUrl: string | null;
  onSourceTypeChange: (type: FloorPlanSourceType) => void;
  onImageImported: (file: File, objectUrl: string) => void;
  onImageRemoved: () => void;
  /** Trigger scale calibration mode */
  onCalibrateScale?: () => void;
  /** Whether scale has been calibrated (not default 20px/ft) */
  isCalibrated?: boolean;
  /** Current scale value in px/ft */
  scalePixelsPerFoot?: number;
}

// ============================================================================
// Component
// ============================================================================

const { Text } = Typography;

const WMFloorPlanSource: React.FC<WMFloorPlanSourceProps> = ({
  sourceType,
  backgroundImageUrl,
  onSourceTypeChange,
  onImageImported,
  onImageRemoved,
  onCalibrateScale,
  isCalibrated,
  scalePixelsPerFoot,
}) => {
  const {
    fileInputRef,
    openFilePicker,
    startPasteListening,
    stopPasteListening,
    importedImageUrl,
    isUploading,
    error,
    handleFileSelected,
    clearImage,
  } = useImageImport({ onImageImported });

  // Activate clipboard paste when in image mode and no image loaded yet.
  useEffect(() => {
    if (sourceType === 'image' && !backgroundImageUrl && !importedImageUrl) {
      startPasteListening();
    } else {
      stopPasteListening();
    }
    return () => stopPasteListening();
  }, [sourceType, backgroundImageUrl, importedImageUrl, startPasteListening, stopPasteListening]);

  const displayUrl = importedImageUrl ?? backgroundImageUrl;
  const hasImage = !!displayUrl;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 12px',
        background: '#fafafa',
        borderBottom: '1px solid #f0f0f0',
        flexWrap: 'wrap',
      }}
    >
      {/* Mode toggle */}
      <Segmented
        value={sourceType}
        onChange={(val) => onSourceTypeChange(val as FloorPlanSourceType)}
        options={[
          { label: <Space size={4}><EditOutlined />Draw</Space>, value: 'sketch' },
          { label: <Space size={4}><PictureOutlined />Import Image</Space>, value: 'image' },
        ]}
        size="small"
      />

      {/* Image controls — shown only when in image mode */}
      {sourceType === 'image' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          {hasImage ? (
            // Thumbnail + change/remove buttons
            <Space size={8} align="center">
              <Image
                src={displayUrl!}
                width={40}
                height={30}
                style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9' }}
                preview={{ mask: false }}
                alt="Floor plan background"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>Floor plan image loaded</Text>
              <Tooltip title="Replace image">
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  onClick={openFilePicker}
                  loading={isUploading}
                >
                  Change
                </Button>
              </Tooltip>
              <Tooltip title="Remove image">
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={() => {
                    clearImage();
                    onImageRemoved();
                  }}
                />
              </Tooltip>
              {onCalibrateScale && (
                <>
                  <div style={{ width: 1, height: 20, background: '#d9d9d9' }} />
                  <Tooltip title={isCalibrated
                    ? `Scale: ${scalePixelsPerFoot?.toFixed(1)} px/ft — click to re-calibrate`
                    : 'Set scale by drawing a reference line on a known dimension'
                  }>
                    <Button
                      size="small"
                      icon={<AimOutlined />}
                      type={isCalibrated ? 'default' : 'primary'}
                      ghost={!isCalibrated}
                      onClick={onCalibrateScale}
                    >
                      {isCalibrated ? `${scalePixelsPerFoot?.toFixed(1)} px/ft` : 'Calibrate Scale'}
                    </Button>
                  </Tooltip>
                </>
              )}
            </Space>
          ) : (
            // Drop zone / upload prompt
            <div
              onClick={openFilePicker}
              style={{
                flex: 1,
                minWidth: 200,
                maxWidth: 420,
                border: '1.5px dashed #d9d9d9',
                borderRadius: 6,
                padding: '6px 14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#fff',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLDivElement).style.borderColor = '#4096ff')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLDivElement).style.borderColor = '#d9d9d9')
              }
            >
              <UploadOutlined style={{ color: '#8c8c8c', fontSize: 16 }} />
              <Text style={{ fontSize: 12, color: '#595959' }}>
                Click to upload
              </Text>
              <Text style={{ fontSize: 11, color: '#bfbfbf' }}>or</Text>
              <Space size={4}>
                <ScissorOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
                <Text style={{ fontSize: 11, color: '#8c8c8c' }}>Paste (Ctrl+V)</Text>
              </Space>
            </div>
          )}

          {error && (
            <Alert
              message={error}
              type="error"
              showIcon
              closable
              style={{ padding: '2px 8px', fontSize: 12 }}
            />
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
    </div>
  );
};

export default WMFloorPlanSource;
