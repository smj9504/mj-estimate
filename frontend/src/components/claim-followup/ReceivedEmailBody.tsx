import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spin, Typography } from 'antd';
import { emailIngestionService } from '../../services/emailIngestionService';

const { Text } = Typography;

interface ReceivedEmailBodyProps {
  emailId: string;
}

/**
 * Headers and body of one received email, loaded on demand - list
 * endpoints leave bodies out. Plain text is preferred; an HTML-only
 * message renders in a sandboxed iframe so its markup and scripts can't
 * touch the app.
 */
const ReceivedEmailBody: React.FC<ReceivedEmailBodyProps> = ({ emailId }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['received-email', emailId],
    queryFn: () => emailIngestionService.getReceived(emailId),
    staleTime: Infinity,
  });

  if (isLoading) return <Spin size="small" style={{ margin: 12 }} />;
  if (!data) return null;

  return (
    <div style={{ padding: '4px 8px' }}>
      <div style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.6 }}>
        <div><Text type="secondary">From: </Text>{data.sender || '-'}</div>
        {data.to_addresses && <div><Text type="secondary">To: </Text>{data.to_addresses}</div>}
        {data.cc_addresses && <div><Text type="secondary">Cc: </Text>{data.cc_addresses}</div>}
      </div>
      {data.body_text ? (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            maxHeight: 420,
            overflowY: 'auto',
            padding: 12,
            background: '#fafaf9',
            borderRadius: 6,
          }}
        >
          {data.body_text}
        </div>
      ) : data.body_html ? (
        <iframe
          title={data.subject || 'Email body'}
          sandbox=""
          srcDoc={data.body_html}
          style={{ width: '100%', height: 420, border: '1px solid #e7e5e4', borderRadius: 6, background: '#fff' }}
        />
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>(empty body)</Text>
      )}
    </div>
  );
};

export default ReceivedEmailBody;
