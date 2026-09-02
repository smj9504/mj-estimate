/**
 * Modal for tagging a single water mitigation photo with a location:
 * Level (floor, sourced from the job's floor sketches) + Room (free text,
 * with autocomplete from previously-used values on the job).
 */

import React, { useEffect, useState } from 'react';
import { Modal, AutoComplete, Form, message } from 'antd';
import waterMitigationService from '../../services/waterMitigationService';

interface WMPhotoLocationModalProps {
  open: boolean;
  photoId: string | null;
  initialLevel?: string;
  initialRoom?: string;
  levelOptions: string[];
  roomSuggestions: string[];
  onClose: () => void;
  onSaved: (photoId: string, level?: string, room?: string) => void;
}

const WMPhotoLocationModal: React.FC<WMPhotoLocationModalProps> = ({
  open,
  photoId,
  initialLevel,
  initialRoom,
  levelOptions,
  roomSuggestions,
  onClose,
  onSaved,
}) => {
  const [level, setLevel] = useState<string | undefined>(initialLevel);
  const [room, setRoom] = useState<string | undefined>(initialRoom);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLevel(initialLevel);
      setRoom(initialRoom);
    }
  }, [open, initialLevel, initialRoom]);

  const handleSave = async () => {
    if (!photoId) return;
    setSaving(true);
    try {
      await waterMitigationService.photos.updateLocation(photoId, level, room);
      onSaved(photoId, level, room);
      message.success('Location updated');
      onClose();
    } catch (error) {
      console.error('Failed to update photo location:', error);
      message.error('Failed to update location');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Set Photo Location"
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="Save"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item label="Level (Floor)">
          <AutoComplete
            value={level}
            onChange={setLevel}
            options={levelOptions.map((lvl) => ({ value: lvl }))}
            placeholder="Select or type a floor level (e.g. Basement, 1st Floor)"
            filterOption={(inputValue, option) =>
              !!option?.value && option.value.toLowerCase().includes(inputValue.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="Room">
          <AutoComplete
            value={room}
            onChange={setRoom}
            options={roomSuggestions.map((r) => ({ value: r }))}
            placeholder="e.g. Kitchen, Master Bedroom"
            filterOption={(inputValue, option) =>
              !!option?.value && option.value.toLowerCase().includes(inputValue.toLowerCase())
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default WMPhotoLocationModal;
