/**
 * WMSketchTab
 *
 * Top-level tab component for the WM floor sketch system.
 * Rendered inside the WaterMitigationDetail page as one of the main tabs.
 *
 * Responsibilities:
 *  - Fetch floor sketches for the job on mount
 *  - CRUD: add / delete floors via wmSketchService
 *  - Track active floor selection
 *  - Delegate rendering of the active floor to WMFloorSketchEditor
 *  - Handle save, image upload, and image removal
 *
 * Layout:
 *   Address header
 *   WMFloorSelector (tab bar)
 *   WMFloorSketchEditor (fills remaining space)
 *
 * Usage:
 *   <WMSketchTab jobId="abc123" jobAddress="6305 Musket Ball Dr" />
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Spin,
  Empty,
  Button,
  message,
  Modal,
  Space,
  Typography,
  Card,
  Tooltip,
  Dropdown,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  PlusOutlined,
  EnvironmentOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  DownOutlined,
} from '@ant-design/icons';
import wmSketchService from '../../../services/wmSketchService';
import { magicPlanService } from '../../../services/waterMitigationService';
import type {
  WMFloorSketch,
  WMOverlayData,
} from '../../../types/wmSketch';
import {
  DEFAULT_DEMO_MATERIAL_TYPES,
  EMPTY_OVERLAY_DATA,
} from '../../../types/wmSketch';
import type { FloorPlanSourceType } from '../../../types/wmSketch';
import { generateOverlayId } from './utils/wmCalculations';
import { useWMResponsive } from './hooks/useWMResponsive';
import WMFloorSelector from './WMFloorSelector';
import WMFloorSketchEditor from './WMFloorSketchEditor';
import MagicPlanFloorPlanSelectModal from './MagicPlanFloorPlanSelectModal';
import type { MagicPlanFloorSelection } from './MagicPlanFloorPlanSelectModal';

/**
 * Ensure all overlay elements have `id` fields.
 * Server JSONB snapshots stored before the fix may lack IDs.
 */
function ensureOverlayIds(overlay: WMOverlayData): WMOverlayData {
  let patched = false;
  const fix = <T extends { id?: string }>(items: T[]): T[] =>
    items.map((item) => {
      if (!item.id) {
        patched = true;
        return { ...item, id: generateOverlayId() };
      }
      return item;
    });

  const result: WMOverlayData = {
    demolition_zones: fix(overlay.demolition_zones ?? []),
    equipment_placements: fix(overlay.equipment_placements ?? []),
    containment_zones: fix(overlay.containment_zones ?? []),
    floor_protections: fix(overlay.floor_protections ?? []),
    content_protections: fix(overlay.content_protections ?? []),
    content_manipulations: fix(overlay.content_manipulations ?? []),
    text_annotations: fix(overlay.text_annotations ?? []),
    shapes: fix(overlay.shapes ?? []),
    walls: fix(overlay.walls ?? []),
    rooms: fix(overlay.rooms ?? []),
    element_order: overlay.element_order,
    bg_offset_x: overlay.bg_offset_x,
    bg_offset_y: overlay.bg_offset_y,
  };
  return patched ? result : overlay;
}

const { Text, Title } = Typography;

// ============================================================================
// Props
// ============================================================================

export interface WMSketchTabProps {
  jobId: string;
  jobAddress: string;
  isActive?: boolean;
}

// ============================================================================
// Component
// ============================================================================

const WMSketchTab: React.FC<WMSketchTabProps> = ({ jobId, jobAddress, isActive }) => {
  const { isMobile } = useWMResponsive();

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const [floors, setFloors] = useState<WMFloorSketch[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [scopeGenerating, setScopeGenerating] = useState(false);
  const [mpImporting, setMpImporting] = useState(false);
  const [mpFloorPlanModal, setMpFloorPlanModal] = useState(false);

  // Material types are constant for now; could be customised per-job later
  const materialTypes = DEFAULT_DEMO_MATERIAL_TYPES;

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    wmSketchService
      .getFloorSketches(jobId)
      .then((data) => {
        if (cancelled) return;
        // Ensure overlay elements have IDs (legacy JSONB snapshots may lack them)
        const withIds = data.map((f) => ({
          ...f,
          overlay_data: ensureOverlayIds(f.overlay_data ?? EMPTY_OVERLAY_DATA),
        }));
        const sorted = [...withIds].sort((a, b) => a.floor_order - b.floor_order);
        setFloors(sorted);
        if (sorted.length > 0) {
          setActiveFloorId(sorted[0].id);
        }
      })
      .catch((err) => {
        console.error('[WMSketchTab] Failed to load floor sketches:', err);
        if (!cancelled) {
          setFetchError('Failed to load floor sketches. Please try refreshing.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Background refresh when tab becomes active
  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      wmSketchService.getFloorSketches(jobId).then((data) => {
        const withIds = data.map((f) => ({
          ...f,
          overlay_data: ensureOverlayIds(f.overlay_data ?? EMPTY_OVERLAY_DATA),
        }));
        const sorted = [...withIds].sort((a, b) => a.floor_order - b.floor_order);
        setFloors(sorted);
      }).catch(() => { /* silent */ });
    }
    prevActiveRef.current = isActive;
  }, [isActive, jobId]);

  // ------------------------------------------------------------------
  // Floor CRUD handlers
  // ------------------------------------------------------------------

  const handleAddFloor = useCallback(
    async (label: string, sourceType: FloorPlanSourceType) => {
      const nextOrder = floors.length > 0
        ? Math.max(...floors.map((f) => f.floor_order)) + 1
        : 0;

      try {
        const created = await wmSketchService.createFloorSketch(jobId, {
          floor_label: label,
          floor_order: nextOrder,
          address_display: jobAddress,
          source_type: sourceType,
        });

        // Ensure overlayData exists (backend may return null for new sketches)
        const withOverlay: WMFloorSketch = {
          ...created,
          overlay_data: created.overlay_data ?? EMPTY_OVERLAY_DATA,
        };

        setFloors((prev) =>
          [...prev, withOverlay].sort((a, b) => a.floor_order - b.floor_order)
        );
        setActiveFloorId(withOverlay.id);
        message.success(`Floor "${label}" added.`);
      } catch {
        message.error('Failed to add floor. Please try again.');
      }
    },
    [jobId, jobAddress, floors]
  );

  const handleDeleteFloor = useCallback(
    async (floorId: string) => {
      const remaining = floors.filter((f) => f.id !== floorId);
      try {
        await wmSketchService.deleteFloorSketch(floorId);
        setFloors(remaining);
        if (activeFloorId === floorId) {
          setActiveFloorId(remaining.length > 0 ? remaining[0].id : null);
        }
        message.success('Floor deleted.');
      } catch {
        message.error('Failed to delete floor.');
      }
    },
    [floors, activeFloorId]
  );

  const handleReorderFloor = useCallback(
    async (floorId: string, direction: 'up' | 'down') => {
      const sorted = [...floors].sort((a, b) => a.floor_order - b.floor_order);
      const idx = sorted.findIndex((f) => f.id === floorId);
      if (idx === -1) return;

      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;

      const updated = sorted.map((f, i) => {
        if (i === idx) return { ...f, floor_order: sorted[swapIdx].floor_order };
        if (i === swapIdx) return { ...f, floor_order: sorted[idx].floor_order };
        return f;
      });

      setFloors([...updated].sort((a, b) => a.floor_order - b.floor_order));

      // Persist order changes in background (best-effort)
      try {
        await Promise.all([
          wmSketchService.updateFloorSketch(floorId, {
            floor_order: sorted[swapIdx].floor_order,
          }),
          wmSketchService.updateFloorSketch(sorted[swapIdx].id, {
            floor_order: sorted[idx].floor_order,
          }),
        ]);
      } catch {
        // Silently revert is complex — just notify
        message.warning('Floor order could not be saved to the server.');
      }
    },
    [floors]
  );

  const handleRenameFloor = useCallback(
    async (floorId: string, newLabel: string) => {
      setFloors((prev) =>
        prev.map((f) => (f.id === floorId ? { ...f, floor_label: newLabel } : f))
      );
      try {
        await wmSketchService.updateFloorSketch(floorId, { floor_label: newLabel });
        message.success('Floor renamed.');
      } catch {
        message.error('Failed to rename floor.');
        // Optimistic update — could revert here if needed
      }
    },
    []
  );

  // ------------------------------------------------------------------
  // Overlay + save handlers
  // ------------------------------------------------------------------

  const handleOverlayChanged = useCallback(
    (overlayData: WMOverlayData) => {
      if (!activeFloorId) return;
      setFloors((prev) =>
        prev.map((f) =>
          f.id === activeFloorId ? { ...f, overlay_data: overlayData } : f
        )
      );
    },
    [activeFloorId]
  );

  const handleSave = useCallback(
    async (overlayData: WMOverlayData, canvasSize?: { width: number; height: number }) => {
      if (!activeFloorId) return;
      await wmSketchService.saveOverlayData(activeFloorId, overlayData);
      // Persist the actual canvas dimensions so PDF rendering
      // uses the same coordinate system the user sees.
      if (canvasSize) {
        await wmSketchService.updateFloorSketch(activeFloorId, {
          canvas_width: canvasSize.width,
          canvas_height: canvasSize.height,
        });
      }
    },
    [activeFloorId]
  );

  const handleImageUploaded = useCallback(
    async (file: File) => {
      if (!activeFloorId) return;
      const { background_image_url } = await wmSketchService.uploadBackgroundImage(
        activeFloorId,
        file
      );
      setFloors((prev) =>
        prev.map((f) =>
          f.id === activeFloorId
            ? { ...f, background_image_url, source_type: 'image' as FloorPlanSourceType }
            : f
        )
      );
    },
    [activeFloorId]
  );

  const handleImageRemoved = useCallback(async () => {
    if (!activeFloorId) return;
    await wmSketchService.removeBackgroundImage(activeFloorId);
    setFloors((prev) =>
      prev.map((f) =>
        f.id === activeFloorId
          ? { ...f, background_image_url: undefined, source_type: 'sketch' as FloorPlanSourceType }
          : f
      )
    );
  }, [activeFloorId]);

  // MagicPlan floor plan import — open modal for user selection
  const handleOpenMagicPlanModal = useCallback(() => {
    if (!activeFloorId) return;
    setMpFloorPlanModal(true);
  }, [activeFloorId]);

  const handleMagicPlanFloorSelect = useCallback(async (selections: MagicPlanFloorSelection[]) => {
    if (selections.length === 0) return;

    // Single selection with an active tab: preserve the original behavior
    // (import into the tab the user already opened the modal from).
    if (selections.length === 1 && activeFloorId && floors.some((f) => f.id === activeFloorId)) {
      const selection = selections[0];
      setMpImporting(true);
      try {
        const result = await magicPlanService.importFloorPlan(
          jobId,
          selection.projectId,
          selection.planId,
          selection.floorIndex,
          activeFloorId,
        );

        if (result.success && result.image_url) {
          setFloors((prev) =>
            prev.map((f) =>
              f.id === activeFloorId
                ? {
                    ...f,
                    background_image_url: result.image_url!,
                    source_type: 'image' as FloorPlanSourceType,
                    floor_label: selection.floorName,
                  }
                : f
            )
          );
          try {
            await wmSketchService.updateFloorSketch(activeFloorId, { floor_label: selection.floorName });
          } catch {
            // Non-critical - the image import already succeeded, a stale tab label isn't worth a second error toast.
          }
          message.success(`Floor plan imported: ${selection.floorName}`);
          setMpFloorPlanModal(false);
        } else {
          message.error(result.error_message || 'Failed to import floor plan');
        }
      } catch (err: any) {
        message.error(err?.response?.data?.detail || 'Failed to import from MagicPlan');
      } finally {
        setMpImporting(false);
      }
      return;
    }

    // Multiple selections (or no active tab): each room becomes its own new
    // sketch tab, since one WMFloorSketch can only hold one background image.
    const runBulkImport = async () => {
      setMpFloorPlanModal(false);
      setMpImporting(true);
      const msgKey = 'mp-bulk-import';
      const baseOrder = floors.length > 0 ? Math.max(...floors.map((f) => f.floor_order)) + 1 : 1;
      const succeeded: string[] = [];
      const failed: { name: string; reason: string }[] = [];
      let lastCreatedId: string | null = null;

      message.loading({ content: `Importing floor plans 0/${selections.length}...`, key: msgKey, duration: 0 });

      for (let i = 0; i < selections.length; i++) {
        const selection = selections[i];
        try {
          const created = await wmSketchService.createFloorSketch(jobId, {
            floor_label: selection.floorName,
            floor_order: baseOrder + i,
            address_display: jobAddress,
            source_type: 'sketch',
          });
          const withOverlay: WMFloorSketch = { ...created, overlay_data: created.overlay_data ?? EMPTY_OVERLAY_DATA };
          setFloors((prev) => [...prev, withOverlay].sort((a, b) => a.floor_order - b.floor_order));
          lastCreatedId = withOverlay.id;

          const result = await magicPlanService.importFloorPlan(
            jobId,
            selection.projectId,
            selection.planId,
            selection.floorIndex,
            withOverlay.id,
          );
          if (result.success && result.image_url) {
            setFloors((prev) =>
              prev.map((f) =>
                f.id === withOverlay.id
                  ? { ...f, background_image_url: result.image_url!, source_type: 'image' as FloorPlanSourceType }
                  : f
              )
            );
            succeeded.push(selection.floorName);
          } else {
            failed.push({ name: selection.floorName, reason: result.error_message || 'No image available' });
          }
        } catch (err: any) {
          failed.push({ name: selection.floorName, reason: err?.response?.data?.detail || 'Request failed' });
        }
        message.loading({
          content: `Importing floor plans ${i + 1}/${selections.length}...`,
          key: msgKey,
          duration: 0,
        });
      }

      if (lastCreatedId) setActiveFloorId(lastCreatedId);

      if (failed.length === 0) {
        message.success({ content: `Imported ${succeeded.length} floor plan(s) from MagicPlan.`, key: msgKey, duration: 3 });
      } else if (succeeded.length > 0) {
        const names = failed.map((f) => f.name).slice(0, 3).join(', ');
        const more = failed.length > 3 ? ` +${failed.length - 3} more` : '';
        message.warning({ content: `Imported ${succeeded.length}/${selections.length}. Failed: ${names}${more}`, key: msgKey, duration: 6 });
      } else {
        message.error({ content: `All ${selections.length} imports failed. ${failed[0]?.reason || ''}`, key: msgKey, duration: 6 });
      }
      setMpImporting(false);
    };

    if (selections.length > 10) {
      Modal.confirm({
        title: 'Import many floor plans?',
        content: `You're about to import ${selections.length} floor plans. This may take a while since each one is fetched from MagicPlan individually.`,
        okText: 'Import',
        onOk: runBulkImport,
      });
      return;
    }

    await runBulkImport();
  }, [activeFloorId, jobId, jobAddress, floors]);

  const handleScaleChanged = useCallback(
    async (scalePixelsPerFoot: number) => {
      if (!activeFloorId) return;
      // Optimistic update
      setFloors((prev) =>
        prev.map((f) =>
          f.id === activeFloorId
            ? { ...f, scale_pixels_per_foot: scalePixelsPerFoot }
            : f
        )
      );
      // Persist to server
      try {
        await wmSketchService.updateFloorSketch(activeFloorId, {
          scale_pixels_per_foot: scalePixelsPerFoot,
        });
      } catch {
        message.error('Failed to save scale calibration.');
      }
    },
    [activeFloorId]
  );

  const handleGeneratePdf = useCallback(async (templateVariant: string = 'a') => {
    setPdfGenerating(true);
    try {
      const address = jobAddress.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
      await wmSketchService.downloadSketchReport(jobId, `sketch_report_${address}.pdf`, templateVariant);
      message.success('PDF report downloaded.');
    } catch {
      message.error('Failed to generate PDF report. Please try again.');
    } finally {
      setPdfGenerating(false);
    }
  }, [jobId, jobAddress]);

  const pdfVariantMenu: MenuProps['items'] = [
    { key: 'a', label: 'Format A — Standard' },
    { key: 'b', label: 'Format B — Formal' },
    { key: 'c', label: 'Format C — Modern' },
  ];

  const handleGenerateScope = useCallback(() => {
    Modal.confirm({
      title: 'Generate Scope of Work',
      content: (
        <div>
          <p>
            Sketch 데이터를 기반으로 Scope of Work를 자동 생성합니다.
          </p>
          <p style={{ fontSize: 12, color: '#8c8c8c' }}>
            각 Floor별로 Location이 생성되며, Demolition / Equipment /
            Containment / Floor Protection / Content Protection 항목이
            자동으로 추가됩니다.
          </p>
        </div>
      ),
      okText: 'Generate',
      cancelText: 'Cancel',
      onOk: async () => {
        setScopeGenerating(true);
        try {
          const result = await wmSketchService.generateScopeFromSketch(jobId);
          if (result.success) {
            message.success(result.message);
            if (result.warnings.length > 0) {
              result.warnings.forEach((w) => message.warning(w));
            }
          } else {
            message.error(result.message);
          }
        } catch {
          message.error('Failed to generate Scope of Work. Please try again.');
        } finally {
          setScopeGenerating(false);
        }
      },
    });
  }, [jobId]);

  // ------------------------------------------------------------------
  // Derived: active floor
  // ------------------------------------------------------------------
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null;

  // ============================================================================
  // Render helpers
  // ============================================================================

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 300,
        }}
      >
        <Spin size="large" />
        <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 14 }}>Loading floor sketches...</div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 300,
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text type="danger">{fetchError}</Text>}
        >
          <Button onClick={() => window.location.reload()}>Refresh</Button>
        </Empty>
      </div>
    );
  }

  // ============================================================================
  // Main render
  // ============================================================================

  return (
    <div
      data-testid="wm-sketch-tab"
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Mobile pages carry less chrome above the tab, so reclaim that space
        // for the canvas rather than leaving the editor letterboxed.
        height: isMobile ? 'calc(100vh - 140px)' : 'calc(100vh - 260px)',
        minHeight: isMobile ? 460 : 500,
        background: '#fff',
      }}
    >
      {/* Address header */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
          <EnvironmentOutlined style={{ color: '#8c8c8c', flexShrink: 0 }} />
          <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {jobAddress}
          </Text>
          {floors.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
              — {floors.length} floor{floors.length !== 1 ? 's' : ''}
            </Text>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <Tooltip title={floors.length === 0 ? 'Add a floor sketch first' : 'Generate Scope of Work from sketch data'}>
            <Button
              icon={<FileTextOutlined />}
              size="small"
              loading={scopeGenerating}
              disabled={floors.length === 0}
              onClick={handleGenerateScope}
            >
              Scope
            </Button>
          </Tooltip>
          <Tooltip title={floors.length === 0 ? 'Add a floor sketch first' : 'Download PDF Report'}>
            <Dropdown.Button
              icon={<DownOutlined />}
              size="small"
              loading={pdfGenerating}
              disabled={floors.length === 0}
              onClick={() => handleGeneratePdf('a')}
              menu={{
                items: pdfVariantMenu,
                onClick: ({ key }) => handleGeneratePdf(key),
              }}
            >
              <FilePdfOutlined /> PDF
            </Dropdown.Button>
          </Tooltip>
        </div>
      </div>

      {/* Floor selector tabs */}
      {floors.length > 0 && (
        <div style={{ flexShrink: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 4 }}>
          <WMFloorSelector
            floors={floors}
            activeFloorId={activeFloorId}
            onFloorSelect={setActiveFloorId}
            onAddFloor={handleAddFloor}
            onDeleteFloor={handleDeleteFloor}
            onReorderFloor={handleReorderFloor}
            onRenameFloor={handleRenameFloor}
          />
        </div>
      )}

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {floors.length === 0 ? (
          /* Empty state */
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 300,
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" align="center">
                  <Text type="secondary">No floor sketches yet.</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Add your first floor to start sketching the job site.
                  </Text>
                </Space>
              }
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                size="large"
                onClick={() => handleAddFloor('1st Floor', 'sketch')}
              >
                Add First Floor
              </Button>
            </Empty>
          </div>
        ) : activeFloor ? (
          <WMFloorSketchEditor
            floorSketch={activeFloor}
            materialTypes={materialTypes}
            onOverlayChanged={handleOverlayChanged}
            onSave={handleSave}
            onImageUploaded={handleImageUploaded}
            onImageRemoved={handleImageRemoved}
            onScaleChanged={handleScaleChanged}
            onImportFromMagicPlan={handleOpenMagicPlanModal}
            isMagicPlanImporting={mpImporting}
            jobId={jobId}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Select a floor above to begin editing."
            />
          </div>
        )}
      </div>

      {/* MagicPlan floor plan selection modal */}
      <MagicPlanFloorPlanSelectModal
        open={mpFloorPlanModal}
        onClose={() => setMpFloorPlanModal(false)}
        onSelect={handleMagicPlanFloorSelect}
        jobId={jobId}
        currentFloorLabel={activeFloor?.floor_label || 'Current Floor'}
        loading={mpImporting}
      />
    </div>
  );
};

export default WMSketchTab;
