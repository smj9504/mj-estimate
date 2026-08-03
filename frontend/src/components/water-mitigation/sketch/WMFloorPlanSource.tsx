/**
 * WMFloorPlanSource
 *
 * Segmented control that switches a floor between "Draw" (Konva sketch) and
 * "Import Image" modes. When "Import Image" is selected it shows a drop-zone
 * area that accepts file-picker clicks and clipboard paste (Ctrl+V).
 *
 * Mobile-optimized: buttons collapse to icon-only on narrow screens,
 * controls wrap into rows, text labels hidden on small viewports.
 */

import React, { useEffect, useState } from 'react';
import {
  Segmented,
  Button,
  Space,
  Typography,
  Image,
  Tooltip,
  Alert,
  Slider,
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
  DragOutlined,
  MoreOutlined,
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
  onCalibrateScale?: () => void;
  isCalibrated?: boolean;
  scalePixelsPerFoot?: number;
  hasBackgroundImage?: boolean;
  showReferenceImage?: boolean;
  onShowReferenceImageChange?: (show: boolean) => void;
  referenceOpacity?: number;
  onReferenceOpacityChange?: (opacity: number) => void;
  onConvertToDrawing?: () => void;
  isConverting?: boolean;
  hideOverlays?: boolean;
  onHideOverlaysChange?: (hide: boolean) => void;
  onClearFloorPlan?: () => void;
  onImportFromMagicPlan?: () => void;
  isMagicPlanImporting?: boolean;
  onCropImage?: () => void;
  bgMoveMode?: boolean;
  onBgMoveModeChange?: (enabled: boolean) => void;
}

// ============================================================================
// Inline responsive styles
// ============================================================================

const MOBILE_BREAKPOINT = 768;

const responsiveStyles = `
  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .wm-fps-root {
      gap: 6px !important;
      padding: 4px 8px !important;
    }
    .wm-fps-root .wm-fps-hide-mobile {
      display: none !important;
    }
    .wm-fps-root .wm-fps-btn-label {
      display: none !important;
    }
    .wm-fps-root .wm-fps-image-controls {
      gap: 4px !important;
    }
    .wm-fps-root .wm-fps-image-controls .ant-space {
      gap: 4px !important;
    }
    .wm-fps-root .wm-fps-divider {
      display: none !important;
    }
  }
`;

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
  onCropImage,
  bgMoveMode,
  onBgMoveModeChange,
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
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <style>{responsiveStyles}</style>
      <div
        className="wm-fps-root"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 12px',
          background: '#fafafa',
          borderBottom: '1px solid #f0f0f0',
          flexWrap: 'nowrap',
          overflowX: 'auto',
        }}
      >
        {/* Mode toggle */}
        <Segmented
          value={sourceType}
          onChange={(val) => onSourceTypeChange(val as FloorPlanSourceType)}
          options={[
            { label: <Space size={4}><EditOutlined /><span className="wm-fps-btn-label">Draw</span></Space>, value: 'sketch' },
            { label: <Space size={4}><PictureOutlined /><span className="wm-fps-btn-label">Import</span></Space>, value: 'image' },
          ]}
          size="small"
        />

        {/* Expand toggle for additional controls */}
        <Tooltip title={expanded ? 'Hide floor plan controls' : 'Show floor plan controls'}>
          <Button
            size="small"
            type={expanded ? 'primary' : 'default'}
            ghost={expanded}
            icon={<MoreOutlined />}
            onClick={() => setExpanded(!expanded)}
          />
        </Tooltip>

        {/* Floor plan edit mode — hide overlays (only when expanded) */}
        {expanded && onHideOverlaysChange && (
          <Tooltip title={hideOverlays ? 'Show all overlays' : 'Hide overlays to edit floor plan only'}>
            <Button
              size="small"
              type={hideOverlays ? 'primary' : 'default'}
              ghost={hideOverlays}
              icon={hideOverlays ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => onHideOverlaysChange(!hideOverlays)}
            >
              <span className="wm-fps-btn-label">{hideOverlays ? 'Floor Plan Only' : 'All Layers'}</span>
            </Button>
          </Tooltip>
        )}
        {expanded && onClearFloorPlan && (
          <Tooltip title="Clear all walls and rooms">
            <Button
              size="small"
              icon={<ClearOutlined />}
              danger
              onClick={onClearFloorPlan}
            >
              <span className="wm-fps-btn-label">Clear</span>
            </Button>
          </Tooltip>
        )}

        {/* Reference image controls — shown in sketch mode when background image exists and expanded */}
        {expanded && sourceType === 'sketch' && hasBackgroundImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div className="wm-fps-divider" style={{ width: 1, height: 20, background: '#d9d9d9' }} />
            <Tooltip title={showReferenceImage ? 'Hide reference image' : 'Show imported image as trace reference'}>
              <Button
                size="small"
                type={showReferenceImage ? 'primary' : 'default'}
                ghost={showReferenceImage}
                icon={showReferenceImage ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                onClick={() => onShowReferenceImageChange?.(!showReferenceImage)}
              >
                <span className="wm-fps-btn-label">Reference</span>
              </Button>
            </Tooltip>
            {showReferenceImage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text className="wm-fps-hide-mobile" style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>Opacity</Text>
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

        {/* Image controls — shown only when in image mode and expanded */}
        {expanded && sourceType === 'image' && (
          <div className="wm-fps-image-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
            {hasImage ? (
              // Thumbnail + action buttons — wraps on mobile
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Image
                  src={displayUrl!}
                  width={40}
                  height={30}
                  style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #d9d9d9' }}
                  preview={{ mask: false }}
                  alt="Floor plan background"
                />
                <Text className="wm-fps-hide-mobile" type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  Floor plan image loaded
                </Text>

                {/* Primary image actions */}
                <Space.Compact size="small">
                  <Tooltip title="Replace image">
                    <Button
                      icon={<UploadOutlined />}
                      onClick={openFilePicker}
                      loading={isUploading}
                    >
                      <span className="wm-fps-btn-label">Change</span>
                    </Button>
                  </Tooltip>
                  {onCropImage && (
                    <Tooltip title="Crop image">
                      <Button icon={<ScissorOutlined />} onClick={onCropImage}>
                        <span className="wm-fps-btn-label">Crop</span>
                      </Button>
                    </Tooltip>
                  )}
                  {onBgMoveModeChange && (
                    <Tooltip title={bgMoveMode ? 'Stop moving image' : 'Move background image'}>
                      <Button
                        icon={<DragOutlined />}
                        type={bgMoveMode ? 'primary' : 'default'}
                        onClick={() => onBgMoveModeChange(!bgMoveMode)}
                      >
                        <span className="wm-fps-btn-label">Move</span>
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip title="Remove image">
                    <Button
                      icon={<DeleteOutlined />}
                      danger
                      onClick={() => {
                        clearImage();
                        onImageRemoved();
                      }}
                    />
                  </Tooltip>
                </Space.Compact>

                {/* Scale calibration */}
                {onCalibrateScale && (
                  <>
                    <div className="wm-fps-divider" style={{ width: 1, height: 20, background: '#d9d9d9' }} />
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
                        {isCalibrated ? `${scalePixelsPerFoot?.toFixed(1)} px/ft` : <><span className="wm-fps-btn-label">Calibrate</span></>}
                      </Button>
                    </Tooltip>
                  </>
                )}

                {/* AI conversion */}
                {onConvertToDrawing && (
                  <>
                    <div className="wm-fps-divider" style={{ width: 1, height: 20, background: '#d9d9d9' }} />
                    <Tooltip title="AI가 이미지를 분석하여 벽과 방을 자동으로 감지합니다">
                      <Button
                        size="small"
                        icon={<RobotOutlined />}
                        onClick={onConvertToDrawing}
                        loading={isConverting}
                        type="primary"
                        ghost
                      >
                        <span className="wm-fps-btn-label">Convert</span>
                      </Button>
                    </Tooltip>
                  </>
                )}

                {/* MagicPlan */}
                {onImportFromMagicPlan && (
                  <>
                    <div className="wm-fps-divider" style={{ width: 1, height: 20, background: '#d9d9d9' }} />
                    <Tooltip title="Replace with a floor plan from MagicPlan">
                      <Button
                        size="small"
                        icon={<CloudDownloadOutlined />}
                        onClick={onImportFromMagicPlan}
                        loading={isMagicPlanImporting}
                        style={{ color: '#722ed1', borderColor: '#722ed1' }}
                      >
                        <span className="wm-fps-btn-label">MagicPlan</span>
                      </Button>
                    </Tooltip>
                  </>
                )}
              </div>
            ) : (
              // Drop zone / upload prompt
              <>
                <div
                  onClick={openFilePicker}
                  style={{
                    flex: 1,
                    minWidth: 160,
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
                  <span className="wm-fps-hide-mobile">
                    <Text style={{ fontSize: 11, color: '#bfbfbf' }}>or</Text>
                  </span>
                  <Space className="wm-fps-hide-mobile" size={4}>
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
                      <span className="wm-fps-btn-label">MagicPlan</span>
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
    </>
  );
};

export default WMFloorPlanSource;
