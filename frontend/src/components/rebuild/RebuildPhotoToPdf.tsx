import React, { useState, useCallback } from 'react';
import {
  Modal, Upload, Button, Select, Input, Space, List, message, Typography, Image, Tooltip,
} from 'antd';
import {
  UploadOutlined, RotateRightOutlined, DeleteOutlined, ArrowUpOutlined,
  ArrowDownOutlined, FilePdfOutlined,
} from '@ant-design/icons';
import { rebuildService } from '../../services/rebuildService';
import type { RebuildProject, RebuildCompletionDoc } from '../../types/rebuild';

const { Text } = Typography;

interface Props {
  open: boolean;
  project: RebuildProject;
  onClose: () => void;
  onSuccess: (doc: RebuildCompletionDoc) => void;
}

interface PhotoItem {
  id: string;
  file: File;
  preview: string;
  rotation: number; // 0, 90, 180, 270
}

const DOC_TYPE_OPTIONS = [
  { value: 'completion_photo', label: 'Completion Photos' },
  { value: 'coc', label: 'Certificate of Completion' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'permit', label: 'Permit' },
  { value: 'lien_waiver', label: 'Lien Waiver' },
  { value: 'other', label: 'Other' },
];

let idCounter = 0;

const RebuildPhotoToPdf: React.FC<Props> = ({ open, project, onClose, onSuccess }) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [docType, setDocType] = useState('completion_photo');
  const [title, setTitle] = useState('Completion Photos');
  const [generating, setGenerating] = useState(false);

  const handleClose = () => {
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setDocType('completion_photo');
    setTitle('Completion Photos');
    onClose();
  };

  const handleFilesAdd = useCallback((fileList: FileList | File[]) => {
    const newPhotos: PhotoItem[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith('image/')) continue;
      newPhotos.push({
        id: `photo_${++idCounter}`,
        file,
        preview: URL.createObjectURL(file),
        rotation: 0,
      });
    }
    setPhotos(prev => [...prev, ...newPhotos]);
  }, []);

  const rotatePhoto = (id: string) => {
    setPhotos(prev => prev.map(p =>
      p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p
    ));
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => {
      const removed = prev.find(p => p.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(p => p.id !== id);
    });
  };

  const movePhoto = (id: string, direction: -1 | 1) => {
    setPhotos(prev => {
      const arr = [...prev];
      const idx = arr.findIndex(p => p.id === id);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  const handleGenerate = async () => {
    if (photos.length === 0) {
      message.warning('Please add at least one photo');
      return;
    }
    setGenerating(true);
    try {
      const formData = new FormData();
      photos.forEach(p => formData.append('photos', p.file));

      const rotations: Record<number, number> = {};
      photos.forEach((p, idx) => {
        if (p.rotation !== 0) rotations[idx] = p.rotation;
      });
      formData.append('rotations', JSON.stringify(rotations));
      formData.append('doc_type', docType);
      formData.append('title', title);

      const result = await rebuildService.photosToPdf(project.id, formData);
      message.success('PDF created');
      onSuccess(result);
      handleClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to create PDF');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal
      title="Photos to PDF"
      open={open}
      width={600}
      onCancel={handleClose}
      footer={
        <Space>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            loading={generating}
            disabled={photos.length === 0}
            onClick={handleGenerate}
          >
            Generate PDF ({photos.length} page{photos.length !== 1 ? 's' : ''})
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space style={{ width: '100%' }} size={12}>
          <Select
            value={docType}
            onChange={v => {
              setDocType(v);
              const label = DOC_TYPE_OPTIONS.find(o => o.value === v)?.label || v;
              setTitle(label);
            }}
            options={DOC_TYPE_OPTIONS}
            style={{ width: 200 }}
          />
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Document title"
            style={{ flex: 1 }}
          />
        </Space>

        <Upload.Dragger
          accept="image/*"
          multiple
          showUploadList={false}
          beforeUpload={(file, fileList) => {
            // Only handle the batch once (on last file)
            if (file === fileList[fileList.length - 1]) {
              handleFilesAdd(fileList as unknown as File[]);
            }
            return false;
          }}
          style={{ padding: '8px 0' }}
        >
          <p style={{ margin: 0 }}>
            <UploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          </p>
          <p style={{ margin: '4px 0 0' }}>Click or drag photos here</p>
        </Upload.Dragger>

        {photos.length > 0 && (
          <List
            size="small"
            dataSource={photos}
            style={{ maxHeight: 400, overflow: 'auto' }}
            renderItem={(item, idx) => (
              <List.Item
                style={{ padding: '8px 0' }}
                actions={[
                  <Tooltip key="up" title="Move up">
                    <Button size="small" icon={<ArrowUpOutlined />} disabled={idx === 0}
                      onClick={() => movePhoto(item.id, -1)} />
                  </Tooltip>,
                  <Tooltip key="down" title="Move down">
                    <Button size="small" icon={<ArrowDownOutlined />} disabled={idx === photos.length - 1}
                      onClick={() => movePhoto(item.id, 1)} />
                  </Tooltip>,
                  <Tooltip key="rotate" title={`Rotate (${item.rotation}°)`}>
                    <Button size="small" icon={<RotateRightOutlined />}
                      onClick={() => rotatePhoto(item.id)} />
                  </Tooltip>,
                  <Tooltip key="delete" title="Remove">
                    <Button size="small" danger icon={<DeleteOutlined />}
                      onClick={() => removePhoto(item.id)} />
                  </Tooltip>,
                ]}
              >
                <Space>
                  <Text type="secondary" style={{ width: 24, textAlign: 'center' }}>
                    {idx + 1}
                  </Text>
                  <div style={{
                    width: 60, height: 60, overflow: 'hidden', borderRadius: 4,
                    border: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <img
                      src={item.preview}
                      alt={item.file.name}
                      style={{
                        maxWidth: '100%', maxHeight: '100%', objectFit: 'cover',
                        transform: `rotate(${item.rotation}deg)`,
                      }}
                    />
                  </div>
                  <div>
                    <Text ellipsis style={{ maxWidth: 200, display: 'block' }}>{item.file.name}</Text>
                    {item.rotation > 0 && (
                      <Text type="secondary" style={{ fontSize: 11 }}>Rotated {item.rotation}°</Text>
                    )}
                  </div>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Space>
    </Modal>
  );
};

export default RebuildPhotoToPdf;
