import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Typography, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PeopleSelect from './PeopleSelect';
import { documentTransferService, TransferDocumentType } from '../../services/documentTransferService';

interface SendDocumentModalProps {
  open: boolean;
  onClose: () => void;
  documentType: TransferDocumentType;
  documentId: string;
  documentNumber?: string;
}

const LABELS: Record<TransferDocumentType, string> = { estimate: 'Estimate', invoice: 'Invoice' };

/** Offer an estimate or invoice to colleagues; each gets their own copy when they accept */
const SendDocumentModal: React.FC<SendDocumentModalProps> = ({
  open, onClose, documentType, documentId, documentNumber,
}) => {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setRecipients([]);
      setNote('');
    }
  }, [open]);

  const send = useMutation({
    mutationFn: () => documentTransferService.send(documentType, documentId, recipients, note),
    onSuccess: (transfers) => {
      const names = transfers.map((t) => t.to_name).filter(Boolean).join(', ');
      message.success(`Sent to ${names}. They get their own copy when they accept.`);
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      onClose();
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || "Couldn't send it");
    },
  });

  const label = LABELS[documentType];

  return (
    <Modal
      open={open}
      title={`Send ${label}${documentNumber ? ` #${documentNumber}` : ''}`}
      okText="Send"
      onOk={() => send.mutate()}
      okButtonProps={{ disabled: recipients.length === 0, loading: send.isPending }}
      onCancel={onClose}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Each person gets a message to accept it. Accepting puts a copy in their own list as a
        draft with a new number{documentType === 'invoice' ? ' and no payments recorded' : ''}.
        Your {label.toLowerCase()} stays with you.
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="Send to" required>
          <PeopleSelect value={recipients} onChange={setRecipients} autoFocus />
        </Form.Item>
        <Form.Item label="Note" style={{ marginBottom: 0 }}>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={2000}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SendDocumentModal;
