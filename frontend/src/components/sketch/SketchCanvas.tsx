import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layout, Spin, Card, message } from 'antd';
import SketchToolbar from './toolbar/SketchToolbar';
import SketchViewport from './viewport/SketchViewport';
import SketchSidebar from './sidebar/SketchSidebar';
import SketchStatusBar from './statusbar/SketchStatusBar';
import { useSketch } from './hooks/useSketch';
import { SketchDocument, SketchExportOptions, SketchExportResult } from '../../types/sketch';
import './Sketch.css';
import { SketchProvider } from './context/SketchProvider';
import './SketchCanvas.less';

const { Content, Sider } = Layout;

export interface SketchCanvasProps {
  /** Unique identifier for this sketch instance */
  instanceId: string;

  /** Initial sketch document (optional) */
  initialSketch?: SketchDocument;

  /** Document type for integration context */
  documentType?: 'estimate' | 'invoice' | 'work_order' | 'standalone';

  /** Associated document ID for integration */
  documentId?: string;

  /** Canvas dimensions */
  width?: number | string;
  height?: number | string;

  /** Whether the sketch is read-only */
  readOnly?: boolean;

  /** Whether to show the sidebar */
  showSidebar?: boolean;

  /** Whether to show the toolbar */
  showToolbar?: boolean;

  /** Whether to show the status bar */
  showStatusBar?: boolean;

  /** Callback when sketch data changes */
  onSketchChange?: (sketch: SketchDocument) => void;

  /** Callback when areas are calculated */
  onAreasCalculated?: (areas: Record<string, number>) => void;

  /** Callback when sketch is saved */
  onSave?: (sketch: SketchDocument) => Promise<void>;

  /** Callback when sketch is exported */
  onExport?: (result: SketchExportResult) => void;

  /** Custom CSS class name */
  className?: string;

  /** Custom styles */
  style?: React.CSSProperties;
}

/**
 * SketchCanvas - Main container component for the interior sketch system
 *
 * Features:
 * - Isolated state management per instance
 * - Integration with existing MJ React App patterns
 * - Responsive layout with collapsible sidebar
 * - Touch and mouse support
 * - Keyboard shortcuts
 * - Export capabilities
 */
const SketchCanvasInternal: React.FC<SketchCanvasProps> = ({
  instanceId,
  initialSketch,
  documentType = 'standalone',
  documentId,
  width = '100%',
  height = '600px',
  readOnly = false,
  showSidebar = true,
  showToolbar = true,
  showStatusBar = true,
  onSketchChange,
  onAreasCalculated,
  onSave,
  onExport,
  className = '',
  style = {},
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });

  // Detect viewport size for responsive canvas with proper container measurement
  useEffect(() => {
    const updateViewportSize = () => {
      // Try viewport element first, fall back to container
      const mainElement = viewportRef.current || containerRef.current;
      if (mainElement) {
        const rect = mainElement.getBoundingClientRect();

        // Start with available dimensions
        let availableWidth = rect.width;
        let availableHeight = rect.height;

        // If using container ref, account for UI elements
        if (mainElement === containerRef.current) {
          // Account for sidebar width when visible and not collapsed
          const sidebarWidth = showSidebar ? 320 : 0;

          // Account for toolbar and status bar heights
          const toolbarHeight = showToolbar ? 48 : 0;
          const statusBarHeight = showStatusBar ? 32 : 0;

          // Calculate available space
          availableWidth = Math.max(300, availableWidth - sidebarWidth - 8); // 8px for padding
          availableHeight = Math.max(200, availableHeight - toolbarHeight - statusBarHeight - 8);
        } else {
          // Using viewport ref - minimal padding only
          const borderPadding = 4;
          availableWidth = Math.max(300, availableWidth - borderPadding);
          availableHeight = Math.max(200, availableHeight - borderPadding);
        }

        setViewportSize({
          width: availableWidth,
          height: availableHeight
        });
      }
    };

    // Initial size update
    updateViewportSize();

    // Use ResizeObserver for accurate container size detection
    let resizeObserver: ResizeObserver | null = null;

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        updateViewportSize();
      });

      // Observe both viewport and container if available
      if (viewportRef.current) {
        resizeObserver.observe(viewportRef.current);
      }
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [showToolbar, showSidebar, showStatusBar]);

  const {
    sketch,
    loading,
    error,
    updateSketch,
    exportSketch,
    saveSketch,
  } = useSketch(instanceId, initialSketch);

  // Handle sketch changes
  useEffect(() => {
    if (sketch && onSketchChange) {
      onSketchChange(sketch);
    }
  }, [sketch, onSketchChange]);

  // Handle area calculations
  useEffect(() => {
    if (sketch?.metadata.totalAreas && onAreasCalculated) {
      const areas: Record<string, number> = {};
      sketch.rooms.forEach(room => {
        areas[room.id] = room.areas.floorArea;
      });
      areas['total'] = sketch.metadata.totalAreas.floorArea;
      onAreasCalculated(areas);
    }
  }, [sketch?.metadata.totalAreas, sketch?.rooms, onAreasCalculated]);

  // Handle save action
  const handleSave = useCallback(async () => {
    if (!sketch) return;

    try {
      if (onSave) {
        await onSave(sketch);
      } else {
        await saveSketch();
      }
      message.success('Sketch saved successfully');
    } catch (error) {
      message.error('Failed to save sketch');
      console.error('Save error:', error);
    }
  }, [sketch, onSave, saveSketch]);

  // Handle export action
  const handleExport = useCallback(async (options: SketchExportOptions) => {
    if (!sketch) return;

    try {
      const result = await exportSketch(options);
      if (onExport) {
        onExport(result);
      }
      message.success('Sketch exported successfully');
    } catch (error) {
      message.error('Failed to export sketch');
      console.error('Export error:', error);
    }
  }, [sketch, exportSketch, onExport]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (readOnly) return;

      // Only handle shortcuts when sketch canvas is focused
      const isSketchFocused = containerRef.current?.contains(document.activeElement);
      if (!isSketchFocused) return;

      const { ctrlKey, metaKey, key } = event;
      const cmdKey = ctrlKey || metaKey;

      switch (key) {
        case 's':
          if (cmdKey) {
            event.preventDefault();
            handleSave();
          }
          break;
        case 'z':
          if (cmdKey && !event.shiftKey) {
            event.preventDefault();
            // Handle undo - will be implemented in hooks
          }
          break;
        case 'z':
          if (cmdKey && event.shiftKey) {
            event.preventDefault();
            // Handle redo - will be implemented in hooks
          }
          break;
        case 'y':
          if (cmdKey) {
            event.preventDefault();
            // Handle redo - will be implemented in hooks
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, [readOnly, handleSave]);

  if (error) {
    return (
      <Card className={`sketch-canvas-error ${className}`} style={style}>
        <div className="sketch-error-content">
          <h3>Sketch Load Error</h3>
          <p>{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`sketch-canvas-container ${className}`}
      style={{ width, height, ...style }}
      tabIndex={0}
    >
      <Spin spinning={loading} tip="Loading sketch...">
        <Layout className="sketch-canvas-layout">
          {/* Toolbar */}
          {showToolbar && (
            <div className="sketch-toolbar-container">
              <SketchToolbar />
            </div>
          )}

          {/* Main Content Area */}
          <Layout className="sketch-content-layout">
            {/* Drawing Viewport */}
            <Content ref={viewportRef} className="sketch-viewport-container">
              <SketchViewport
                width={viewportSize.width}
                height={viewportSize.height}
              />
            </Content>

            {/* Sidebar */}
            {showSidebar && (
              <Sider
                className="sketch-sidebar-container"
                width={320}
                collapsible
                theme="light"
                breakpoint="lg"
                collapsedWidth={0}
              >
                <SketchSidebar />
              </Sider>
            )}
          </Layout>

          {/* Status Bar */}
          {showStatusBar && (
            <div className="sketch-statusbar-container">
              <SketchStatusBar />
            </div>
          )}
        </Layout>
      </Spin>
    </div>
  );
};

/**
 * SketchCanvas with Provider wrapper for state isolation
 */
const SketchCanvas: React.FC<SketchCanvasProps> = (props) => {
  return (
    <SketchProvider instanceId={props.instanceId} initialSketch={props.initialSketch}>
      <SketchCanvasInternal {...props} />
    </SketchProvider>
  );
};

export default SketchCanvas;