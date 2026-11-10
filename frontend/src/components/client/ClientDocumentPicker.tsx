import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Input, Modal, Segmented, Spin, Tooltip } from 'antd';
import {
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { clientService } from '../../services/clientService';
import type { ClientDocument, ClientDocumentFile, ClientDocType } from '../../types/client';
import AttachmentPreviewModal, { type AttachmentToPreview } from '../water-mitigation/AttachmentPreviewModal';

dayjs.extend(relativeTime);

/** A file stored on the client, picked to go out with an email */
export interface PickedClientDocument {
  /** source:id, as the Document Hub names the file */
  key: string;
  file: ClientDocumentFile;
  /** What the row is called on the client page */
  title: string;
  /** What kind of document it is, e.g. "WM job · COS" */
  kind: string;
}

// Rows that aren't plain files name their kind by type
const KIND_LABELS: Partial<Record<ClientDocType, string>> = {
  contract: 'Contract',
  insurance_estimate: 'Insurance estimate',
};

const picked = (d: ClientDocument & { file: ClientDocumentFile }): PickedClientDocument => ({
  key: `${d.file.source}:${d.file.id}`,
  file: d.file,
  title: d.title,
  kind: d.doc_type === 'file' ? (d.description || 'File') : (KIND_LABELS[d.doc_type] || d.doc_type),
});

export const clientFileIcon = (mime: string) => {
  if (mime === 'application/pdf') return <FilePdfOutlined className="fu-pdf-icon" />;
  if (mime.startsWith('image/')) return <FileImageOutlined />;
  return <FileOutlined />;
};

// The hub writes "N/A" for a claim with no number
const claimLabel = (num?: string) => (num && num !== 'N/A' ? `Claim #${num}` : null);

interface ClientDocumentPickerProps {
  open: boolean;
  clientId: string;
  /** The claim the email is about; its files are listed first */
  claimId?: string;
  value: PickedClientDocument[];
  onDone: (picked: PickedClientDocument[]) => void;
  onClose: () => void;
}

type Scope = 'claim' | 'all';

/** Pick files stored on the client - the Document Hub's files - to attach */
const ClientDocumentPicker: React.FC<ClientDocumentPickerProps> = ({
  open, clientId, claimId, value, onDone, onClose,
}) => {
  const [draft, setDraft] = useState<Map<string, PickedClientDocument>>(new Map());
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope | undefined>();
  const [previewing, setPreviewing] = useState<AttachmentToPreview | null>(null);

  // Each opening starts from what is attached now
  useEffect(() => {
    if (!open) return;
    setDraft(new Map(value.map(p => [p.key, p])));
    setSearch('');
    setScope(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The same list (and cache entry) as the client page's Document Hub
  const { data, isLoading } = useQuery({
    queryKey: ['client-all-documents', clientId, undefined],
    queryFn: () => clientService.getAllDocuments(clientId, { claim_id: undefined }),
    enabled: open,
  });

  const files = useMemo(() => {
    const seen = new Set<string>();
    return (data?.documents ?? []).filter((d): d is ClientDocument & { file: ClientDocumentFile } => {
      if (!d.file) return false;
      const key = `${d.file.source}:${d.file.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  // "This claim" also keeps the client's own files, those on no claim
  const onThisClaim = (d: ClientDocument) => !d.claim_id || d.claim_id === claimId;
  const hasOtherClaims = !!claimId && files.some(d => !onThisClaim(d));
  const effectiveScope: Scope = !hasOtherClaims
    ? 'all'
    : scope ?? (files.some(onThisClaim) ? 'claim' : 'all');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter(d =>
      (effectiveScope === 'all' || onThisClaim(d)) && (!q ||
        d.title.toLowerCase().includes(q) ||
        d.file.filename.toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d.claim_number || '').toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, search, effectiveScope, claimId]);

  const toggle = (p: PickedClientDocument) => setDraft(prev => {
    const next = new Map(prev);
    if (next.has(p.key)) next.delete(p.key);
    else next.set(p.key, p);
    return next;
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Attach client documents"
      width={720}
      className="fu-docpick-modal"
      destroyOnHidden
      footer={(
        <div className="fu-docpick-foot">
          <span className="fu-muted fu-docpick-count">{draft.size} selected</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={() => onDone([...draft.values()])}>
            Attach
          </Button>
        </div>
      )}
    >
      <div className="fu-docpick-toolbar">
        <Input
          placeholder="Search documents"
          prefix={<SearchOutlined />}
          allowClear
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search documents"
          className="fu-docpick-search"
        />
        {hasOtherClaims && (
          <Segmented<Scope>
            value={effectiveScope}
            onChange={setScope}
            options={[
              { value: 'claim', label: 'This claim' },
              { value: 'all', label: 'All claims' },
            ]}
          />
        )}
      </div>

      {isLoading ? (
        <div className="fu-docpick-empty"><Spin /></div>
      ) : rows.length === 0 ? (
        <div className="fu-docpick-empty">
          {files.length === 0
            ? 'This client has no stored documents yet.'
            : search
              ? 'No documents match your search.'
              : 'No documents on this claim.'}
        </div>
      ) : (
        <ul className="fu-docpick-list">
          {rows.map(d => {
            const p = picked(d);
            const checked = draft.has(p.key);
            const meta = [
              p.kind,
              effectiveScope === 'all' ? claimLabel(d.claim_number) : null,
              d.date ? dayjs(d.date).fromNow() : null,
            ].filter(Boolean).join(' · ');
            return (
              <li key={p.key} className={`fu-docpick-row${checked ? ' is-checked' : ''}`}>
                <Checkbox checked={checked} onChange={() => toggle(p)} className="fu-docpick-check">
                  <span className="fu-docpick-icon" aria-hidden="true">{clientFileIcon(p.file.mime_type)}</span>
                  <span className="fu-docpick-text">
                    <span className="fu-docpick-title">{d.title}</span>
                    <span className="fu-docpick-meta">{meta}</span>
                  </span>
                </Checkbox>
                <Tooltip title="Preview">
                  <Button
                    type="text"
                    size="small"
                    className="ui-icon-btn fu-docpick-preview"
                    icon={<EyeOutlined />}
                    aria-label={`Preview ${d.title}`}
                    onClick={() => setPreviewing({
                      title: d.title,
                      filename: p.file.filename,
                      load: () => clientService.getDocumentFileBlob(clientId, p.file),
                    })}
                  />
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
      <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewing(null)} />
    </Modal>
  );
};

export default ClientDocumentPicker;
