/**
 * The address (the one thing a new client needs) and the owners, which can wait.
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { useSheetModal } from '../common/ui';
import { clientService } from '../../services/clientService';
import type { FieldAddress, FieldVisitClient } from '../../types/fieldVisit';

export const AddressFields: React.FC<{
  value: FieldAddress;
  onChange: (value: FieldAddress) => void;
  /** The number's missing from the street: where the cursor should land */
  focusStreet?: boolean;
}> = ({ value, onChange, focusStreet }) => {
  const field = (key: keyof FieldAddress) => ({
    value: value[key] ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: event.target.value }),
  });
  return (
    <div className="fv-address">
      <AddressAutocomplete
        value={value.street}
        onChange={street => onChange({ ...value, street })}
        onSelect={picked => onChange({
          street: picked.streetAddress,
          city: picked.city,
          state: picked.state,
          zipcode: picked.zip,
        })}
        placeholder="Street"
        aria-label="Street"
        autoFocus={focusStreet}
        // The number goes first, so that's where the cursor starts
        onFocus={(event) => {
          if (focusStreet) event.target.setSelectionRange(0, 0);
        }}
      />
      <div className="fv-address-row">
        <Input {...field('city')} placeholder="City" aria-label="City" />
        <Input {...field('state')} placeholder="State" aria-label="State" maxLength={2} className="fv-address-state" />
        <Input {...field('zipcode')} placeholder="ZIP" aria-label="ZIP" inputMode="numeric" className="fv-address-zip" />
      </div>
    </div>
  );
};

/** A client named after its address until there's an owner; the same rule as the backend's named_after_address */
export const namedAfterAddress = (client: FieldVisitClient) => (
  client.owners.length === 0 && (client.display_name || '').trim() === (client.address || '').trim()
);

export const AddressSheet: React.FC<{
  open: boolean;
  client: FieldVisitClient;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, client, onClose, onSaved }) => {
  const { sheetProps } = useSheetModal();
  const [address, setAddress] = useState<FieldAddress>({ street: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAddress({
        street: client.address ?? '',
        city: client.city ?? '',
        state: client.state ?? '',
        zipcode: client.zipcode ?? '',
      });
    }
  }, [open, client]);

  const save = async () => {
    const street = address.street.trim();
    if (!street) return;
    setSaving(true);
    try {
      await clientService.update(client.id, {
        address: street,
        city: address.city?.trim() || undefined,
        state: address.state?.trim().toUpperCase() || undefined,
        zipcode: address.zipcode?.trim() || undefined,
        ...(namedAfterAddress(client) ? { display_name: street } : {}),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.detail || "Couldn't save the address");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      {...sheetProps}
      open={open}
      title="Address"
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" loading={saving} disabled={!address.street.trim()} onClick={save}>Save</Button>,
      ]}
    >
      <AddressFields value={address} onChange={setAddress} />
    </Modal>
  );
};

interface OwnerRow {
  name: string;
  phone: string;
  email: string;
}

const BLANK_OWNER: OwnerRow = { name: '', phone: '', email: '' };

export const OwnerSheet: React.FC<{
  open: boolean;
  client: FieldVisitClient;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, client, onClose, onSaved }) => {
  const { sheetProps } = useSheetModal();
  const [owners, setOwners] = useState<OwnerRow[]>([BLANK_OWNER]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setOwners(client.owners.length
      ? client.owners.map(owner => ({ name: owner.name || '', phone: owner.phone || '', email: owner.email || '' }))
      // An imported client can have a real name and no owners; saving keeps that name
      : [{
        name: namedAfterAddress(client) ? '' : client.display_name,
        phone: client.phone || '',
        email: client.email || '',
      }]);
  }, [open, client]);

  const change = (index: number, key: keyof OwnerRow, value: string) => {
    setOwners(rows => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const save = async () => {
    const filled = owners.filter(row => row.name.trim() || row.phone.trim() || row.email.trim());
    if (filled.some(row => !row.name.trim())) {
      setProblem('Enter a name for each owner.');
      return;
    }
    setSaving(true);
    try {
      const names = filled.map(row => row.name.trim());
      await clientService.update(client.id, {
        owners: filled.map((row, index) => ({
          name: row.name.trim(),
          phone: row.phone.trim() || undefined,
          email: row.email.trim() || undefined,
          is_primary: index === 0,
        })),
        // Back to the address when they've all been cleared
        display_name: names.length ? names.join(' & ') : (client.address || client.display_name),
        phone: filled[0]?.phone.trim() || undefined,
        email: filled[0]?.email.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setProblem(err.response?.data?.detail || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      {...sheetProps}
      open={open}
      title="Owner"
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" loading={saving} onClick={save}>Save</Button>,
      ]}
    >
      <div className="fv-owners">
        {owners.map((owner, index) => (
          <div key={index} className="fv-owner">
            <div className="fv-owner-name">
              <Input
                value={owner.name}
                placeholder="Name"
                aria-label={`Owner ${index + 1} name`}
                autoComplete="name"
                autoCapitalize="words"
                onChange={event => change(index, 'name', event.target.value)}
              />
              {index > 0 && (
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  aria-label={`Remove owner ${index + 1}`}
                  onClick={() => setOwners(rows => rows.filter((_, i) => i !== index))}
                />
              )}
            </div>
            <Input
              value={owner.phone}
              placeholder="Phone"
              aria-label={`Owner ${index + 1} phone`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              onChange={event => change(index, 'phone', event.target.value)}
            />
            <Input
              value={owner.email}
              placeholder="Email"
              aria-label={`Owner ${index + 1} email`}
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoComplete="email"
              onChange={event => change(index, 'email', event.target.value)}
            />
          </div>
        ))}
        <Button type="text" icon={<PlusOutlined />} onClick={() => setOwners(rows => [...rows, BLANK_OWNER])}>
          Another owner
        </Button>
        {problem && <div className="os-error" role="alert">{problem}</div>}
      </div>
    </Modal>
  );
};
