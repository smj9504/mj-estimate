import React, { useState, useRef } from 'react';
import {
  Upload,
  Modal,
  Image,
  Button,
  Slider,
  Space,
  Radio,
  InputNumber,
  Row,
  Col,
  message,
  Card,
} from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';

interface LogoUploadProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  disabled?: boolean;
}

interface CropSettings {
  mode: 'auto' | 'manual';
  type: 'square' | 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
}

const LogoUpload: React.FC<LogoUploadProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(value || null);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [cropSettings, setCropSettings] = useState<CropSettings>({
    mode: 'auto',
    type: 'square',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    size: 200,
  });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const beforeUpload = (file: File) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('Only image files can be uploaded!');
      return false;
    }

    const isLt5M = file.size / 1024 / 1024 < 5;
    if (!isLt5M) {
      message.error('Image size must be less than 5MB!');
      return false;
    }

    // Convert to base64 and show crop modal
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        // Resize if too large
        const maxSize = 800;
        let { width, height } = img;
        
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = width * ratio;
          height = height * ratio;
        }

        setImageSize({ width, height });
        setCropSettings(prev => ({
          ...prev,
          x: 0,
          y: 0,
          width: Math.min(200, width),
          height: Math.min(200, height),
          size: Math.min(200, Math.min(width, height)),
        }));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const resizedDataUrl = canvas.toDataURL('image/png', 0.95);
          setOriginalImage(resizedDataUrl);
          setCropModalVisible(true);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);

    return false; // Prevent default upload
  };

  const handleCrop = () => {
    if (!originalImage || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new window.Image();
    img.onload = () => {
      let cropWidth, cropHeight, targetWidth, targetHeight;

      if (cropSettings.mode === 'auto') {
        // Use entire image, maintain aspect ratio, max 150px
        const maxDimension = 150;
        if (img.width > img.height) {
          targetWidth = maxDimension;
          targetHeight = (img.height / img.width) * maxDimension;
        } else {
          targetHeight = maxDimension;
          targetWidth = (img.width / img.height) * maxDimension;
        }
        
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      } else {
        // Manual crop
        if (cropSettings.type === 'square') {
          cropWidth = cropHeight = cropSettings.size;
          canvas.width = canvas.height = 150;
        } else {
          cropWidth = cropSettings.width;
          cropHeight = cropSettings.height;
          const maxDimension = 150;
          if (cropWidth > cropHeight) {
            targetWidth = maxDimension;
            targetHeight = (cropHeight / cropWidth) * maxDimension;
          } else {
            targetHeight = maxDimension;
            targetWidth = (cropWidth / cropHeight) * maxDimension;
          }
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }

        ctx.drawImage(
          img,
          cropSettings.x,
          cropSettings.y,
          cropWidth,
          cropHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }

      const croppedDataUrl = canvas.toDataURL('image/png', 0.95);
      setCroppedImage(croppedDataUrl);
      onChange?.(croppedDataUrl);
      setCropModalVisible(false);
      message.success('Logo has been set successfully!');
    };
    img.src = originalImage;
  };

  const handleRemoveLogo = () => {
    setCroppedImage(null);
    onChange?.(undefined);
    setFileList([]);
    message.success('Logo has been removed.');
  };

  const uploadProps: UploadProps = {
    beforeUpload,
    fileList,
    onChange: ({ fileList: newFileList }) => setFileList(newFileList),
    accept: 'image/*',
    disabled,
    showUploadList: false,
  };

  const renderCropPreview = () => {
    if (!originalImage) return null;

    return (
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
          }}
        >
          <img
            src={originalImage}
            alt="Original"
            style={{
              maxWidth: '100%',
              maxHeight: 300,
              display: 'block',
            }}
          />
          {cropSettings.mode === 'manual' && (
            <div
              style={{
                position: 'absolute',
                left: cropSettings.x,
                top: cropSettings.y,
                width: cropSettings.type === 'square' ? cropSettings.size : cropSettings.width,
                height: cropSettings.type === 'square' ? cropSettings.size : cropSettings.height,
                border: '2px solid #1890ff',
                backgroundColor: 'rgba(24, 144, 255, 0.2)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={16}>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />} disabled={disabled} block>
              Upload Logo Image (JPG, PNG)
            </Button>
          </Upload>
        </Col>
        <Col xs={24} md={8}>
          {croppedImage ? (
            <Card size="small" title="Current Logo">
              <div style={{ textAlign: 'center' }}>
                <Image
                  src={croppedImage}
                  alt="Company Logo"
                  width={80}
                  preview={{
                    mask: <EyeOutlined />,
                  }}
                />
                <div style={{ marginTop: 8 }}>
                  <Button
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={handleRemoveLogo}
                    disabled={disabled}
                    danger
                    size="small"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <div
              style={{
                border: '1px dashed #d9d9d9',
                borderRadius: 4,
                padding: 16,
                textAlign: 'center',
                color: '#999',
                minHeight: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              No Logo
            </div>
          )}
        </Col>
      </Row>

      <Modal
        title="Logo Crop"
        open={cropModalVisible}
        onCancel={() => setCropModalVisible(false)}
        onOk={handleCrop}
        width={600}
        okText="Apply"
        cancelText="Cancel"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>Crop Mode:</strong>
            <Radio.Group
              value={cropSettings.mode}
              onChange={(e) => setCropSettings(prev => ({ ...prev, mode: e.target.value }))}
              style={{ marginLeft: 8 }}
            >
              <Radio value="auto">Auto (Full Image)</Radio>
              <Radio value="manual">Manual Crop</Radio>
            </Radio.Group>
          </div>

          {cropSettings.mode === 'manual' && (
            <>
              <div>
                <strong>Crop Type:</strong>
                <Radio.Group
                  value={cropSettings.type}
                  onChange={(e) => setCropSettings(prev => ({ ...prev, type: e.target.value }))}
                  style={{ marginLeft: 8 }}
                >
                  <Radio value="square">Square</Radio>
                  <Radio value="rectangle">Rectangle</Radio>
                </Radio.Group>
              </div>

              {cropSettings.type === 'square' ? (
                <div>
                  <strong>Size:</strong>
                  <Slider
                    min={50}
                    max={Math.min(imageSize.width, imageSize.height)}
                    value={cropSettings.size}
                    onChange={(value) => setCropSettings(prev => ({ ...prev, size: value }))}
                    style={{ marginTop: 8 }}
                  />
                  <InputNumber
                    min={50}
                    max={Math.min(imageSize.width, imageSize.height)}
                    value={cropSettings.size}
                    onChange={(value) => setCropSettings(prev => ({ ...prev, size: value || 50 }))}
                    addonAfter="px"
                  />
                </div>
              ) : (
                <Row gutter={16}>
                  <Col span={12}>
                    <div>
                      <strong>Width:</strong>
                      <InputNumber
                        min={50}
                        max={imageSize.width}
                        value={cropSettings.width}
                        onChange={(value) => setCropSettings(prev => ({ ...prev, width: value || 50 }))}
                        addonAfter="px"
                        style={{ width: '100%', marginTop: 4 }}
                      />
                    </div>
                  </Col>
                  <Col span={12}>
                    <div>
                      <strong>Height:</strong>
                      <InputNumber
                        min={50}
                        max={imageSize.height}
                        value={cropSettings.height}
                        onChange={(value) => setCropSettings(prev => ({ ...prev, height: value || 50 }))}
                        addonAfter="px"
                        style={{ width: '100%', marginTop: 4 }}
                      />
                    </div>
                  </Col>
                </Row>
              )}

              <Row gutter={16}>
                <Col span={12}>
                  <div>
                    <strong>X Position:</strong>
                    <InputNumber
                      min={0}
                      max={imageSize.width - (cropSettings.type === 'square' ? cropSettings.size : cropSettings.width)}
                      value={cropSettings.x}
                      onChange={(value) => setCropSettings(prev => ({ ...prev, x: value || 0 }))}
                      addonAfter="px"
                      style={{ width: '100%', marginTop: 4 }}
                    />
                  </div>
                </Col>
                <Col span={12}>
                  <div>
                    <strong>Y Position:</strong>
                    <InputNumber
                      min={0}
                      max={imageSize.height - (cropSettings.type === 'square' ? cropSettings.size : cropSettings.height)}
                      value={cropSettings.y}
                      onChange={(value) => setCropSettings(prev => ({ ...prev, y: value || 0 }))}
                      addonAfter="px"
                      style={{ width: '100%', marginTop: 4 }}
                    />
                  </div>
                </Col>
              </Row>
            </>
          )}

          {renderCropPreview()}
        </Space>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </Modal>
    </div>
  );
};

export default LogoUpload;