import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Dropdown, Form, Input, Modal, Spin, message } from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  LogoutOutlined,
  MoreOutlined,
  SendOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ChatMessage, Conversation, messageService } from '../services/messageService';
import { messagingKeys } from '../hooks/useMessaging';
import { useAuth } from '../contexts/AuthContext';
import PeopleSelect from '../components/messaging/PeopleSelect';
import TransferCard from '../components/messaging/TransferCard';
import '../components/messaging/Messaging.css';

const THREAD_POLL_MS = 5_000;
const INBOX_POLL_MS = 15_000;
const PAGE_SIZE = 50;
// Messages from the same person this close together share one name line
const GROUPING_MS = 5 * 60_000;

const initial = (name?: string | null) => (name || '?').trim().charAt(0).toUpperCase();

const shortTime = (iso: string | null) => {
  if (!iso) return '';
  const time = dayjs(iso);
  if (time.isSame(dayjs(), 'day')) return time.format('h:mm A');
  if (time.isSame(dayjs(), 'year')) return time.format('MMM D');
  return time.format('MMM D, YYYY');
};

const fullTime = (iso: string) => dayjs(iso).format('MMM D, h:mm A');

const errorDetail = (error: any, fallback: string) => error?.response?.data?.detail || fallback;

const previewOf = (conversation: Conversation, myId?: string) => {
  const last = conversation.last_message;
  if (!last) return 'No messages yet';
  if (last.kind === 'notice') return last.body;
  const firstLine = last.body.split('\n')[0];
  if (last.sender_id === myId) return `You: ${firstLine}`;
  return conversation.is_group && last.sender_name ? `${last.sender_name.split(' ')[0]}: ${firstLine}` : firstLine;
};

// ---------------------------------------------------------------------------

const NewConversationModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [people, setPeople] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (open) {
      setPeople([]);
      setTitle('');
    }
  }, [open]);

  const start = useMutation({
    mutationFn: () => messageService.start(people, title.trim() || undefined),
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.conversations });
      onClose();
      navigate(`/messages/${conversation.id}`);
    },
    onError: (error) => message.error(errorDetail(error, "Couldn't start the conversation")),
  });

  return (
    <Modal
      open={open}
      title="New conversation"
      okText="Start"
      onOk={() => start.mutate()}
      okButtonProps={{ disabled: people.length === 0, loading: start.isPending }}
      onCancel={onClose}
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item label="With" required>
          <PeopleSelect value={people} onChange={setPeople} autoFocus />
        </Form.Item>
        <Form.Item
          label="Group name"
          extra="Optional. Picking two or more people, or giving it a name, makes a group."
          style={{ marginBottom: 0 }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Roof crew" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------

const Inbox: React.FC<{
  conversations: Conversation[];
  loading: boolean;
  activeId?: string;
  onNew: () => void;
}> = ({ conversations, loading, activeId, onNew }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <aside className="messages-inbox" aria-label="Conversations">
      <div className="messages-inbox-head">
        <h1>Messages</h1>
        <Button type="text" icon={<EditOutlined />} onClick={onNew}>
          New
        </Button>
      </div>
      {loading ? (
        <div className="messages-inbox-empty"><Spin size="small" /></div>
      ) : conversations.length === 0 ? (
        <div className="messages-inbox-empty">
          No conversations yet. Use New to message a colleague or start a group.
        </div>
      ) : (
        <ul className="messages-inbox-list">
          {conversations.map((conversation) => {
            const unread = conversation.unread_count > 0;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={[
                    'conversation-row',
                    conversation.id === activeId ? 'is-active' : '',
                    unread ? 'is-unread' : '',
                  ].join(' ')}
                  onClick={() => navigate(`/messages/${conversation.id}`)}
                  aria-current={conversation.id === activeId ? 'page' : undefined}
                >
                  <Avatar
                    size={28}
                    className={`conversation-row-avatar${conversation.is_group ? ' is-group' : ''}`}
                    icon={conversation.is_group ? <TeamOutlined /> : undefined}
                  >
                    {!conversation.is_group && initial(conversation.display_name)}
                  </Avatar>
                  <span className="conversation-row-text">
                    <span className="conversation-row-top">
                      <span className="conversation-row-name">{conversation.display_name}</span>
                      <span className="conversation-row-time">
                        {shortTime(conversation.last_message_at || conversation.created_at)}
                      </span>
                    </span>
                    <span className="conversation-row-bottom">
                      <span className="conversation-row-preview">{previewOf(conversation, user?.id)}</span>
                      {unread && <Badge count={conversation.unread_count} size="small" />}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
};

// ---------------------------------------------------------------------------

const MessageRow: React.FC<{ msg: ChatMessage; startsGroup: boolean; myId?: string }> = ({
  msg, startsGroup, myId,
}) => {
  const { canAccessPath } = useAuth();
  if (msg.kind === 'notice') {
    return <div className="message-notice">{msg.body} · {shortTime(msg.created_at)}</div>;
  }
  const mine = msg.sender_id === myId;
  // The offer card already says what was sent; keep only the note under it
  const body = msg.kind === 'document_transfer' ? msg.body.split('\n\n').slice(1).join('\n\n') : msg.body;

  return (
    <div className={`message-row${startsGroup ? ' starts-group' : ''}`}>
      <div className="message-row-gutter">
        {startsGroup && (
          <Avatar size={28} className={`message-row-avatar${mine ? ' is-me' : ''}`}>
            {initial(msg.sender_name)}
          </Avatar>
        )}
      </div>
      <div className="message-row-content">
        {startsGroup && (
          <div className="message-row-head">
            <span className="message-row-name">{mine ? 'You' : msg.sender_name || 'Someone'}</span>
            <span className="message-row-time" title={fullTime(msg.created_at)}>{shortTime(msg.created_at)}</span>
          </div>
        )}
        {msg.kind === 'document_transfer' && <div className="message-row-body">Sent a document to accept:</div>}
        {msg.kind === 'document_transfer' && msg.transfer && <TransferCard transfer={msg.transfer} />}
        {body && (
          <div
            className={`message-row-body${msg.kind === 'transfer_reply' ? ' is-reply' : ''}`}
            title={startsGroup ? undefined : fullTime(msg.created_at)}
          >
            {body}
          </div>
        )}
        {msg.related_type === 'client' && msg.related_id && canAccessPath('/clients') && (
          <Link className="message-row-link" to={`/clients/${msg.related_id}`}>Open client</Link>
        )}
      </div>
    </div>
  );
};

const RenameModal: React.FC<{ conversation: Conversation; open: boolean; onClose: () => void }> = ({
  conversation, open, onClose,
}) => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(conversation.title || '');
  useEffect(() => {
    if (open) setTitle(conversation.title || '');
  }, [open, conversation.title]);

  const rename = useMutation({
    mutationFn: () => messageService.rename(conversation.id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      onClose();
    },
    onError: (error) => message.error(errorDetail(error, "Couldn't rename the group")),
  });

  return (
    <Modal
      open={open}
      title="Rename group"
      okText="Save"
      onOk={() => rename.mutate()}
      okButtonProps={{ disabled: !title.trim(), loading: rename.isPending }}
      onCancel={onClose}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
    </Modal>
  );
};

const AddPeopleModal: React.FC<{ conversation: Conversation; open: boolean; onClose: () => void }> = ({
  conversation, open, onClose,
}) => {
  const queryClient = useQueryClient();
  const [people, setPeople] = useState<string[]>([]);
  useEffect(() => {
    if (open) setPeople([]);
  }, [open]);
  const members = useMemo(() => conversation.participants.map((p) => p.id), [conversation.participants]);

  const add = useMutation({
    mutationFn: () => messageService.addPeople(conversation.id, people),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      onClose();
    },
    onError: (error) => message.error(errorDetail(error, "Couldn't add them")),
  });

  return (
    <Modal
      open={open}
      title="Add people"
      okText="Add"
      onOk={() => add.mutate()}
      okButtonProps={{ disabled: people.length === 0, loading: add.isPending }}
      onCancel={onClose}
      destroyOnClose
    >
      <p style={{ color: 'var(--color-neutral-600)' }}>They'll see the conversation so far.</p>
      <PeopleSelect value={people} onChange={setPeople} exclude={members} autoFocus />
    </Modal>
  );
};

const mergeById = (older: ChatMessage[], latest: ChatMessage[]) => {
  const seen = new Set<string>();
  return [...older, ...latest].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
};

const Thread: React.FC<{ conversationId: string; conversation?: Conversation }> = ({
  conversationId, conversation,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [draft, setDraft] = useState('');
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepScrollFrom = useRef<number | null>(null);

  // A conversation opened from a link may not be in the inbox list yet
  const { data: fetched, isError: notFound } = useQuery({
    queryKey: ['messages', 'conversation', conversationId],
    queryFn: () => messageService.conversation(conversationId),
    enabled: !conversation,
    retry: false,
  });
  const current = conversation || fetched;

  const { data: latest = [], isLoading } = useQuery({
    queryKey: messagingKeys.thread(conversationId),
    queryFn: () => messageService.messages(conversationId),
    refetchInterval: THREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    setOlder([]);
    setDraft('');
    stickToBottom.current = true;
  }, [conversationId]);

  useEffect(() => {
    if (!isLoading && older.length === 0) setHasOlder(latest.length >= PAGE_SIZE);
  }, [isLoading, latest.length, older.length]);

  const all = useMemo(() => mergeById(older, latest), [older, latest]);
  const lastId = all.length ? all[all.length - 1].id : null;

  // Mark read whenever something new shows while the page is in view
  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    messageService.markRead(conversationId).then(() => {
      queryClient.invalidateQueries({ queryKey: messagingKeys.unread });
      queryClient.invalidateQueries({ queryKey: messagingKeys.conversations });
    }).catch(() => {});
  }, [conversationId, queryClient]);

  useEffect(() => {
    if (lastId) markRead();
  }, [lastId, markRead]);

  useEffect(() => {
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [markRead]);

  // Keep the view at the bottom for new messages, unless the reader scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepScrollFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepScrollFrom.current;
      keepScrollFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [all]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    if (!all.length) return;
    setLoadingOlder(true);
    try {
      const page = await messageService.messages(conversationId, { before: all[0].created_at });
      keepScrollFrom.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
      setOlder((prev) => mergeById(page, prev));
      setHasOlder(page.length >= PAGE_SIZE);
    } catch (error) {
      message.error(errorDetail(error, "Couldn't load earlier messages"));
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = useMutation({
    mutationFn: (body: string) => messageService.send(conversationId, body),
    onSuccess: (sent) => {
      stickToBottom.current = true;
      queryClient.setQueryData<ChatMessage[]>(messagingKeys.thread(conversationId), (prev = []) => [...prev, sent]);
      queryClient.invalidateQueries({ queryKey: messagingKeys.conversations });
    },
    onError: (error, body) => {
      setDraft(body);
      message.error(errorDetail(error, "Couldn't send the message"));
    },
  });

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(body);
  };

  const leave = () => {
    Modal.confirm({
      title: 'Leave this group?',
      content: "You won't see its messages anymore unless someone adds you back.",
      okText: 'Leave',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await messageService.leave(conversationId);
          queryClient.invalidateQueries({ queryKey: ['messages'] });
          navigate('/messages');
        } catch (error) {
          message.error(errorDetail(error, "Couldn't leave the group"));
        }
      },
    });
  };

  if (notFound && !conversation) {
    return <div className="messages-thread-empty">This conversation doesn't exist or you're not in it.</div>;
  }

  const members = current?.participants.filter((p) => p.id !== user?.id).map((p) => p.name) ?? [];

  return (
    <>
      <div className="thread-head">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          className="thread-back"
          aria-label="Back to conversations"
          onClick={() => navigate('/messages')}
        />
        <div className="thread-head-text">
          <div className="thread-head-name">{current?.display_name ?? ' '}</div>
          {current?.is_group && <div className="thread-head-members">You, {members.join(', ')}</div>}
        </div>
        {current?.is_group && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'rename', icon: <EditOutlined />, label: 'Rename group', onClick: () => setRenaming(true) },
                { key: 'add', icon: <UserAddOutlined />, label: 'Add people', onClick: () => setAdding(true) },
                { type: 'divider' },
                { key: 'leave', icon: <LogoutOutlined />, label: 'Leave group', danger: true, onClick: leave },
              ],
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="Group options" />
          </Dropdown>
        )}
      </div>

      <div className="thread-messages" ref={scroller} onScroll={onScroll} aria-live="polite">
        {isLoading ? (
          <div className="messages-thread-empty"><Spin /></div>
        ) : all.length === 0 ? (
          <div className="messages-thread-empty">No messages yet. Say hello.</div>
        ) : (
          <>
            {hasOlder && (
              <div className="thread-older">
                <Button size="small" type="text" loading={loadingOlder} onClick={loadOlder}>
                  Load earlier messages
                </Button>
              </div>
            )}
            {all.map((msg, i) => {
              const prev = all[i - 1];
              const startsGroup = !prev
                || prev.kind === 'notice'
                || prev.sender_id !== msg.sender_id
                || dayjs(msg.created_at).diff(dayjs(prev.created_at)) > GROUPING_MS;
              return <MessageRow key={msg.id} msg={msg} startsGroup={startsGroup} myId={user?.id} />;
            })}
          </>
        )}
      </div>

      <div className="thread-composer">
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Write a message"
          autoSize={{ minRows: 1, maxRows: 6 }}
          maxLength={5000}
          aria-label="Message"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={submit}
          disabled={!draft.trim()}
          loading={send.isPending}
          aria-label="Send"
        />
      </div>

      {current && (
        <>
          <RenameModal conversation={current} open={renaming} onClose={() => setRenaming(false)} />
          <AddPeopleModal conversation={current} open={adding} onClose={() => setAdding(false)} />
        </>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------

const Messages: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [starting, setStarting] = useState(false);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: messagingKeys.conversations,
    queryFn: messageService.conversations,
    refetchInterval: INBOX_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const active = conversations.find((c) => c.id === conversationId);

  return (
    <div className={`messages-page${conversationId ? ' has-thread' : ''}`}>
      <Inbox
        conversations={conversations}
        loading={isLoading}
        activeId={conversationId}
        onNew={() => setStarting(true)}
      />
      <section className="messages-thread" aria-label="Conversation">
        {conversationId ? (
          <Thread key={conversationId} conversationId={conversationId} conversation={active} />
        ) : (
          <div className="messages-thread-empty">Pick a conversation, or use New to start one.</div>
        )}
      </section>
      <NewConversationModal open={starting} onClose={() => setStarting(false)} />
    </div>
  );
};

export default Messages;
