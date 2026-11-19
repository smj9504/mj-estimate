import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Popconfirm, Spin, Tooltip, message } from 'antd';
import {
  DollarOutlined, DownOutlined, FileImageOutlined, FilePdfOutlined, PaperClipOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { emailIngestionService } from '../../services/emailIngestionService';
import {
  CLAIM_DOCUMENT_TYPES, ESTIMATE_DOCUMENT_TYPE, getClaimDocumentType,
} from '../../constants/claimDocumentTypes';
import type { IngestionLog, ReceivedAttachment } from '../../types/emailIngestion';
import AttachmentPreviewModal, {
  type AttachmentToPreview,
} from '../water-mitigation/AttachmentPreviewModal';
import { Pill } from '../common/ui';
import { attachmentFromLog, looksLikeEstimate } from './receivedMail';

/** An emailed PDF about to become one of the claim's estimate revisions */
export interface EmailEstimateAttachment {
  logId: string;
  fileName: string;
  receivedAt?: string;
  sender?: string;
}

interface ReceivedEmailAttachmentsProps {
  claimId: string;
  /** A stored email: its files load from the server */
  emailId?: string;
  /** Mail known only from its attachment logs (before every message was kept) */
  logs?: IngestionLog[];
  /** Needed to file an attachment on the claim */
  clientId?: string;
  receivedAt?: string;
  sender?: string;
  /** Opens Add revision with the PDF; left out where the claim has no carrier */
  onAddEstimate?: (attachment: EmailEstimateAttachment) => void;
}

/** Human-readable file size */
const formatSize = (bytes?: number | null): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileIcon = (att: ReceivedAttachment) => {
  if (att.kind === 'pdf' || /\.pdf$/i.test(att.name)) return <FilePdfOutlined />;
  if ((att.content_type || '').startsWith('image/')) return <FileImageOutlined />;
  return <PaperClipOutlined />;
};

const OTHER_DOCUMENT_TYPES = CLAIM_DOCUMENT_TYPES.filter((t) => t.value !== ESTIMATE_DOCUMENT_TYPE);

/**
 * The files that came with a received email. Stored ones open in the page;
 * a PDF waiting for review can become the claim's estimate revision (its
 * amounts read in the Add revision dialog) or be filed as another document,
 * and a filed one can be undone (an estimate's revision is deleted with it).
 */
const ReceivedEmailAttachments: React.FC<ReceivedEmailAttachmentsProps> = ({
  claimId, emailId, logs, clientId, receivedAt, sender, onAddEstimate,
}) => {
  const queryClient = useQueryClient();
  const [previewing, setPreviewing] = React.useState<AttachmentToPreview | null>(null);

  const { data: loaded, isLoading } = useQuery({
    queryKey: ['received-attachments', emailId],
    queryFn: () => emailIngestionService.listReceivedAttachments(emailId!),
    enabled: !!emailId,
  });
  const attachments: ReceivedAttachment[] = emailId
    ? loaded ?? []
    : (logs ?? []).map(attachmentFromLog);

  const fileMutation = useMutation({
    mutationFn: ({ logId, documentType }: { logId: string; documentType: string }) =>
      emailIngestionService.assignLog(logId, {
        client_id: clientId!, claim_id: claimId, document_type: documentType,
      }),
    onSuccess: (log) => {
      message.success(`Filed on the claim as ${getClaimDocumentType(log.document_type)?.label ?? 'a document'}`);
      queryClient.invalidateQueries({ queryKey: ['received-attachments'] });
      queryClient.invalidateQueries({ queryKey: ['ingested-emails-claim', claimId] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-stats'] });
      queryClient.invalidateQueries({ queryKey: ['client-all-documents'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Filing failed'),
  });

  const unfileMutation = useMutation({
    mutationFn: (att: ReceivedAttachment) => emailIngestionService.unfileLog(att.log_id!),
    onSuccess: (_log, att) => {
      const wasEstimate = att.document_type === ESTIMATE_DOCUMENT_TYPE;
      message.success(wasEstimate
        ? `Estimate revision deleted; ${att.name} is waiting to be filed again`
        : `${att.name} is waiting to be filed again`);
      queryClient.invalidateQueries({ queryKey: ['received-attachments'] });
      queryClient.invalidateQueries({ queryKey: ['ingested-emails-claim', claimId] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-stats'] });
      queryClient.invalidateQueries({ queryKey: ['client-all-documents'] });
      if (wasEstimate) {
        // The revision is gone and the claim's amounts follow the one before it
        queryClient.invalidateQueries({ queryKey: ['negotiations'] });
        queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
        queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      }
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Undo failed'),
  });

  const open = (att: ReceivedAttachment) => {
    if (!att.file_id) return;
    const fileId = att.file_id;
    setPreviewing({
      title: att.name,
      filename: att.name,
      load: () => (emailId
        ? emailIngestionService.getReceivedAttachmentBlob(emailId, fileId)
        : emailIngestionService.getLogFileBlob(att.log_id!)),
    });
  };

  if (emailId && isLoading) return <Spin size="small" style={{ margin: '6px 8px' }} />;
  if (attachments.length === 0) return null;

  return (
    <div className="cl-mail-files">
      <div className="cl-mail-files-title">Attachments</div>
      <ul className="cl-mail-files-list">
        {attachments.map((att, i) => {
          const filed = getClaimDocumentType(att.document_type);
          const canFile = att.can_file && !!att.log_id && !!clientId;
          const canUnfile = !!att.can_unfile && !!att.log_id && !!clientId;
          const undoing = unfileMutation.isPending && unfileMutation.variables?.log_id === att.log_id;
          const undoButton = (onClick?: () => void) => (
            <Button size="small" type="text" icon={<UndoOutlined />} loading={undoing} onClick={onClick}>
              Undo
            </Button>
          );
          const estimateHint = canFile && looksLikeEstimate(att);
          return (
            <li key={`${att.kind}-${att.log_id ?? att.file_id ?? att.name}-${i}`} className="cl-mail-file">
              <span className="cl-mail-file-icon" aria-hidden="true">{fileIcon(att)}</span>
              {att.file_id ? (
                <Button type="link" size="small" className="cl-mail-file-name" onClick={() => open(att)}>
                  {att.name}
                </Button>
              ) : (
                <Tooltip title={att.note || 'Not stored in the app'}>
                  <span className="cl-mail-file-name is-missing">{att.name}</span>
                </Tooltip>
              )}
              {att.size ? <span className="cl-meta cl-nowrap">{formatSize(att.size)}</span> : null}
              {filed && <Pill tone={filed.tone}>{filed.label}</Pill>}
              {canUnfile && (
                // Right by the label it undoes: the row runs past a narrow panel's edge
                <span className="cl-mail-file-undo">
                  {att.document_type === ESTIMATE_DOCUMENT_TYPE ? (
                    <Popconfirm
                      title="Undo the estimate?"
                      description={`Deletes estimate revision${att.revision_number ? ` #${att.revision_number}` : ''} and its amounts. The PDF waits to be filed again.`}
                      okText="Delete revision"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => unfileMutation.mutate(att)}
                    >
                      {undoButton()}
                    </Popconfirm>
                  ) : (
                    <Tooltip title="Take it off the claim's documents; it waits to be filed again">
                      {undoButton(() => unfileMutation.mutate(att))}
                    </Tooltip>
                  )}
                </span>
              )}
              {estimateHint && <Pill tone="red">Looks like an estimate</Pill>}
              {att.note && att.kind !== 'missing' && <span className="cl-meta">{att.note}</span>}
              {canFile && (
                <span className="cl-mail-file-actions">
                  {onAddEstimate && (
                    <Tooltip title="Add it to the claim's insurance estimates, with its amounts read from the PDF">
                      <Button
                        size="small"
                        type={estimateHint ? 'primary' : 'default'}
                        icon={<DollarOutlined />}
                        onClick={() => onAddEstimate({
                          logId: att.log_id!, fileName: att.name, receivedAt, sender,
                        })}
                      >
                        Add as estimate
                      </Button>
                    </Tooltip>
                  )}
                  <Dropdown
                    trigger={['click']}
                    disabled={fileMutation.isPending}
                    menu={{
                      items: OTHER_DOCUMENT_TYPES.map((t) => ({ key: t.value, label: t.label })),
                      onClick: ({ key }) => fileMutation.mutate({ logId: att.log_id!, documentType: key }),
                    }}
                  >
                    <Button size="small" type="text" loading={fileMutation.isPending}>
                      File as <DownOutlined style={{ fontSize: 10 }} />
                    </Button>
                  </Dropdown>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewing(null)} />
    </div>
  );
};

export default ReceivedEmailAttachments;
