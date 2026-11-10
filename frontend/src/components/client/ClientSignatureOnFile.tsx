/**
 * A client's signature and initials on file (backend client/client_signatures.py).
 * The client header says whether there is one; its sheet shows them, how and
 * by whom they were kept, and lets staff draw, type or upload them, or take
 * them off file. The office signs a new contract's client lines with them from
 * Generate Contract on a claim; on site, the customer can use them or keep the
 * signature they just drew.
 */

import React, { useRef, useState } from 'react';
import { Button, Input, Modal, Popconfirm, Skeleton, message } from 'antd';
import { DeleteOutlined, EditOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSheetModal } from '../common/ui';
import { initialsOf } from '../contract/signatureLines';
import { signatureFromPhoto } from '../contract/signaturePhoto';
import WMSignaturePad from '../water-mitigation/pdf-annotator/WMSignaturePad';
import { clientService } from '../../services/clientService';
import type { SignatureOnFile, SignatureOnFileKind, SignaturesOnFile } from '../../types/client';

export const signaturesKey = (clientId: string) => ['client-signatures', clientId];

/** The client's signature and initials on file */
export const useSignaturesOnFile = (clientId?: string, enabled = true) => useQuery({
  queryKey: signaturesKey(clientId ?? ''),
  queryFn: () => clientService.getSignatures(clientId as string),
  enabled: !!clientId && enabled,
  staleTime: 60_000,
});

const KIND_LABEL: Record<SignatureOnFileKind, string> = { signature: 'Signature', initial: 'Initials' };

/** How and when it was kept: "Kept on site, collected by Jane Doe · Nov 9, 2026" */
export const keptLine = (item: SignatureOnFile) => {
  const by = item.saved_by_name;
  const how = {
    onsite: by ? `Kept on site, collected by ${by}` : 'Kept on site by the customer',
    drawn: by ? `Drawn by ${by}` : 'Drawn by staff',
    typed: by ? `Typed by ${by}` : 'Typed by staff',
    uploaded: by ? `Uploaded by ${by}` : 'Uploaded from a picture',
  }[item.source];
  return item.kept_at ? `${how} · ${dayjs(item.kept_at).format('MMM D, YYYY')}` : how;
};

/** What the header says about it */
export const onFileSummary = (data?: SignaturesOnFile) => {
  if (!data?.signature && !data?.initial) return 'None';
  if (!data.initial) return 'On file, no initials';
  if (!data.signature) return 'Initials only';
  return 'On file';
};

// ── The sheet ───────────────────────────────────────

interface SheetProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

type Pending = { kind: SignatureOnFileKind; image: string };

export const ClientSignatureSheet: React.FC<SheetProps> = ({ open, onClose, clientId, clientName }) => {
  const { sheetProps } = useSheetModal();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useSignaturesOnFile(clientId, open);
  const [name, setName] = useState<string | null>(null);
  const [pad, setPad] = useState<SignatureOnFileKind | null>(null);
  const [uploadFor, setUploadFor] = useState<SignatureOnFileKind | null>(null);
  // A picture read from a photo, shown before it's kept
  const [pending, setPending] = useState<Pending | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Whose it is: what's on file, else the client's name
  const signerName = name ?? (data?.signature?.signer_name || data?.initial?.signer_name || clientName);

  const stored = (next: SignaturesOnFile) => {
    queryClient.setQueryData(signaturesKey(clientId), next);
    setError(null);
  };

  const keep = useMutation({
    mutationFn: (vars: { kind: SignatureOnFileKind; image: string; source: 'drawn' | 'typed' | 'uploaded' }) =>
      clientService.keepSignature(clientId, vars.kind, {
        image: vars.image, signer_name: signerName.trim(), source: vars.source,
      }),
    onSuccess: (next, vars) => {
      stored(next);
      setPending(null);
      message.success(`${KIND_LABEL[vars.kind]} kept on file`);
    },
    onError: (err: any) => setError(err.response?.data?.detail || "Couldn't keep it. Check your connection and try again."),
  });

  const remove = useMutation({
    mutationFn: (kind: SignatureOnFileKind) => clientService.deleteSignature(clientId, kind),
    onSuccess: (next, kind) => {
      stored(next);
      message.success(`${KIND_LABEL[kind]} taken off file`);
    },
    onError: () => setError("Couldn't delete it. Check your connection and try again."),
  });

  const pickPhoto = (kind: SignatureOnFileKind) => {
    setUploadFor(kind);
    setError(null);
    fileInput.current?.click();
  };

  const readPhoto = async (file?: File) => {
    if (!file || !uploadFor) return;
    setReading(true);
    try {
      setPending({ kind: uploadFor, image: await signatureFromPhoto(file) });
    } catch (err: any) {
      setError(err?.message || "Couldn't read that picture");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const busy = keep.isPending || remove.isPending || reading;
  const nameMissing = !signerName.trim();

  const renderKind = (kind: SignatureOnFileKind) => {
    const item = data?.[kind] ?? null;
    const preview = pending?.kind === kind ? pending.image : null;
    const label = KIND_LABEL[kind];
    return (
      <section key={kind} className="csig-kind" aria-label={label}>
        <div className="csig-kind-head">
          <h3 className="csig-kind-title">{label}</h3>
          {item && !preview && <span className="csig-kind-meta">{keptLine(item)}</span>}
          {preview && <span className="csig-kind-meta">From your picture. Keep it?</span>}
        </div>
        {preview || item ? (
          <div className={`csig-image${preview ? ' is-pending' : ''}`}>
            <img src={preview ?? item?.image} alt={`${label} ${preview ? 'read from the picture' : 'on file'}`} />
          </div>
        ) : (
          <div className="csig-empty">No {label.toLowerCase()} on file</div>
        )}
        <div className="csig-actions">
          {preview ? (
            <>
              <Button
                type="primary"
                loading={keep.isPending}
                disabled={nameMissing}
                onClick={() => keep.mutate({ kind, image: preview, source: 'uploaded' })}
              >
                Keep on file
              </Button>
              <Button disabled={keep.isPending} onClick={() => setPending(null)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button icon={<EditOutlined />} disabled={busy || nameMissing} onClick={() => setPad(kind)}>
                {item ? 'Redraw' : 'Draw or type'}
              </Button>
              <Button
                icon={<UploadOutlined />}
                disabled={busy || nameMissing}
                loading={reading && uploadFor === kind}
                onClick={() => pickPhoto(kind)}
              >
                Upload a picture
              </Button>
              {item && (
                <Popconfirm
                  title={`Delete the ${label.toLowerCase()} on file?`}
                  description="Contracts already signed with it keep it."
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove.mutate(kind)}
                >
                  <Button type="text" danger icon={<DeleteOutlined />} disabled={busy}>Delete</Button>
                </Popconfirm>
              )}
            </>
          )}
        </div>
      </section>
    );
  };

  return (
    <Modal
      {...sheetProps}
      open={open}
      title="Signature on file"
      width={560}
      onCancel={onClose}
      afterClose={() => {
        setName(null);
        setPending(null);
        setError(null);
      }}
      footer={<Button type="primary" onClick={onClose}>Done</Button>}
    >
      <p className="csig-lead">
        The office can sign {clientName}&apos;s lines on a new contract with these, from Generate Contract
        on a claim. On site, they can be used too, and a customer can keep the signature they draw.
      </p>

      {isLoading && <Skeleton active paragraph={{ rows: 5 }} />}
      {isError && (
        <div className="csig-error" role="alert">
          Couldn&apos;t load the signature on file.
          <Button size="small" onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {data && (
        <>
          <div className="csig-field">
            <label className="csig-field-label" htmlFor="csig-signer">Whose signature</label>
            <Input
              id="csig-signer"
              value={signerName}
              onChange={e => setName(e.target.value)}
              maxLength={255}
              status={nameMissing ? 'error' : undefined}
              disabled={busy}
            />
            <span className="csig-field-help">
              {nameMissing ? 'Enter the name it signs, to keep one.' : 'Saved with what you keep next.'}
            </span>
          </div>
          {renderKind('signature')}
          {renderKind('initial')}
        </>
      )}
      {error && <div className="csig-error" role="alert">{error}</div>}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={e => readPhoto(e.target.files?.[0])}
      />
      <WMSignaturePad
        open={!!pad}
        title={pad ? `${signerName}: ${KIND_LABEL[pad].toLowerCase()}` : undefined}
        defaultName={pad === 'initial' ? initialsOf(signerName) : signerName}
        onClose={() => setPad(null)}
        onSave={(image, type) => {
          if (pad) keep.mutate({ kind: pad, image, source: type === 'typed' ? 'typed' : 'drawn' });
          setPad(null);
        }}
      />
    </Modal>
  );
};

// ── The header's fact ───────────────────────────────

/** "Signature: On file" in the client header, opening the sheet */
export const ClientSignatureFact: React.FC<{ clientId: string; clientName: string }> = ({ clientId, clientName }) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useSignaturesOnFile(clientId);
  const summary = onFileSummary(data);
  return (
    <div className="clr-fact clr-fact--signature">
      <dt>Signature</dt>
      <dd className={!isLoading && summary === 'None' ? 'is-empty' : undefined}>
        <button type="button" className="clr-fact-button" onClick={() => setOpen(true)}>
          {isLoading ? 'Loading…' : summary === 'None' ? 'None, add one' : summary}
        </button>
      </dd>
      <ClientSignatureSheet open={open} onClose={() => setOpen(false)} clientId={clientId} clientName={clientName} />
    </div>
  );
};

export default ClientSignatureFact;
