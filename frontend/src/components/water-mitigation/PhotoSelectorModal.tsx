/**
 * Photo Selector Modal
 * Allows selecting photos from job for report sections
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Checkbox,
  Row,
  Col,
  Card,
  Image,
  message,
  Spin,
  Empty,
  Input,
  Space,
  Tag,
  Button,
  Select
} from 'antd';
import { SearchOutlined, CheckCircleFilled, FilterOutlined } from '@ant-design/icons';
import type { PhotoMetadata } from '../../types/waterMitigation';
import { useWaterMitigationPhotos } from '../../hooks/useWaterMitigationPhotos';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

const { Search } = Input;
const { Option } = Select;

interface Photo {
  id: string;
  file_path: string;
  caption?: string;
  category?: string;
  taken_date?: string;
  description?: string;
  thumbnail_path?: string;
}

interface PhotoSelectorModalProps {
  visible: boolean;
  jobId: string;
  selectedPhotos: PhotoMetadata[];
  onOk: (photos: PhotoMetadata[]) => void;
  onCancel: () => void;
}

const PhotoSelectorModal: React.FC<PhotoSelectorModalProps> = ({
  visible,
  jobId,
  selectedPhotos,
  onOk,
  onCancel
}) => {
  // Use React Query for automatic caching and refetching
  const { data: photos = [], isLoading: loading, isError } = useWaterMitigationPhotos(jobId, visible);

  const [filteredPhotos, setFilteredPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');  // Immediate input value
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Debounce search input to reduce filtering frequency
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  // Initialize selected from props when modal becomes visible
  useEffect(() => {
    if (visible) {
      setSelected(new Set(selectedPhotos.map(p => p.photo_id)));
    }
  }, [visible, selectedPhotos]);

  // Update filtered photos when photos, debounced search, or category changes
  useEffect(() => {
    filterPhotos();
  }, [photos, debouncedSearch, selectedCategory]);

  // Show error message if query failed
  useEffect(() => {
    if (isError && visible) {
      message.error('Failed to load photos');
    }
  }, [isError, visible]);

  const filterPhotos = () => {
    let filtered = photos;

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(photo => photo.category === selectedCategory);
    }

    // Filter by debounced search text
    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      filtered = filtered.filter(photo =>
        (photo.caption?.toLowerCase().includes(searchLower)) ||
        (photo.category?.toLowerCase().includes(searchLower)) ||
        (photo.description?.toLowerCase().includes(searchLower))
      );
    }

    setFilteredPhotos(filtered);
  };

  // Get unique categories from photos
  const categories = useMemo(() => {
    const uniqueCategories = new Set<string>();
    photos.forEach(photo => {
      if (photo.category) {
        uniqueCategories.add(photo.category);
      }
    });
    return Array.from(uniqueCategories).sort();
  }, [photos]);

  const handleTogglePhoto = (photoId: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelected(newSelected);
  };

  const handleSelectAll = () => {
    setSelected(new Set(filteredPhotos.map(p => p.id)));
  };

  const handleDeselectAll = () => {
    setSelected(new Set());
  };

  const handleOk = () => {
    const selectedPhotoMetadata: PhotoMetadata[] = Array.from(selected).map(photoId => {
      const existingMetadata = selectedPhotos.find(p => p.photo_id === photoId);
      return existingMetadata || {
        photo_id: photoId,
        caption: photos.find(p => p.id === photoId)?.caption,
        show_date: true,
        show_description: true
      };
    });
    onOk(selectedPhotoMetadata);
  };

  const getImageUrl = (photo: Photo) => {
    // Use water mitigation photo preview endpoint
    return `/api/water-mitigation/photos/${photo.id}/preview`;
  };

  return (
    <Modal
      title={`Select Photos for Section (${selected.size} selected)`}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      width={1000}
      style={{ top: 20 }}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
    >
      <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col flex="auto">
            <Search
              placeholder="Search by caption, category, or description..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              allowClear
              prefix={<SearchOutlined />}
            />
          </Col>
          <Col style={{ minWidth: 180 }}>
            <Select
              style={{ width: '100%' }}
              placeholder="Filter by category"
              value={selectedCategory}
              onChange={setSelectedCategory}
              prefix={<FilterOutlined />}
              allowClear
              onClear={() => setSelectedCategory('all')}
            >
              <Option value="all">All Categories</Option>
              {categories.map(category => (
                <Option key={category} value={category}>
                  {category}
                </Option>
              ))}
            </Select>
          </Col>
          <Col>
            <Button onClick={handleSelectAll} size="small">
              Select All
            </Button>
          </Col>
          <Col>
            <Button onClick={handleDeselectAll} size="small">
              Deselect All
            </Button>
          </Col>
        </Row>
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      ) : photos.length === 0 ? (
        <Empty
          description={
            <span>
              No photos available for this job.<br />
              Please upload photos in the Photos tab first.
            </span>
          }
        />
      ) : filteredPhotos.length === 0 ? (
        <Empty description="No photos match your search" />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredPhotos.map(photo => {
            const isSelected = selected.has(photo.id);
            return (
              <Col key={photo.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  onClick={() => handleTogglePhoto(photo.id)}
                  style={{
                    border: isSelected ? '2px solid #1890ff' : '1px solid #d9d9d9',
                    position: 'relative'
                  }}
                  bodyStyle={{ padding: 8 }}
                  cover={
                    <div style={{ position: 'relative', height: 150, overflow: 'hidden' }}>
                      <Image
                        src={getImageUrl(photo)}
                        alt={photo.caption || 'Photo'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        preview={false}
                      />
                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            backgroundColor: 'rgba(24, 144, 255, 0.9)',
                            borderRadius: '50%',
                            padding: 4
                          }}
                        >
                          <CheckCircleFilled style={{ color: 'white', fontSize: 20 }} />
                        </div>
                      )}
                    </div>
                  }
                >
                  <div style={{ fontSize: 12 }}>
                    {photo.caption && (
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>
                        {photo.caption}
                      </div>
                    )}
                    {photo.category && (
                      <Tag color="blue" style={{ fontSize: 10 }}>
                        {photo.category}
                      </Tag>
                    )}
                    {photo.taken_date && (
                      <div style={{ color: '#999', fontSize: 10, marginTop: 4 }}>
                        {new Date(photo.taken_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </Modal>
  );
};

export default PhotoSelectorModal;
