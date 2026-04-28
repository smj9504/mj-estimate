/**
 * FieldMappingEditor - PDF template field mapping editor
 * Renders PDF pages with Konva overlay for placing/editing field markers.
 * Each field marker maps to a client/claim/company/meta data source.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Stage, Layer, Image as KonvaImage, Rect, Text as KonvaText, Group,
} from 'react-konva';
import Konva from 'konva';
import {
  Modal, Button, Select, InputNumber, Space, Spin, Typography,
  message, Divider, List, Tag, Popconfirm, Empty, Tooltip,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined,
  ZoomInOutlined, ZoomOutOutlined, LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import * as pdfjs from 'pdfjs-dist';
import { contractTemplateService } from '../../services/contractService';
import { AVAILABLE_FIELDS, getCategoryColor } from './fieldMappingConstants';
import type { FieldMappingItem, AvailableField } from '../../types/contract';

const { Text } = Typography;

// Setup pdfjs worker
if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

interface FieldMappingEditorProps {
  open: boolean;
  templateId: string;
  templateName: string;
  fileUrl: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface RenderedPage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

let idCounter = 0;
const genId = () => `fm_${Date.now()}_${++idCounter}`;

const FieldMappingEditor: React.FC<FieldMappingEditorProps> = ({
  open, templateId, templateName, fileUrl, onClose, onSaved,
}) => {
  const [fields, setFields] = useState<FieldMappingItem[]>([]);
  const [availableFields, setAvailableFields] = useState<AvailableField[]>(AVAILABLE_FIELDS);
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [scale, setScale] = useState(1);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<Konva.Stage>(null);

  const currentPageData = renderedPages[currentPage];
  const stageWidth = currentPageData ? currentPageData.width * scale : 600;
  const stageHeight = currentPageData ? currentPageData.height * scale : 800;
  const fieldsOnPage = fields.filter(f => f.pageIndex === currentPage);
  const selectedField = fields.find(f => f.id === selectedFieldId);

  // Load PDF and field mappings when opened
  useEffect(() => {
    if (open && templateId) {
      loadFieldMappings();
      loadPdf();
    }
    return () => {
      if (!open) {
        setRenderedPages([]);
        setCurrentPage(0);
        setSelectedFieldId(null);
      }
    };
  }, [open, templateId]);

  const loadFieldMappings = async () => {
    try {
      const data = await contractTemplateService.getFieldMappings(templateId);
      setFields(data.field_mappings || []);
      if (data.available_fields?.length) {
        setAvailableFields(data.available_fields);
      }
    } catch (err) {
      console.error('Failed to load field mappings:', err);
    }
  };

  const loadPdf = async () => {
    if (!fileUrl) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(fileUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      await renderPdfPages(buffer);
    } catch (err: any) {
      message.error(`Failed to load PDF: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderPdfPages = useCallback(async (buffer: ArrayBuffer) => {
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pages: RenderedPage[] = [];
    const RENDER_SCALE = 2;

    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const img = await new Promise<HTMLImageElement>((resolve) => {
        const image = new window.Image();
        image.onload = () => resolve(image);
        image.src = canvas.toDataURL('image/png');
      });

      pages.push({
        image: img,
        width: viewport.width / RENDER_SCALE,
        height: viewport.height / RENDER_SCALE,
      });
    }

    setRenderedPages(pages);
  }, []);

  // Add new field at click position
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage()
      || e.target.name() === 'pdf-bg';

    if (clickedOnEmpty) {
      setSelectedFieldId(null);
    }
  };

  const handleAddField = () => {
    const newField: FieldMappingItem = {
      id: genId(),
      pageIndex: currentPage,
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.03,
      fieldKey: '',
      label: 'New Field',
      fontSize: 12,
      fontColor: '#000000',
    };
    setFields(prev => [...prev, newField]);
    setSelectedFieldId(newField.id);
  };

  const handleFieldDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const x = Math.max(0, Math.min(1, e.target.x() / stageWidth));
    const y = Math.max(0, Math.min(1, e.target.y() / stageHeight));
    setFields(prev => prev.map(f => f.id === id ? { ...f, x, y } : f));
  };

  const handleFieldTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const newWidth = Math.max(0.02, (node.width() * scaleX) / stageWidth);
    const newHeight = Math.max(0.01, (node.height() * scaleY) / stageHeight);
    const x = Math.max(0, node.x() / stageWidth);
    const y = Math.max(0, node.y() / stageHeight);

    setFields(prev => prev.map(f =>
      f.id === id ? { ...f, x, y, width: newWidth, height: newHeight } : f
    ));
  };

  const handleFieldKeyChange = (fieldId: string, fieldKey: string) => {
    const fieldDef = availableFields.find(f => f.key === fieldKey);
    setFields(prev => prev.map(f =>
      f.id === fieldId
        ? { ...f, fieldKey, label: fieldDef?.label || fieldKey }
        : f
    ));
  };

  const handleDeleteField = (fieldId: string) => {
    setFields(prev => prev.filter(f => f.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  const handleFontSizeChange = (fieldId: string, fontSize: number) => {
    setFields(prev => prev.map(f =>
      f.id === fieldId ? { ...f, fontSize } : f
    ));
  };

  const handleSave = async () => {
    // Validate all fields have a fieldKey assigned
    const unmapped = fields.filter(f => !f.fieldKey);
    if (unmapped.length > 0) {
      message.warning(`${unmapped.length} field(s) have no data source assigned`);
    }

    setSaving(true);
    try {
      await contractTemplateService.updateFieldMappings(templateId, fields);
      message.success('Field mappings saved');
      onSaved?.();
      onClose();
    } catch (err: any) {
      message.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Group available fields by category for the Select dropdown
  const fieldOptions = ['Client', 'Claim', 'Company', 'Meta'].map(cat => ({
    label: cat,
    options: availableFields
      .filter(f => f.category === cat)
      .map(f => ({ label: f.label, value: f.key })),
  }));

  return (
    <Modal
      title={`Field Mapping - ${templateName}`}
      open={open}
      onCancel={onClose}
      width="95vw"
      style={{ top: 20 }}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          Save Mappings
        </Button>,
      ]}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#8c8c8c' }}>Loading PDF...</div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, height: 'calc(90vh - 120px)' }}>
          {/* Left: PDF with Konva overlay */}
          <div style={{ flex: 1, overflow: 'auto', background: '#e8e8e8', borderRadius: 8 }}>
            {/* Toolbar */}
            <div style={{
              padding: '8px 12px',
              background: '#fafafa',
              borderBottom: '1px solid #d9d9d9',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleAddField}
              >
                Add Field
              </Button>
              <Divider type="vertical" />
              <Button
                size="small"
                icon={<LeftOutlined />}
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(p => p - 1)}
              />
              <Text style={{ minWidth: 80, textAlign: 'center' }}>
                Page {currentPage + 1} / {renderedPages.length || 1}
              </Text>
              <Button
                size="small"
                icon={<RightOutlined />}
                disabled={currentPage >= renderedPages.length - 1}
                onClick={() => setCurrentPage(p => p + 1)}
              />
              <Divider type="vertical" />
              <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setScale(s => Math.max(0.5, s - 0.25))} />
              <Text>{Math.round(scale * 100)}%</Text>
              <Button size="small" icon={<ZoomInOutlined />} onClick={() => setScale(s => Math.min(3, s + 0.25))} />
            </div>

            {/* PDF Canvas */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
              {currentPageData && (
                <div style={{
                  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                  background: '#fff',
                  width: stageWidth,
                  height: stageHeight,
                }}>
                  <Stage
                    ref={stageRef}
                    width={stageWidth}
                    height={stageHeight}
                    onClick={handleStageClick}
                  >
                    <Layer>
                      <KonvaImage
                        name="pdf-bg"
                        image={currentPageData.image}
                        width={stageWidth}
                        height={stageHeight}
                        listening={true}
                      />
                      {fieldsOnPage.map(field => {
                        const fieldDef = availableFields.find(af => af.key === field.fieldKey);
                        const catColor = fieldDef
                          ? getCategoryColor(fieldDef.category)
                          : '#999';
                        const isSelected = selectedFieldId === field.id;

                        return (
                          <Group
                            key={field.id}
                            id={field.id}
                            x={field.x * stageWidth}
                            y={field.y * stageHeight}
                            draggable
                            onClick={() => setSelectedFieldId(field.id)}
                            onTap={() => setSelectedFieldId(field.id)}
                            onDragEnd={(e) => handleFieldDragEnd(field.id, e)}
                            onTransformEnd={(e) => handleFieldTransformEnd(field.id, e)}
                          >
                            <Rect
                              width={field.width * stageWidth}
                              height={field.height * stageHeight}
                              fill={`${catColor}15`}
                              stroke={isSelected ? catColor : `${catColor}80`}
                              strokeWidth={isSelected ? 2 : 1}
                              dash={field.fieldKey ? undefined : [4, 4]}
                              cornerRadius={2}
                            />
                            <KonvaText
                              text={field.label}
                              fontSize={10 * scale}
                              fill={catColor}
                              x={4}
                              y={2}
                              width={(field.width * stageWidth) - 8}
                              ellipsis
                              wrap="none"
                            />
                          </Group>
                        );
                      })}
                    </Layer>
                  </Stage>
                </div>
              )}
            </div>
          </div>

          {/* Right: Properties Panel */}
          <div style={{
            width: 320,
            flexShrink: 0,
            overflow: 'auto',
            background: '#fafafa',
            borderRadius: 8,
            padding: 16,
            border: '1px solid #d9d9d9',
          }}>
            <Text strong style={{ fontSize: 14 }}>
              Fields ({fields.length})
            </Text>
            <Divider style={{ margin: '8px 0' }} />

            {selectedField ? (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Selected Field</Text>
                <div style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 12 }}>Data Source:</Text>
                  <Select
                    style={{ width: '100%', marginTop: 4 }}
                    placeholder="Select data field..."
                    value={selectedField.fieldKey || undefined}
                    onChange={(val) => handleFieldKeyChange(selectedField.id, val)}
                    options={fieldOptions}
                    showSearch
                    optionFilterProp="label"
                    size="small"
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Text style={{ fontSize: 12 }}>Font Size:</Text>
                  <InputNumber
                    style={{ width: '100%', marginTop: 4 }}
                    min={6}
                    max={72}
                    value={selectedField.fontSize}
                    onChange={(val) => val && handleFontSizeChange(selectedField.id, val)}
                    size="small"
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Popconfirm
                    title="Delete this field?"
                    onConfirm={() => handleDeleteField(selectedField.id)}
                  >
                    <Button danger size="small" icon={<DeleteOutlined />} block>
                      Delete Field
                    </Button>
                  </Popconfirm>
                </div>
                <Divider style={{ margin: '16px 0 8px' }} />
              </div>
            ) : (
              <div style={{ marginBottom: 12, color: '#8c8c8c', fontSize: 12 }}>
                Click a field on the PDF or in the list to edit
              </div>
            )}

            <Text type="secondary" style={{ fontSize: 12 }}>All Fields</Text>
            {fields.length === 0 ? (
              <Empty
                description="No fields yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ marginTop: 16 }}
              >
                <Button size="small" type="primary" onClick={handleAddField}>
                  Add First Field
                </Button>
              </Empty>
            ) : (
              <List
                size="small"
                style={{ marginTop: 8 }}
                dataSource={fields}
                renderItem={(field) => {
                  const fieldDef = availableFields.find(af => af.key === field.fieldKey);
                  return (
                    <List.Item
                      style={{
                        cursor: 'pointer',
                        background: selectedFieldId === field.id ? '#e6f4ff' : undefined,
                        padding: '4px 8px',
                        borderRadius: 4,
                      }}
                      onClick={() => {
                        setSelectedFieldId(field.id);
                        if (field.pageIndex !== currentPage) {
                          setCurrentPage(field.pageIndex);
                        }
                      }}
                      extra={
                        <Tooltip title="Delete">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteField(field.id);
                            }}
                          />
                        </Tooltip>
                      }
                    >
                      <List.Item.Meta
                        title={
                          <span style={{ fontSize: 12 }}>
                            {fieldDef ? (
                              <Tag color={getCategoryColor(fieldDef.category)} style={{ fontSize: 10 }}>
                                {fieldDef.category}
                              </Tag>
                            ) : (
                              <Tag color="default" style={{ fontSize: 10 }}>Unmapped</Tag>
                            )}
                            {field.label}
                          </span>
                        }
                        description={
                          <span style={{ fontSize: 11 }}>
                            Page {field.pageIndex + 1} | {field.fieldKey || 'No data source'}
                          </span>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default FieldMappingEditor;
