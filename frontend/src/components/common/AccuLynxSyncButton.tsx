/**
 * AccuLynx Sync Button
 *
 * Generic, claim-scoped button: works for any claim type (water
 * mitigation, roofing, siding, etc.) since it only needs a `claimId`.
 *
 * - Not linked yet: shows "AccuLynx 연결" -> modal with two tabs:
 *   - "기존 Lead 연결": search AccuLynx jobs and link one
 *   - "새 Lead 만들기": create a new AccuLynx contact + job (lead), then link it
 * - Linked: shows "AccuLynx로 전송" -> sync -> result modal.
 *
 * Self-contained/removable - see
 * backend/app/domains/integrations/acculynx/__init__.py for the full
 * removal checklist (this file is one of the pieces to delete).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Button, Divider, Input, List, Modal, Radio, Select, Space, Tabs, Tag, Tooltip, message } from 'antd';
import { CloudUploadOutlined, LinkOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import acculynxService, {
  AccuLynxAddressInput,
  AccuLynxContactSearchItem,
  AccuLynxJobSearchItem,
  AccuLynxLink,
  AccuLynxSyncResult,
  AccuLynxUserItem,
} from '../../services/acculynxService';

const contactLinkToSearchItem = (link: { acculynx_contact_id: string; first_name?: string; last_name?: string; company_name?: string }): AccuLynxContactSearchItem => ({
  id: link.acculynx_contact_id,
  first_name: link.first_name,
  last_name: link.last_name,
  company_name: link.company_name,
});

export interface AccuLynxPrefill {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: {
    street1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  notes?: string;
}

interface AccuLynxSyncButtonProps {
  claimId: string;
  clientId?: string;
  type?: 'default' | 'primary' | 'text' | 'link';
  size?: 'small' | 'middle' | 'large';
  prefill?: AccuLynxPrefill;
}

const AccuLynxSyncButton: React.FC<AccuLynxSyncButtonProps> = ({
  claimId,
  clientId,
  type = 'default',
  size = 'middle',
  prefill,
}) => {
  const [link, setLink] = useState<AccuLynxLink | null | undefined>(undefined); // undefined = loading
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'existing' | 'new'>('existing');
  const [syncing, setSyncing] = useState(false);

  // -- Tab 1: link to an existing AccuLynx job --
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AccuLynxJobSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  // -- Tab 2: create a new lead --
  const [contactMode, setContactMode] = useState<'new' | 'existing'>('new');
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<AccuLynxContactSearchItem[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<AccuLynxContactSearchItem | null>(null);
  const [firstName, setFirstName] = useState(prefill?.firstName || '');
  const [lastName, setLastName] = useState(prefill?.lastName || '');
  const [email, setEmail] = useState(prefill?.email || '');
  const [phone, setPhone] = useState(prefill?.phone || '');
  const [street1, setStreet1] = useState(prefill?.address?.street1 || '');
  const [city, setCity] = useState(prefill?.address?.city || '');
  const [stateAbbr, setStateAbbr] = useState(prefill?.address?.state || '');
  const [zipCode, setZipCode] = useState(prefill?.address?.zipCode || '');
  const [notes, setNotes] = useState(prefill?.notes || '');
  const [users, setUsers] = useState<AccuLynxUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [representativeUserId, setRepresentativeUserId] = useState<string | undefined>();
  const [creatingLead, setCreatingLead] = useState(false);

  // -- Auto-search AccuLynx on modal open, so an existing lead is never missed
  // (prevents accidentally creating a duplicate job for a lead AccuLynx already has) --
  const [autoSearchDone, setAutoSearchDone] = useState(false);

  // -- Reuse this client's already-known AccuLynx contact across their other claims,
  // instead of creating a duplicate contact every time a new lead is made --
  const [clientContactChecked, setClientContactChecked] = useState(false);
  const [clientContact, setClientContact] = useState<AccuLynxContactSearchItem | null>(null);

  const loadLink = async () => {
    try {
      const result = await acculynxService.getLink(claimId);
      setLink(result);
    } catch (error) {
      console.error('Failed to load AccuLynx link:', error);
      setLink(null);
    }
  };

  useEffect(() => {
    if (claimId) {
      loadLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  useEffect(() => {
    if (activeTab === 'new' && users.length === 0 && !usersLoading) {
      setUsersLoading(true);
      acculynxService.getUsers()
        .then(setUsers)
        .catch((error) => console.error('Failed to load AccuLynx users:', error))
        .finally(() => setUsersLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Auto-search AccuLynx by address/name as soon as the modal opens, and land on
  // whichever tab makes sense: matches found -> "기존 Lead 연결" (pre-filled),
  // nothing found -> "새 Lead 만들기". Either way the user can still switch tabs.
  useEffect(() => {
    if (!linkModalOpen || autoSearchDone) return;

    const query = (prefill?.address?.street1 || [prefill?.lastName, prefill?.firstName].filter(Boolean).join(' ')).trim();
    if (!query) {
      setActiveTab('new');
      setAutoSearchDone(true);
      return;
    }

    setSearching(true);
    setSearchQuery(query);
    acculynxService.searchJobs(query)
      .then((result) => {
        setSearchResults(result.items);
        setActiveTab(result.items.length > 0 ? 'existing' : 'new');
      })
      .catch((error) => console.error('AccuLynx auto-search failed:', error))
      .finally(() => {
        setSearching(false);
        setAutoSearchDone(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkModalOpen]);

  // Check whether this client already has a known AccuLynx contact (from a
  // previous claim's lead), and pre-select it in the "새 Lead 만들기" tab so
  // it gets reused instead of creating a duplicate contact.
  useEffect(() => {
    if (!linkModalOpen || !clientId || clientContactChecked) return;

    acculynxService.getClientContactLink(clientId)
      .then((result) => {
        if (result) {
          setClientContact(contactLinkToSearchItem(result));
          setContactMode('existing');
          setSelectedContact(contactLinkToSearchItem(result));
        }
      })
      .catch((error) => console.error('Failed to load client AccuLynx contact link:', error))
      .finally(() => setClientContactChecked(true));
  }, [linkModalOpen, clientId, clientContactChecked]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const result = await acculynxService.searchJobs(searchQuery.trim());
      setSearchResults(result.items);
    } catch (error: any) {
      message.error(`AccuLynx 검색 실패: ${error.response?.data?.detail || error.message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectJob = async (job: AccuLynxJobSearchItem) => {
    setLinking(true);
    try {
      const newLink = await acculynxService.linkClaim(claimId, job.id, job.job_number);
      setLink(newLink);
      setLinkModalOpen(false);
      setSearchResults([]);
      setSearchQuery('');
      message.success('AccuLynx job과 연결되었습니다.');
    } catch (error: any) {
      message.error(`연결 실패: ${error.response?.data?.detail || error.message}`);
    } finally {
      setLinking(false);
    }
  };

  const handleContactSearch = async () => {
    if (!contactQuery.trim()) return;
    setContactSearching(true);
    try {
      const result = await acculynxService.searchContacts(contactQuery.trim());
      setContactResults(result.items);
    } catch (error: any) {
      message.error(`연락처 검색 실패: ${error.response?.data?.detail || error.message}`);
    } finally {
      setContactSearching(false);
    }
  };

  const handleCreateLead = async () => {
    if (contactMode === 'existing' && !selectedContact) {
      message.warning('먼저 기존 연락처를 선택해주세요.');
      return;
    }
    if (contactMode === 'new' && !firstName.trim() && !lastName.trim()) {
      message.warning('이름을 입력해주세요.');
      return;
    }

    const address: AccuLynxAddressInput | undefined = street1.trim()
      ? { street1: street1.trim(), city: city.trim(), state: stateAbbr.trim(), zip_code: zipCode.trim(), country: 'USA' }
      : undefined;

    setCreatingLead(true);
    try {
      const newLink = await acculynxService.createLead(claimId, {
        contact_id: contactMode === 'existing' ? selectedContact!.id : undefined,
        new_contact: contactMode === 'new' ? {
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address,
        } : undefined,
        address,
        notes: notes.trim() || undefined,
        representative_user_id: representativeUserId,
      });
      setLink(newLink);
      setLinkModalOpen(false);
      message.success('AccuLynx에 새 lead가 생성되고 연결되었습니다.');
    } catch (error: any) {
      message.error(`Lead 생성 실패: ${error.response?.data?.detail || error.message}`);
    } finally {
      setCreatingLead(false);
    }
  };

  const showSyncResult = (result: AccuLynxSyncResult) => {
    const failedItems = result.results.filter((r) => r.status === 'failed');

    Modal.info({
      title: 'AccuLynx 전송 결과',
      width: 480,
      content: (
        <div>
          <ul style={{ marginTop: 12, paddingLeft: 20 }}>
            <li>대상 파일: {result.total_candidates}개</li>
            <li>이미 전송됨(스킵): {result.already_synced}개</li>
            <li>성공: {result.succeeded}개</li>
            {result.failed > 0 && (
              <li style={{ color: 'red' }}>실패: {result.failed}개</li>
            )}
          </ul>
          {failedItems.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 'bold' }}>실패 내역:</p>
              <ul style={{ maxHeight: 150, overflow: 'auto', paddingLeft: 20 }}>
                {failedItems.map((item) => (
                  <li key={item.source_id}>
                    {item.filename || item.source_id}: {item.error_message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ),
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await acculynxService.sync(claimId);
      showSyncResult(result);
    } catch (error: any) {
      Modal.error({
        title: 'AccuLynx 전송 실패',
        content: error.response?.data?.detail || error.message || '알 수 없는 오류',
      });
    } finally {
      setSyncing(false);
    }
  };

  if (link === undefined) {
    return null; // still loading link status
  }

  if (!link) {
    return (
      <>
        <Tooltip title="이 claim을 AccuLynx job(lead)에 연결합니다">
          <Button
            type={type}
            size={size}
            icon={<LinkOutlined />}
            onClick={() => setLinkModalOpen(true)}
          >
            AccuLynx 연결
          </Button>
        </Tooltip>
        <Modal
          title="AccuLynx 연결"
          open={linkModalOpen}
          onCancel={() => { setLinkModalOpen(false); setAutoSearchDone(false); setClientContactChecked(false); }}
          footer={null}
          width={560}
        >
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'existing' | 'new')}
            items={[
              {
                key: 'existing',
                label: searchResults.length > 0 ? `기존 Lead 연결 (${searchResults.length})` : '기존 Lead 연결',
                children: (
                  <>
                    {autoSearchDone && searchResults.length > 0 && (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={`AccuLynx에 비슷한 lead가 ${searchResults.length}개 있어요. 맞는 걸 선택해서 연결하세요.`}
                      />
                    )}
                    <Input.Search
                      placeholder="주소 또는 이름으로 검색"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onSearch={handleSearch}
                      loading={searching}
                      enterButton={<SearchOutlined />}
                    />
                    <List
                      style={{ marginTop: 16, maxHeight: 320, overflow: 'auto' }}
                      dataSource={searchResults}
                      locale={{ emptyText: '검색 결과가 없습니다' }}
                      renderItem={(job) => (
                        <List.Item
                          actions={[
                            <Button key="select" type="link" loading={linking} onClick={() => handleSelectJob(job)}>
                              선택
                            </Button>,
                          ]}
                        >
                          <List.Item.Meta
                            title={job.job_name || job.job_number || job.id}
                            description={
                              <>
                                {job.address}
                                {job.current_milestone && <Tag style={{ marginLeft: 8 }}>{job.current_milestone}</Tag>}
                              </>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </>
                ),
              },
              {
                key: 'new',
                label: '새 Lead 만들기',
                children: (
                  <div style={{ maxHeight: 460, overflow: 'auto', paddingRight: 4 }}>
                    {searchResults.length > 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={`AccuLynx에 이미 비슷한 lead가 ${searchResults.length}개 있어요. 중복 생성일 수 있습니다.`}
                        description={
                          <Button size="small" onClick={() => setActiveTab('existing')}>
                            기존 Lead 목록 보기
                          </Button>
                        }
                      />
                    )}
                    {clientContact && contactMode === 'existing' && selectedContact?.id === clientContact.id && (
                      <Alert
                        type="success"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={`이 손님은 이미 AccuLynx 연락처가 있어요: ${[clientContact.first_name, clientContact.last_name].filter(Boolean).join(' ') || clientContact.company_name || clientContact.id}. 재사용합니다.`}
                      />
                    )}
                    <Radio.Group
                      value={contactMode}
                      onChange={(e) => setContactMode(e.target.value)}
                      style={{ marginBottom: 12 }}
                    >
                      <Radio.Button value="new">새 연락처로 생성</Radio.Button>
                      <Radio.Button value="existing">기존 연락처 사용</Radio.Button>
                    </Radio.Group>

                    {contactMode === 'existing' ? (
                      <>
                        <Input.Search
                          placeholder="이름 또는 회사명으로 검색"
                          value={contactQuery}
                          onChange={(e) => setContactQuery(e.target.value)}
                          onSearch={handleContactSearch}
                          loading={contactSearching}
                          enterButton={<SearchOutlined />}
                        />
                        <List
                          style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}
                          dataSource={contactResults}
                          locale={{ emptyText: '검색 결과가 없습니다' }}
                          renderItem={(c) => (
                            <List.Item
                              style={{
                                cursor: 'pointer',
                                background: selectedContact?.id === c.id ? '#e6f4ff' : undefined,
                              }}
                              onClick={() => setSelectedContact(c)}
                            >
                              <List.Item.Meta
                                title={`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company_name || c.id}
                                description={[c.address, c.email, c.phone].filter(Boolean).join(' · ')}
                              />
                            </List.Item>
                          )}
                        />
                      </>
                    ) : (
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input placeholder="이름" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                          <Input placeholder="성" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                        </Space.Compact>
                        <Input placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
                        <Input placeholder="전화번호" value={phone} onChange={(e) => setPhone(e.target.value)} />
                        <Input placeholder="주소" value={street1} onChange={(e) => setStreet1(e.target.value)} />
                        <Space.Compact style={{ width: '100%' }}>
                          <Input placeholder="도시" value={city} onChange={(e) => setCity(e.target.value)} />
                          <Input placeholder="주(예: VA)" value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value)} style={{ width: 100 }} />
                          <Input placeholder="우편번호" value={zipCode} onChange={(e) => setZipCode(e.target.value)} style={{ width: 120 }} />
                        </Space.Compact>
                      </Space>
                    )}

                    <Divider style={{ margin: '16px 0 12px' }} />
                    <Input.TextArea
                      placeholder="메모 (선택)"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      style={{ marginBottom: 8 }}
                    />
                    <Select
                      placeholder="담당자 지정 (선택)"
                      style={{ width: '100%' }}
                      allowClear
                      loading={usersLoading}
                      value={representativeUserId}
                      onChange={setRepresentativeUserId}
                      options={users.map((u) => ({ value: u.id, label: `${u.display_name}${u.role ? ` (${u.role})` : ''}` }))}
                    />

                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleCreateLead}
                      loading={creatingLead}
                      style={{ marginTop: 16 }}
                      block
                    >
                      Lead 생성 및 연결
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </Modal>
      </>
    );
  }

  return (
    <Tooltip title={`연결된 AccuLynx job: ${link.acculynx_job_number || link.acculynx_job_id}`}>
      <Button
        type={type}
        size={size}
        icon={<CloudUploadOutlined />}
        onClick={handleSync}
        loading={syncing}
      >
        AccuLynx로 전송
      </Button>
    </Tooltip>
  );
};

export default AccuLynxSyncButton;
