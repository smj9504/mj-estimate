/**
 * Photos printed at the end of the roofing estimate PDF.
 *
 * One address often has several structures; an aerial with the quoted
 * roof marked, or a photo of the existing roof, tells the customer which
 * roof the quote covers.
 */

import React, { useEffect, useState } from 'react';
import {
  Button, Card, Col, Empty, Input, message, Popconfirm, Row, Space, Typography, Upload,
} from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, DeleteOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roofingEstimateService } from '../../services/roofingEstimateService';
import type { RoofingEstimateImage } from '../../types/roofingEstimate';

const { Text } = Typography;

/** Thumbnail loaded with the auth header, released when unmounted. */
const AuthImage: React.FC<{ estimateId: string; imageId: string; alt: string }> = ({
  estimateId, imageId, alt,
}) => {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    roofingEstimateService.getImageObjectUrl(estimateId, imageId)
      .then((u) => {
        if (cancelled) {
          window.URL.revokeObjectURL(u);
        } else {
          url = u;
          setSrc(u);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) window.URL.revokeObjectURL(url);
    };
  }, [estimateId, imageId]);

  return (
    <div style={{
      height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f5f5', overflow: 'hidden',
    }}>
      {src && <img src={src} alt={alt} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
    </div>
  );
};

const RoofingEstimatePhotos: React.FC<{ estimateId: string }> = ({ estimateId }) => {
  const queryClient = useQueryClient();
  const queryKey = ['roofing-estimate-images', estimateId];
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);

  const { data: images = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => roofingEstimateService.listImages(estimateId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const updateMutation = useMutation({
    mutationFn: ({ imageId, patch }: { imageId: string; patch: { caption?: string; display_order?: number } }) =>
      roofingEstimateService.updateImage(estimateId, imageId, patch),
    onSuccess: refresh,
    onError: () => message.error('Failed to update photo'),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => roofingEstimateService.deleteImage(estimateId, imageId),
    onSuccess: refresh,
    onError: () => message.error('Failed to delete photo'),
  });

  const saveCaption = (img: RoofingEstimateImage) => {
    const value = captions[img.id];
    if (value === undefined || value === (img.caption || '')) return;
    updateMutation.mutate({ imageId: img.id, patch: { caption: value } });
  };

  // Swap with the neighbour, then renumber every photo from its list
  // position so photos that share a display_order still move.
  const move = async (idx: number, dir: -1 | 1) => {
    const other = idx + dir;
    if (other < 0 || other >= images.length) return;
    const reordered = [...images];
    [reordered[idx], reordered[other]] = [reordered[other], reordered[idx]];
    try {
      await Promise.all(
        reordered
          .map((img, i) => ({ img, i }))
          .filter(({ img, i }) => img.display_order !== i)
          .map(({ img, i }) => roofingEstimateService.updateImage(estimateId, img.id, { display_order: i })),
      );
    } catch {
      message.error('Failed to reorder photos');
    }
    refresh();
  };

  return (
    <Card>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Photos are printed at the end of the estimate PDF, in this order. Use them to show which
        roof is quoted (e.g. an aerial with the structure marked) or the roof&apos;s existing condition.
      </Text>

      <Upload.Dragger
        multiple
        accept="image/jpeg,image/png,image/webp"
        showUploadList={false}
        customRequest={async ({ file, onSuccess, onError }) => {
          setUploading((n) => n + 1);
          try {
            await roofingEstimateService.uploadImage(estimateId, file as File);
            onSuccess?.({});
            refresh();
          } catch (e: any) {
            message.error(e?.response?.data?.detail || `Failed to upload ${(file as File).name}`);
            onError?.(e);
          } finally {
            setUploading((n) => n - 1);
          }
        }}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">
          {uploading > 0 ? `Uploading ${uploading} photo(s)...` : 'Click or drag photos here to upload'}
        </p>
        <p className="ant-upload-hint">JPG, PNG or WebP, up to 20 MB each</p>
      </Upload.Dragger>

      {!isLoading && images.length === 0 ? (
        <Empty description="No photos yet" />
      ) : (
        <Row gutter={[16, 16]}>
          {images.map((img, idx) => (
            <Col key={img.id} xs={24} sm={12} md={8}>
              <Card
                size="small"
                cover={<AuthImage estimateId={estimateId} imageId={img.id} alt={img.caption || img.file_name || 'photo'} />}
                actions={[
                  <Button key="left" type="text" size="small" icon={<ArrowLeftOutlined />}
                    disabled={idx === 0} onClick={() => move(idx, -1)} />,
                  <Button key="right" type="text" size="small" icon={<ArrowRightOutlined />}
                    disabled={idx === images.length - 1} onClick={() => move(idx, 1)} />,
                  <Popconfirm key="del" title="Delete this photo?" onConfirm={() => deleteMutation.mutate(img.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input
                    placeholder="Caption (printed under the photo)"
                    maxLength={500}
                    value={captions[img.id] ?? img.caption ?? ''}
                    onChange={(e) => setCaptions((c) => ({ ...c, [img.id]: e.target.value }))}
                    onBlur={() => saveCaption(img)}
                    onPressEnter={() => saveCaption(img)}
                  />
                  {img.file_name && <Text type="secondary" style={{ fontSize: 12 }}>{img.file_name}</Text>}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
};

export default RoofingEstimatePhotos;
