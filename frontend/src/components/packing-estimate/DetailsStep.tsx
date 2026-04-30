/**
 * DetailsStep - Client/Company selection + estimation settings
 * Uses DB-integrated client/company selection (like CabinetEstimateDetail)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Row, Col, Card, Select, Input, InputNumber, Switch, Radio,
  Space, Typography, AutoComplete, Divider, Form,
} from 'antd';
import {
  UserOutlined, BankOutlined, SettingOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { companyService } from '../../services/companyService';
import { clientService } from '../../services/clientService';
import type { Company } from '../../types';
import type { PackingSettings, Region } from '../../types/packing-estimate';
import {
  REGION_OPTIONS, DENSITY_OPTIONS, DEFAULT_SETTINGS,
} from './constants';

const { Title, Text } = Typography;
const { Option } = Select;

interface DetailsStepProps {
  settings: PackingSettings;
  setSettings: (s: PackingSettings) => void;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
  selectedClaimId: string | null;
  setSelectedClaimId: (id: string | null) => void;
  projectAddress: string;
  setProjectAddress: (addr: string) => void;
  calculationName: string;
  setCalculationName: (name: string) => void;
}

const DetailsStep: React.FC<DetailsStepProps> = ({
  settings, setSettings,
  selectedCompanyId, setSelectedCompanyId,
  selectedClientId, setSelectedClientId,
  selectedClaimId, setSelectedClaimId,
  projectAddress, setProjectAddress,
  calculationName, setCalculationName,
}) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState('');

  useEffect(() => {
    companyService.getCompanies().then(setCompanies).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedClientId) {
      // Load claims for selected client
      clientService.getById(selectedClientId).then((client: any) => {
        setClaims(client.claims || []);
      }).catch(() => {});
    } else {
      setClaims([]);
      setSelectedClaimId(null);
    }
  }, [selectedClientId, setSelectedClaimId]);

  const handleClientSearch = useCallback(async (value: string) => {
    setClientSearch(value);
    if (value.length >= 2) {
      try {
        const result = await clientService.search(value, 20);
        setClients(result.items || result || []);
      } catch { setClients([]); }
    }
  }, []);

  const handleClientSelect = useCallback((clientId: string) => {
    const client = clients.find((c: any) => c.id === clientId);
    if (client) {
      setSelectedClientId(clientId);
      if (client.address) {
        setProjectAddress(
          [client.address, client.city, client.state, client.zipcode]
            .filter(Boolean).join(', ')
        );
      }
      setClientSearch(client.display_name || '');
    }
  }, [clients, setSelectedClientId, setProjectAddress]);

  const patchSettings = (patch: Partial<PackingSettings>) =>
    setSettings({ ...settings, ...patch });

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Estimate Name */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item label="Estimate Name">
            <Input
              placeholder="e.g., Smith Residence Pack-Out"
              value={calculationName}
              onChange={e => setCalculationName(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* Company & Client Selection */}
      <Card
        size="small"
        title={<><BankOutlined /> Company & Client</>}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form layout="vertical">
              <Form.Item label="Company" required>
                <Select
                  placeholder="Select company"
                  value={selectedCompanyId || undefined}
                  onChange={setSelectedCompanyId}
                  showSearch
                  optionFilterProp="children"
                >
                  {companies.map(c => (
                    <Option key={c.id} value={c.id}>
                      {c.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Form>
          </Col>
          <Col span={12}>
            <Form layout="vertical">
              <Form.Item label="Client">
                <AutoComplete
                  placeholder="Search client..."
                  value={clientSearch}
                  onSearch={handleClientSearch}
                  onSelect={handleClientSelect}
                  options={clients.map((c: any) => ({
                    value: c.id,
                    label: `${c.display_name} — ${c.address || ''}`,
                  }))}
                />
              </Form.Item>
            </Form>
          </Col>
        </Row>

        {claims.length > 0 && (
          <Row gutter={16}>
            <Col span={12}>
              <Form layout="vertical">
                <Form.Item label="Claim (Optional)">
                  <Select
                    placeholder="Select claim"
                    value={selectedClaimId || undefined}
                    onChange={setSelectedClaimId}
                    allowClear
                  >
                    {claims.map((cl: any) => (
                      <Option key={cl.id} value={cl.id}>
                        {cl.claim_number} ({cl.insurance_company || 'N/A'})
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Form>
            </Col>
            <Col span={12}>
              <Form layout="vertical">
                <Form.Item label="Property Address">
                  <Input
                    value={projectAddress}
                    onChange={e => setProjectAddress(e.target.value)}
                  />
                </Form.Item>
              </Form>
            </Col>
          </Row>
        )}

        {!claims.length && (
          <Form layout="vertical">
            <Form.Item label="Property Address">
              <Input
                value={projectAddress}
                onChange={e => setProjectAddress(e.target.value)}
              />
            </Form.Item>
          </Form>
        )}
      </Card>

      {/* Estimation Settings */}
      <Card
        size="small"
        title={<><SettingOutlined /> Estimation Settings</>}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={[16, 12]}>
          <Col span={6}>
            <Form layout="vertical">
              <Form.Item label="Crew Size">
                <InputNumber
                  min={2} max={6}
                  value={settings.crew_size}
                  onChange={v => patchSettings({ crew_size: v || 4 })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Form>
          </Col>
          <Col span={6}>
            <Form layout="vertical">
              <Form.Item label="Region">
                <Select
                  value={settings.region}
                  onChange={(v: Region) => patchSettings({ region: v })}
                >
                  {REGION_OPTIONS.map(r => (
                    <Option key={r.value} value={r.value}>
                      {r.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Form>
          </Col>
          <Col span={6}>
            <Form layout="vertical">
              <Form.Item label="Staging">
                <Radio.Group
                  value={settings.staging_type}
                  onChange={e => patchSettings({ staging_type: e.target.value })}
                >
                  <Radio.Button value="off_site">Off-Site</Radio.Button>
                  <Radio.Button value="on_site">On-Site</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Form>
          </Col>
          <Col span={6}>
            <Form layout="vertical">
              <Form.Item label="Storage Months">
                <InputNumber
                  min={0} max={12}
                  value={settings.storage_months}
                  onChange={v => patchSettings({ storage_months: v || 0 })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Form>
          </Col>
        </Row>

        <Divider style={{ margin: '12px 0' }} />

        <Row gutter={[24, 8]}>
          <Col span={8}>
            <Space>
              <Switch
                checked={settings.include_packback}
                onChange={v => patchSettings({ include_packback: v })}
                size="small"
              />
              <Text>Include Pack-Back</Text>
            </Space>
          </Col>
          <Col span={8}>
            <Space>
              <Switch
                checked={settings.include_op}
                onChange={v => patchSettings({ include_op: v })}
                size="small"
              />
              <Text>O&P</Text>
              {settings.include_op && (
                <InputNumber
                  min={0} max={30} size="small"
                  value={settings.op_rate}
                  onChange={v => patchSettings({ op_rate: v || 0 })}
                  formatter={v => `${v}%`}
                  style={{ width: 70 }}
                />
              )}
            </Space>
          </Col>
          <Col span={8}>
            <Space>
              <Switch
                checked={settings.include_contingency}
                onChange={v => patchSettings({ include_contingency: v })}
                size="small"
              />
              <Text>Contingency</Text>
              {settings.include_contingency && (
                <InputNumber
                  min={0} max={20} size="small"
                  value={settings.contingency_rate}
                  onChange={v => patchSettings({ contingency_rate: v || 0 })}
                  formatter={v => `${v}%`}
                  style={{ width: 70 }}
                />
              )}
            </Space>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default DetailsStep;
