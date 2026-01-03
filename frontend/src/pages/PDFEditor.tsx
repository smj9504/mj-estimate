import React, { useState, useRef } from 'react';
import {
  Layout,
  Card,
  Upload,
  Button,
  Space,
  message,
  Input,
  InputNumber,
  Select,
  ColorPicker,
  Drawer,
  Typography,
  Divider,
  Row,
  Col,
  Spin,
} from 'antd';
import {
  UploadOutlined,
  EditOutlined,
  SaveOutlined,
  DeleteOutlined,
  PlusOutlined,
  EyeOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfEditorService, { TextEditOperation } from '../services/pdfEditorService';
import fileService from '../services/fileService';

// Import react-pdf styles - must be imported before using Document/Page components
// react-pdf v10 requires these CSS files for text selection and annotations
// These imports are required even though react-pdf may show warnings
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

// Set up PDF.js worker
// Use worker matching react-pdf's pdfjs-dist version (5.4.296)
if (typeof window !== 'undefined') {
  // Use CDN with exact version matching react-pdf's pdfjs-dist
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

interface EditMode {
  type: 'add' | 'edit' | 'delete' | null;
  operation: TextEditOperation | null;
}

const PDFEditor: React.FC = () => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  
  // Cleanup blob URLs on unmount
  React.useEffect(() => {
    return () => {
      if (pdfUrl && pdfUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [edits, setEdits] = useState<TextEditOperation[]>([]);
  const [editMode, setEditMode] = useState<EditMode>({ type: null, operation: null });
  const [fileId, setFileId] = useState<string | null>(null);
  const [pageScale, setPageScale] = useState<number>(1.5);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [selectedEditIndex, setSelectedEditIndex] = useState<number | null>(null);

  // Form states for editing
  const [editForm, setEditForm] = useState({
    text: '',
    x: 0,
    y: 0,
    width: 200,
    height: 20,
    font_size: 12,
    font_family: 'Helvetica',
    color: '#000000',
  });

  // Handle file upload
  const handleFileUpload = async (file: File) => {
    try {
      setLoading(true);
      setPdfFile(file);
      
      // Upload file first
      const uploadedFiles = await fileService.uploadFiles(
        [file],
        'pdf_editor',
        'default',
        'pdf_upload'
      );

      if (uploadedFiles && uploadedFiles.length > 0) {
        const uploadedFile = uploadedFiles[0];
        setFileId(uploadedFile.id);
        
        // Load PDF as blob with authentication
        try {
          // Clean up previous blob URL if exists
          if (pdfUrl && pdfUrl.startsWith('blob:')) {
            URL.revokeObjectURL(pdfUrl);
          }
          
          const previewUrl = fileService.getPreviewUrl(uploadedFile.id);
          const token = localStorage.getItem('auth_token');
          
          console.log('Fetching PDF from:', previewUrl);
          
          const response = await fetch(previewUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (!response.ok) {
            throw new Error(`Failed to load PDF: ${response.status} ${response.statusText}`);
          }
          
          const blob = await response.blob();
          console.log('Blob received:', {
            size: blob.size,
            type: blob.type,
          });
          
          // Ensure blob has correct content type
          if (!blob.type || blob.type !== 'application/pdf') {
            console.warn('Blob type is not application/pdf, creating new blob with correct type');
            const typedBlob = new Blob([blob], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(typedBlob);
            setPdfUrl(blobUrl);
          } else {
            const blobUrl = URL.createObjectURL(blob);
            setPdfUrl(blobUrl);
          }
          
          console.log('PDF File ID:', uploadedFile.id);
          console.log('PDF URL set, waiting for Document component...');
          
          setEdits([]);
          message.success('PDF uploaded successfully');
        } catch (loadError: any) {
          console.error('PDF load error:', loadError);
          message.error(`Failed to load PDF: ${loadError.message}`);
        }
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      message.error(`Failed to upload PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle PDF load
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  };

  // Reset selection when page changes
  React.useEffect(() => {
    setSelectedEditIndex(null);
    setEditMode({ type: null, operation: null });
  }, [currentPage]);

  // Handle page load to get dimensions
  const onPageLoadSuccess = (page: any) => {
    if (page) {
      const viewport = page.getViewport({ scale: pageScale });
      setPageDimensions({
        width: viewport.width,
        height: viewport.height,
      });
    }
  };

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    const edit = edits[index];
    if (edit.page_number !== currentPage) return;

    setDraggingIndex(index);
    setSelectedEditIndex(index);
    
    // Get the canvas element position for accurate drag calculation
    const pageContainer = pageRef.current;
    const canvas = pageContainer?.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect() || pageContainer?.getBoundingClientRect();
    
    if (rect) {
      setDragStart({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  // Handle drag move
  const handleDragMove = (e: React.MouseEvent) => {
    if (draggingIndex === null || !dragStart || !canvasRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = canvasRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    // Calculate delta (adjusted for scale)
    const deltaX = (currentX - dragStart.x) / pageScale;
    const deltaY = (currentY - dragStart.y) / pageScale;

    // Update the edit position
    const updatedEdits = [...edits];
    const edit = updatedEdits[draggingIndex];
    
    updatedEdits[draggingIndex] = {
      ...edit,
      x: Math.max(0, Math.round(edit.x + deltaX)),
      y: Math.max(0, Math.round(edit.y + deltaY)),
    };

    setEdits(updatedEdits);
    setDragStart({
      x: currentX,
      y: currentY,
    });
  };

  // Handle drag end
  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDragStart(null);
  };

  // Set up global mouse events for dragging
  React.useEffect(() => {
    if (draggingIndex !== null) {
      const handleMouseMove = (e: MouseEvent) => {
        if (draggingIndex === null || !dragStart) return;

        // Get canvas position for accurate calculation
        const pageContainer = pageRef.current;
        const canvas = pageContainer?.querySelector('canvas');
        const rect = canvas?.getBoundingClientRect() || pageContainer?.getBoundingClientRect();
        
        if (!rect) return;

        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const deltaX = (currentX - dragStart.x) / pageScale;
        const deltaY = (currentY - dragStart.y) / pageScale;

        setEdits((prevEdits) => {
          const updatedEdits = [...prevEdits];
          const edit = updatedEdits[draggingIndex];
          
          updatedEdits[draggingIndex] = {
            ...edit,
            x: Math.max(0, Math.round(edit.x + deltaX)),
            y: Math.max(0, Math.round(edit.y + deltaY)),
          };

          return updatedEdits;
        });

        setDragStart({
          x: currentX,
          y: currentY,
        });
      };

      const handleMouseUp = () => {
        handleDragEnd();
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingIndex, dragStart, pageScale]);

  // Handle page click for adding text
  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Don't add text if clicking on a text overlay
    if ((event.target as HTMLElement).closest('.pdf-text-overlay')) {
      return;
    }

    if (editMode.type !== 'add') {
      // Deselect if clicking elsewhere
      setSelectedEditIndex(null);
      setEditMode({ type: null, operation: null });
      return;
    }

    // If in add mode and text is set, add text at clicked position
    if (editForm.text.trim()) {
      // Find the PDF page canvas element to get accurate position
      const pageContainer = pageRef.current;
      if (!pageContainer) return;

      // Find the canvas element inside the page
      const canvas = pageContainer.querySelector('canvas');
      if (!canvas) {
        // Fallback to container position
        const containerRect = pageContainer.getBoundingClientRect();
        const x = (event.clientX - containerRect.left) / pageScale;
        const y = (event.clientY - containerRect.top) / pageScale;

        const newEdit: TextEditOperation = {
          operation: 'add',
          page_number: currentPage,
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          text: editForm.text,
          width: editForm.width,
          height: editForm.height,
          font_size: editForm.font_size,
          font_family: editForm.font_family,
          color: editForm.color,
        };

        setEdits([...edits, newEdit]);
        setEditForm({ ...editForm, text: '' });
        message.success('Text added. You can drag it to move.');
        return;
      }

      // Get canvas position relative to viewport
      const canvasRect = canvas.getBoundingClientRect();
      const x = (event.clientX - canvasRect.left) / pageScale;
      const y = (event.clientY - canvasRect.top) / pageScale;

      const newEdit: TextEditOperation = {
        operation: 'add',
        page_number: currentPage,
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
        text: editForm.text,
        width: editForm.width,
        height: editForm.height,
        font_size: editForm.font_size,
        font_family: editForm.font_family,
        color: editForm.color,
      };

      setEdits([...edits, newEdit]);
      setEditForm({ ...editForm, text: '' }); // Clear text but keep other settings
      message.success('Text added. You can drag it to move.');
    } else {
      // If no text, keep drawer open to enter text
      // Don't close drawer
    }
  };


  // Load edit data into form when editing
  React.useEffect(() => {
    if (editMode.type === 'edit' && editMode.operation) {
      const edit = editMode.operation;
      setEditForm({
        text: edit.text || '',
        x: edit.x || 0, // Keep for reference but don't show in UI
        y: edit.y || 0, // Keep for reference but don't show in UI
        width: edit.width || 200,
        height: edit.height || 20,
        font_size: edit.font_size || 12,
        font_family: edit.font_family || 'Helvetica',
        color: edit.color || '#000000',
      });
    } else if (editMode.type === 'add') {
      // Keep current settings but clear text
      setEditForm((prev) => ({
        ...prev,
        text: '',
      }));
    }
  }, [editMode]);

  // Delete edit
  const handleDeleteEdit = (index: number) => {
    const newEdits = edits.filter((_, i) => i !== index);
    setEdits(newEdits);
    if (selectedEditIndex === index) {
      setSelectedEditIndex(null);
    }
    message.success('Edit removed');
  };

  // Save edits
  const handleSave = async () => {
    if (!fileId && !pdfUrl) {
      message.error('Please upload a PDF first');
      return;
    }

    if (edits.length === 0) {
      message.warning('No edits to save');
      return;
    }

    try {
      setLoading(true);

      const request = {
        file_id: fileId || undefined,
        file_url: pdfUrl || undefined,
        edits: edits,
      };

      const response = await pdfEditorService.editPDF(request);
      
      if (response.success) {
        message.success('PDF saved successfully!');
        
        // Reload the edited PDF
        if (response.file_url) {
          setPdfUrl(response.file_url);
        }
        if (response.file_id) {
          setFileId(response.file_id);
        }
        
        setEdits([]);
      }
    } catch (error: any) {
      console.error('Save error:', error);
      message.error(`Failed to save PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Download PDF
  const handleDownload = () => {
    if (pdfUrl) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = 'edited_document.pdf';
      link.click();
    }
  };

  return (
    <Content style={{ padding: '24px' }}>
      <Card>
        <Title level={2}>PDF Editor</Title>
        
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* Upload Section */}
          <Card title="Upload PDF" size="small">
            <Upload
              accept="application/pdf"
              beforeUpload={(file) => {
                handleFileUpload(file);
                return false;
              }}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />} loading={loading}>
                Upload PDF
              </Button>
            </Upload>
          </Card>

          {pdfUrl && (
            <>
              {/* Editor Controls */}
              <Card title="Editor Tools" size="small">
                <Space wrap>
                  <Button
                    type={editMode.type === 'add' ? 'primary' : 'default'}
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditMode({ type: 'add', operation: null });
                      if (!editForm.text.trim()) {
                        // Open drawer if no text set
                      }
                    }}
                  >
                    Add Text
                  </Button>
                  <Button
                    icon={<SaveOutlined />}
                    type="primary"
                    onClick={handleSave}
                    loading={loading}
                  >
                    Save PDF
                  </Button>
                  <Button
                    icon={<EyeOutlined />}
                    onClick={handleDownload}
                  >
                    Download
                  </Button>
                  <Button
                    icon={<UndoOutlined />}
                    onClick={() => setEdits([])}
                    disabled={edits.length === 0}
                  >
                    Clear Edits
                  </Button>
                </Space>

                {/* Edit Form Drawer */}
                <Drawer
                  title={editMode.type === 'edit' ? 'Edit Text' : 'Add Text'}
                  placement="right"
                  onClose={() => {
                    setEditMode({ type: null, operation: null });
                    setSelectedEditIndex(null);
                  }}
                  open={editMode.type === 'add' || editMode.type === 'edit'}
                  width={400}
                >
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                      <Text strong>Text Content:</Text>
                      <TextArea
                        value={editForm.text}
                        onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                        rows={3}
                        placeholder="Enter text to add"
                      />
                    </div>

                    {editMode.type === 'edit' && selectedEditIndex !== null && (
                      <div>
                        <Text strong>Position:</Text>
                        <Text style={{ display: 'block', marginTop: 4, color: '#666' }}>
                          X: {edits[selectedEditIndex]?.x || 0}, Y: {edits[selectedEditIndex]?.y || 0}
                        </Text>
                        <Text type="secondary" style={{ fontSize: '12px' }}>
                          Drag the text on PDF to change position
                        </Text>
                      </div>
                    )}

                    <Row gutter={16}>
                      <Col span={12}>
                        <Text strong>Width:</Text>
                        <InputNumber
                          value={editForm.width}
                          onChange={(val) => setEditForm({ ...editForm, width: val || 200 })}
                          style={{ width: '100%' }}
                        />
                      </Col>
                      <Col span={12}>
                        <Text strong>Height:</Text>
                        <InputNumber
                          value={editForm.height}
                          onChange={(val) => setEditForm({ ...editForm, height: val || 20 })}
                          style={{ width: '100%' }}
                        />
                      </Col>
                    </Row>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Text strong>Font Size:</Text>
                        <InputNumber
                          value={editForm.font_size}
                          onChange={(val) => setEditForm({ ...editForm, font_size: val || 12 })}
                          min={8}
                          max={72}
                          style={{ width: '100%' }}
                        />
                      </Col>
                      <Col span={12}>
                        <Text strong>Font Family:</Text>
                        <Select
                          value={editForm.font_family}
                          onChange={(val) => setEditForm({ ...editForm, font_family: val })}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'Helvetica', label: 'Helvetica' },
                            { value: 'Times-Roman', label: 'Times Roman' },
                            { value: 'Courier', label: 'Courier' },
                          ]}
                        />
                      </Col>
                    </Row>

                    <div>
                      <Text strong>Text Color:</Text>
                      <ColorPicker
                        value={editForm.color}
                        onChange={(color) => setEditForm({ ...editForm, color: color.toHexString() })}
                        showText
                      />
                    </div>

                    {editMode.type === 'edit' && selectedEditIndex !== null ? (
                      <>
                        <Button
                          type="primary"
                          block
                          onClick={() => {
                            if (selectedEditIndex !== null && editForm.text.trim()) {
                              const updatedEdits = [...edits];
                              updatedEdits[selectedEditIndex] = {
                                ...updatedEdits[selectedEditIndex],
                                text: editForm.text,
                                width: editForm.width,
                                height: editForm.height,
                                font_size: editForm.font_size,
                                font_family: editForm.font_family,
                                color: editForm.color,
                              };
                              setEdits(updatedEdits);
                              setEditMode({ type: null, operation: null });
                              setSelectedEditIndex(null);
                              message.success('Text updated');
                            }
                          }}
                          disabled={!editForm.text.trim()}
                        >
                          Update Text
                        </Button>
                        <Button
                          block
                          danger
                          style={{ marginTop: 8 }}
                          onClick={() => {
                            if (selectedEditIndex !== null) {
                              handleDeleteEdit(selectedEditIndex);
                              setEditMode({ type: null, operation: null });
                              setSelectedEditIndex(null);
                            }
                          }}
                        >
                          Delete Text
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="primary"
                          block
                          onClick={() => {
                            setEditMode({ type: 'add', operation: null });
                          }}
                          disabled={!editForm.text.trim()}
                        >
                          Ready to Add - Click on PDF
                        </Button>
                        <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: 8 }}>
                          Enter text above, then click anywhere on the PDF to place it. You can drag it to move.
                        </Text>
                      </>
                    )}

                    <Divider />

                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {editMode.type === 'add' 
                        ? 'Enter text and click on PDF to place it. Position can be changed by dragging.'
                        : 'Drag the text on PDF to change its position.'}
                    </Text>
                  </Space>
                </Drawer>
              </Card>

              {/* Edits List */}
              {edits.length > 0 && (
                <Card title={`Pending Edits (${edits.length})`} size="small">
                  {edits.map((edit, index) => (
                    <div
                      key={index}
                      onClick={() => {
                        if (edit.page_number === currentPage) {
                          setSelectedEditIndex(index);
                          setEditMode({ type: 'edit', operation: edit });
                        } else {
                          setCurrentPage(edit.page_number);
                          setTimeout(() => {
                            setSelectedEditIndex(index);
                            setEditMode({ type: 'edit', operation: edit });
                          }, 100);
                        }
                      }}
                      style={{
                        marginBottom: '8px',
                        padding: '8px',
                        background: selectedEditIndex === index ? '#e6f7ff' : '#f5f5f5',
                        border: selectedEditIndex === index ? '2px solid #1890ff' : '1px solid #d9d9d9',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      <Space>
                        <Text>
                          <strong>{edit.operation}</strong> - Page {edit.page_number}: "{edit.text}"
                          (X: {edit.x}, Y: {edit.y})
                        </Text>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEdit(index);
                          }}
                        />
                      </Space>
                    </div>
                  ))}
                </Card>
              )}

              {/* PDF Viewer */}
              <Card
                title={`PDF Viewer - Page ${currentPage} of ${numPages}`}
                extra={
                  <Space>
                    <Button
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <InputNumber
                      min={1}
                      max={numPages}
                      value={currentPage}
                      onChange={(val) => val && setCurrentPage(val)}
                    />
                    <Button
                      disabled={currentPage >= numPages}
                      onClick={() => setCurrentPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                    <Select
                      value={pageScale}
                      onChange={setPageScale}
                      style={{ width: 100 }}
                      options={[
                        { value: 0.5, label: '50%' },
                        { value: 1.0, label: '100%' },
                        { value: 1.5, label: '150%' },
                        { value: 2.0, label: '200%' },
                      ]}
                    />
                  </Space>
                }
              >
                <div
                  ref={canvasRef}
                  onClick={handlePageClick}
                  onMouseMove={handleDragMove}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-start',
                    minHeight: '600px',
                    border: editMode.type === 'add' ? '2px dashed #1890ff' : '1px solid #d9d9d9',
                    borderRadius: '4px',
                    padding: '16px',
                    cursor: editMode.type === 'add' ? 'crosshair' : 'default',
                    background: '#fafafa',
                  }}
                >
                  {pdfUrl ? (
                    <>
                      <div ref={pageRef} style={{ position: 'relative' }}>
                        <Document
                          file={pdfUrl}
                          onLoadSuccess={(success) => {
                            console.log('PDF loaded successfully:', success);
                            onDocumentLoadSuccess(success);
                          }}
                          onLoadError={(error) => {
                            console.error('PDF Document load error:', error);
                            console.error('Error details:', {
                              message: error?.message,
                              name: error?.name,
                              stack: error?.stack,
                            });
                            console.error('PDF URL:', pdfUrl);
                            console.error('Blob URL type:', typeof pdfUrl);
                            message.error(`Failed to load PDF: ${error?.message || 'Unknown error'}`);
                          }}
                          loading={
                            <div style={{ padding: '20px', textAlign: 'center' }}>
                              <Spin size="large" />
                              <Text style={{ display: 'block', marginTop: '16px' }}>
                                Loading PDF...
                              </Text>
                            </div>
                          }
                          error={
                            <div style={{ padding: '20px', textAlign: 'center' }}>
                              <Text type="danger">Failed to load PDF</Text>
                              <br />
                              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
                                Please check the browser console for details
                              </Text>
                            </div>
                          }
                        >
                          <Page
                            pageNumber={currentPage}
                            scale={pageScale}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                            onLoadSuccess={onPageLoadSuccess}
                          />
                        </Document>

                        {/* Text Overlays */}
                        {edits
                          .map((edit, index) => {
                            if (edit.page_number !== currentPage) return null;
                            
                            const isSelected = selectedEditIndex === index;
                            const isDragging = draggingIndex === index;

                            return (
                              <div
                                key={index}
                                className="pdf-text-overlay"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  handleDragStart(e, index);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEditIndex(index);
                                  setEditMode({ type: 'edit', operation: edit });
                                }}
                                style={{
                                  position: 'absolute',
                                  left: `${edit.x * pageScale}px`,
                                  top: `${edit.y * pageScale}px`,
                                  width: `${(edit.width || 200) * pageScale}px`,
                                  minHeight: `${(edit.height || 20) * pageScale}px`,
                                  padding: '2px 4px',
                                  fontSize: `${(edit.font_size || 12) * pageScale}px`,
                                  fontFamily: edit.font_family || 'Helvetica',
                                  color: edit.color || '#000000',
                                  backgroundColor: isSelected || isDragging 
                                    ? 'rgba(24, 144, 255, 0.2)' 
                                    : 'transparent',
                                  border: isSelected || isDragging 
                                    ? '2px solid #1890ff' 
                                    : '1px dashed transparent',
                                  borderRadius: '2px',
                                  cursor: 'move',
                                  pointerEvents: 'auto',
                                  userSelect: 'none',
                                  zIndex: isSelected || isDragging ? 10 : 1,
                                  whiteSpace: 'pre-wrap',
                                  wordWrap: 'break-word',
                                  overflow: 'hidden',
                                }}
                                title={`${edit.text}\nClick to select, drag to move`}
                              >
                                {edit.text || '(Empty)'}
                              </div>
                            );
                          })
                          .filter(Boolean)}
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                      <Text type="secondary">No PDF loaded</Text>
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}
        </Space>
      </Card>
    </Content>
  );
};

export default PDFEditor;

