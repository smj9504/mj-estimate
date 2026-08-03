/**
 * SheetPAMappingButton
 *
 * Opens a modal to manage the mapping between Google Sheet tab names
 * and PA (Public Adjuster) contacts.
 * Each sheet row in the table shows a Select with all PA contacts.
 */

import React, { useEffect, useState } from 'react';
import {
  Button,
  Modal,
  Table,
  Select,
  Space,
  message,
  Tooltip,
  Tag,
  Typography,
} from 'antd';
import { LinkOutlined, SaveOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import waterMitigationService, { SheetPAMapping } from '../../services/waterMitigationService';
import { companyService } from '../../services/companyService';
import type { CompanyContact } from '../../types';

const { Text } = Typography;

interface SheetPAMappingButtonProps {
  onApplied?: () => void;
}

interface ContactOption {
  value: string;
  label: string;
  contact: CompanyContact;
}

const SheetPAMappingButton: React.FC<SheetPAMappingButtonProps> = ({ onApplied }) => {
  const [open, setOpen] = useState(false);
  const [mappings, setMappings] = useState<SheetPAMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  // Local edits: sheetName → pa_contact_id | null
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadMappings = async () => {
    setLoadingMappings(true);
    try {
      const data = await waterMitigationService.sheetPAMappings.list();
      setMappings(data);
      // Pre-fill edits with current values
      const initial: Record<string, string | null> = {};
      data.forEach(m => { initial[m.sheet_name] = m.pa_contact_id; });
      setEdits(initial);
    } catch {
      message.error('Failed to load sheet mappings.');
    } finally {
      setLoadingMappings(false);
    }
  };

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      // Load all contacts whose company is type 'public_adjuster'
      const all = await companyService.listAllContacts('public_adjuster');
      // Also fetch all contacts in case some companies are not typed yet
      const opts: ContactOption[] = all.map(c => ({
        value: c.id,
        label: c.name,
        contact: c,
      }));
      setContactOptions(opts);
    } catch {
      message.error('Failed to load PA contacts.');
    } finally {
      setLoadingContacts(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadMappings();
      loadContacts();
    }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save all changed mappings
      const promises = Object.entries(edits).map(([sheetName, contactId]) =>
        waterMitigationService.sheetPAMappings.upsert(sheetName, contactId)
      );
      await Promise.all(promises);
      message.success('Mappings saved.');
      await loadMappings();
    } catch {
      message.error('Failed to save mappings.');
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    // First save, then apply
    setSaving(true);
    try {
      const promises = Object.entries(edits).map(([sheetName, contactId]) =>
        waterMitigationService.sheetPAMappings.upsert(sheetName, contactId)
      );
      await Promise.all(promises);
    } catch {
      message.error('Failed to save mappings.');
      setSaving(false);
      return;
    }
    setSaving(false);

    setApplying(true);
    try {
      const result = await waterMitigationService.sheetPAMappings.apply();
      message.success(`Applied PA contacts to ${result.applied} claim(s).`);
      onApplied?.();
    } catch {
      message.error('Failed to apply PA mappings.');
    } finally {
      setApplying(false);
    }
  };

  const columns: ColumnsType<SheetPAMapping> = [
    {
      title: 'Sheet Name',
      dataIndex: 'sheet_name',
      key: 'sheet_name',
      width: 140,
      render: (name: string) => (
        <Tag color="purple" style={{ fontWeight: 'bold' }}>{name}</Tag>
      ),
    },
    {
      title: 'PA Contact',
      key: 'pa_contact',
      render: (_, record) => {
        const currentValue = edits[record.sheet_name] ?? null;
        return (
          <Select
            style={{ width: '100%' }}
            placeholder="Select PA contact..."
            value={currentValue || undefined}
            allowClear
            showSearch
            loading={loadingContacts}
            optionFilterProp="label"
            onChange={(val: string | undefined) =>
              setEdits(prev => ({ ...prev, [record.sheet_name]: val ?? null }))
            }
            options={contactOptions.map(opt => ({
              value: opt.value,
              label: opt.label,
            }))}
            optionRender={(option) => {
              const found = contactOptions.find(o => o.value === option.value);
              return (
                <div>
                  <div style={{ fontWeight: 500 }}>{option.label}</div>
                  {(found?.contact?.company_name || found?.contact?.title) && (
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                      {[found?.contact?.company_name, found?.contact?.title].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              );
            }}
          />
        );
      },
    },
    {
      title: 'Current',
      key: 'current',
      width: 200,
      render: (_, record) => {
        if (!record.contact) return <Text type="secondary">Not set</Text>;
        return (
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{record.contact.name}</div>
            {record.contact.company_name && (
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>{record.contact.company_name}</div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Tooltip title="Map Google Sheet tabs to PA contacts">
        <Button icon={<LinkOutlined />} onClick={() => setOpen(true)}>
          Sheet → PA
        </Button>
      </Tooltip>

      <Modal
        title={
          <Space>
            <LinkOutlined />
            <span>Sheet → PA Contact Mapping</span>
          </Space>
        }
        open={open}
        onCancel={() => setOpen(false)}
        width={700}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Button
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              Save
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleApply}
              loading={applying || saving}
            >
              Save & Apply to Claims
            </Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          Map each Google Sheet tab name to a PA contact. When syncing, the linked Claim
          will automatically be updated with the mapped PA contact.
        </div>

        <Table
          columns={columns}
          dataSource={mappings}
          rowKey="sheet_name"
          loading={loadingMappings}
          size="small"
          pagination={false}
          locale={{ emptyText: 'No sheet names found. Sync from Google Sheets first.' }}
        />
      </Modal>
    </>
  );
};

export default SheetPAMappingButton;
