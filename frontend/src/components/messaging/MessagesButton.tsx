import React from 'react';
import { Badge, Button, Tooltip } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useUnreadMessages } from '../../hooks/useMessaging';

/** Header link to Messages, with the unread count */
const MessagesButton: React.FC = () => {
  const navigate = useNavigate();
  const { data: unread = 0 } = useUnreadMessages();
  const label = unread > 0 ? `Messages, ${unread} unread` : 'Messages';

  return (
    <Tooltip title="Messages">
      <Badge count={unread} size="small" offset={[-4, 4]}>
        <Button
          type="text"
          icon={<MessageOutlined />}
          className="header-toggle-btn"
          style={{ width: 36, height: 36, marginLeft: 4 }}
          onClick={() => navigate('/messages')}
          aria-label={label}
        />
      </Badge>
    </Tooltip>
  );
};

export default MessagesButton;
