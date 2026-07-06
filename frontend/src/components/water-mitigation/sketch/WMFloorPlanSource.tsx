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
  Slider,
  Switch,
} from 'antd';
import {
  EditOutlined,
  PictureOutlined,
  UploadOutlined,
  DeleteOutlined,
  ScissorOutlined,
  AimOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  RobotOutlined,
  ClearOutlined,
  CloudDownloadOutlined,
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
  /** Whether a background image exists (for reference controls in sketch mode) */
  hasBackgroundImage?: boolean;
  /** Whether to show the reference image overlay in sketch mode */
  showReferenceImage?: boolean;
  onShowReferenceImageChange?: (show: boolean) => void;
  /** Opacity of the reference image (0.0 - 1.0) */
  referenceOpacity?: number;
  onReferenceOpacityChange?: (opacity: number) => void;
  /** AI-based image-to-drawing conversion */
  onConvertToDrawing?: () => void;
  isConverting?: boolean;
  /** Hide overlays to focus on floor plan editing */
  hideOverlays?: boolean;
  onHideOverlaysChange?: (hide: boolean) => void;
  /** Clear all walls and rooms */
  onClearFloorPlan?: () => void;
  /** Import floor plan from MagicPlan */
  onImportFromMagicPlan?: () => void;
  isMagicPlanImporting?: boolean;
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
  hasBackgroundImage,
  showReferenceImage,
  onShowReferenceImageChange,
  referenceOpacity = 0.3,
  onReferenceOpacityChange,
  onConvertToDrawing,
  isConverting,
  hideOverlays,
  onHideOverlaysChange,
  onClearFloorPlan,
  onImportFromMagicPlan,
  isMagicPlanImporting,
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

      {/* Floor plan edit mode — hide overlays */}
      {onHideOverlaysChange && (
        <Tooltip title={hideOverlays ? 'Show all overlays' : 'Hide overlays to edit floor plan only'}>
          <Button
            size="small"
            type={hideOverlays ? 'primary' : 'default'}
            ghost={hideOverlays}
            icon={hideOverlays ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => onHideOverlaysChange(!hideOverlays)}
          >
            {hideOverlays ? 'Floor Plan Only' : 'All Layers'}
          </Button>
        </Tooltip>
      )}
      {onClearFloorPlan && (
        <Tooltip title="Clear all walls and rooms">
          <Button
            size="small"
            icon={<ClearOutlined />}
            danger
            onClick={onClearFloorPlan}
          >
            Clear Floor Plan
          </Button>
        </Tooltip>
      )}

      {/* Reference image controls — shown in sketch mode when background image exists */}
      {sourceType === 'sketch' && hasBackgroundImage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 1, height: 20, background: '#d9d9d9' }} />
          <Tooltip title={showReferenceImage ? 'Hide reference image' : 'Show imported image as trace reference'}>
            <Button
              size="small"
              type={showReferenceImage ? 'primary' : 'default'}
              ghost={showReferenceImage}
              icon={showReferenceImage ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              onClick={() => onShowReferenceImageChange?.(!showReferenceImage)}
            >
              Reference
            </Button>
          </Tooltip>
          {showReferenceImage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>Opacity</Text>
              <Slider
                min={0.05}
                max={0.8}
                step={0.05}
                value={referenceOpacity}
                onChange={(val) => onReferenceOpacityChange?.(val)}
                style={{ width: 80, margin: 0 }}
                tooltip={{ formatter: (val) => `${Math.round((val ?? 0) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

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
              {onConvertToDrawing && (
                <>
                  <div style={{ width: 1, height: 20, background: '#d9d9d9' }} />
                  <Tooltip title="AI가 이미지를 분석하여 벽과 방을 자동으로 감지합니다">
                    <Button
                      size="small"
                      icon={<RobotOutlined />}
                      onClick={onConvertToDrawing}
                      loading={isConverting}
                      type="primary"
                      ghost
                    >
                      Convert to Drawing
                    </Button>
                  </Tooltip>
                </>
              )}
            </Space>
          ) : (
            // Drop zone / upload prompt
            <>
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
              {onImportFromMagicPlan && (
                <Tooltip title="Import floor plan from MagicPlan project">
                  <Button
                    size="small"
                    icon={<CloudDownloadOutlined />}
                    onClick={onImportFromMagicPlan}
                    loading={isMagicPlanImporting}
                    style={{ color: '#722ed1', borderColor: '#722ed1' }}
                  >
                    From MagicPlan
                  </Button>
                </Tooltip>
              )}
            </>
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
