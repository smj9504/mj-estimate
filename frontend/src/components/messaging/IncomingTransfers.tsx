import React, { useState } from 'react';
import { Button, Card } from 'antd';
import { usePendingTransfers } from '../../hooks/useMessaging';
import { TransferDocumentType } from '../../services/documentTransferService';
import TransferCard from './TransferCard';

interface IncomingTransfersProps {
  documentType: TransferDocumentType;
}

const PREVIEW = 3;

/** Estimates or invoices colleagues sent you that you haven't answered yet */
const IncomingTransfers: React.FC<IncomingTransfersProps> = ({ documentType }) => {
  const { data = [] } = usePendingTransfers();
  const [showAll, setShowAll] = useState(false);
  const waiting = data.filter((t) => t.document_type === documentType);
  if (waiting.length === 0) return null;

  const label = documentType === 'estimate' ? 'estimate' : 'invoice';
  const shown = showAll ? waiting : waiting.slice(0, PREVIEW);

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={`${waiting.length} ${label}${waiting.length === 1 ? '' : 's'} sent to you`}
      extra={
        waiting.length > PREVIEW && (
          <Button type="link" size="small" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${waiting.length}`}
          </Button>
        )
      }
    >
      <div className="transfer-list">
        {shown.map((transfer) => (
          <TransferCard key={transfer.id} transfer={transfer} showSender />
        ))}
      </div>
    </Card>
  );
};

export default IncomingTransfers;
