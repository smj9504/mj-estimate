import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Row,
  Col,
  InputNumber,
  Switch,
  Divider,
  Space,
  Tag,
  Tooltip,
  Alert,
  Spin
} from 'antd';
import {
  DollarOutlined,
  CreditCardOutlined,
  CalculatorOutlined,
  InfoCircleOutlined,
  EditOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import documentTypeService from '../../services/documentTypeService';
import { CostBreakdown, Credit } from '../../types';

const { Title, Text } = Typography;

interface CostCalculationPanelProps {
  documentType: string;
  selectedTrades: string[];
  availableCredits: Credit[];
  companyId: string;
  additionalCostsTotal?: number;
  onCostChange: (cost: number) => void;
  onTaxSettingsChange?: (applyTax: boolean, taxRate: number) => void;
  initialApplyTax?: boolean;
  initialTaxRate?: number;
  loading?: boolean;
}

const CostCalculationPanel: React.FC<CostCalculationPanelProps> = ({
  documentType,
  selectedTrades,
  availableCredits,
  companyId,
  additionalCostsTotal = 0,
  onCostChange,
  onTaxSettingsChange,
  initialApplyTax = false,
  initialTaxRate = 0,
  loading = false
}) => {
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown>({
    baseCost: 0,
    creditsApplied: 0,
    finalCost: 0,
    availableCredits: 0
  });
  const [manualOverride, setManualOverride] = useState(false);
  const [overrideCost, setOverrideCost] = useState<number>(0);
  const [calculating, setCalculating] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(initialApplyTax);
  const [taxRate, setTaxRate] = useState<number>(initialTaxRate);
  
  // Notify parent when tax settings change
  useEffect(() => {
    if (onTaxSettingsChange) {
      onTaxSettingsChange(taxEnabled, taxRate);
    }
  }, [taxEnabled, taxRate, onTaxSettingsChange]);

  // Load document types from backend
  const { data: documentTypes = [] } = useQuery({
    queryKey: ['documentTypes'],
    queryFn: () => documentTypeService.getDocumentTypes(),
  });

  // Load trades from backend
  const { data: trades = [] } = useQuery({
    queryKey: ['trades'],
    queryFn: () => documentTypeService.getTrades(),
  });

  // Find selected document type
  const selectedDocumentType = documentTypes.find(dt => dt.id === documentType);
  
  // Find selected trades
  const selectedTradeObjects = trades.filter(trade => selectedTrades.includes(trade.id));

  // Calculate costs when inputs change
  useEffect(() => {
    if (!documentType || !selectedDocumentType) return;

    setCalculating(true);

    // Simulate API delay
    const timer = setTimeout(() => {
      // Get base cost from document type
      const baseDocumentCost = parseFloat(selectedDocumentType.base_price) || 0;
      
      // Calculate total trade costs (for now we'll use 0 since trades don't have individual prices)
      const tradesCost = 0; // Trades are included in document type pricing
      
      const totalBaseCost = baseDocumentCost + tradesCost;
      
      // Add additional costs to subtotal
      const subtotal = totalBaseCost + additionalCostsTotal;
      
      // Calculate tax only if enabled
      const taxAmount = taxEnabled ? (subtotal * (taxRate / 100)) : 0;
      
      // Calculate credits
      const totalAvailableCredits = availableCredits.reduce((sum, credit) => 
        credit.is_active ? sum + credit.amount : sum, 0
      );
      
      // Calculate applied credits (for now, just use available credits up to subtotal)
      const appliedCredits = Math.min(totalAvailableCredits, subtotal * 0.8); // Max 80% of subtotal
      
      // Final cost = subtotal + tax - credits
      const finalCalculatedCost = Math.max(0, subtotal + taxAmount - appliedCredits);

      const newBreakdown: CostBreakdown = {
        baseCost: totalBaseCost,
        creditsApplied: appliedCredits,
        finalCost: manualOverride ? overrideCost : finalCalculatedCost,
        availableCredits: totalAvailableCredits
      };

      setCostBreakdown(newBreakdown);
      onCostChange(newBreakdown.finalCost);
      setCalculating(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [documentType, selectedTrades, availableCredits, manualOverride, overrideCost, companyId, onCostChange, selectedDocumentType, additionalCostsTotal, taxEnabled, taxRate]);

  const handleManualOverride = (enabled: boolean) => {
    setManualOverride(enabled);
    if (enabled) {
      setOverrideCost(costBreakdown.finalCost);
    }
  };

  const handleOverrideCostChange = (value: number | null) => {
    const newCost = value || 0;
    setOverrideCost(newCost);
    if (manualOverride) {
      onCostChange(newCost);
    }
  };

  return (
    <Card 
      title={
        <Space>
          <CalculatorOutlined />
          <span>Cost Calculation</span>
        </Space>
      }
      extra={
        <Tooltip title="Enable to manually override the calculated cost">
          <Space>
            <EditOutlined />
            <Switch
              size="small"
              checked={manualOverride}
              onChange={handleManualOverride}
              checkedChildren="Manual"
              unCheckedChildren="Auto"
            />
          </Space>
        </Tooltip>
      }
    >
      <Spin spinning={calculating || loading}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          
          {/* Base Cost Breakdown */}
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              <DollarOutlined style={{ marginRight: 8, color: '#1890ff' }} />
              Cost Breakdown
            </Title>
            
            <Row gutter={[16, 8]}>
              <Col span={24}>
                <div style={{ background: '#f5f5f5', padding: '12px', borderRadius: '6px' }}>
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Col>
                      <Text style={{ fontSize: '12px' }}>
                        Document Type ({selectedDocumentType?.name || 'Unknown'}):
                      </Text>
                    </Col>
                    <Col>
                      <Text style={{ fontSize: '12px' }}>
                        ${selectedDocumentType ? parseFloat(selectedDocumentType.base_price).toFixed(2) : '0.00'}
                      </Text>
                    </Col>
                  </Row>
                  
                  {selectedTradeObjects.map(trade => (
                    <Row key={trade.id} justify="space-between" style={{ marginBottom: 4 }}>
                      <Col>
                        <Text style={{ fontSize: '12px' }}>{trade.name}:</Text>
                      </Col>
                      <Col>
                        <Text style={{ fontSize: '12px' }}>
                          $0.00
                        </Text>
                      </Col>
                    </Row>
                  ))}
                  
                  {additionalCostsTotal > 0 && (
                    <Row justify="space-between" style={{ marginBottom: 4 }}>
                      <Col>
                        <Text style={{ fontSize: '12px', color: '#fa8c16' }}>Additional Costs:</Text>
                      </Col>
                      <Col>
                        <Text style={{ fontSize: '12px', color: '#fa8c16' }}>
                          ${additionalCostsTotal.toFixed(2)}
                        </Text>
                      </Col>
                    </Row>
                  )}
                  
                  <Divider style={{ margin: '8px 0' }} />
                  <Row justify="space-between" style={{ marginBottom: 4 }}>
                    <Col>
                      <Text>Subtotal:</Text>
                    </Col>
                    <Col>
                      <Text>${(costBreakdown.baseCost + additionalCostsTotal).toFixed(2)}</Text>
                    </Col>
                  </Row>
                  
                  {taxEnabled && (
                    <Row justify="space-between" style={{ marginBottom: 4 }}>
                      <Col>
                        <Text style={{ fontSize: '12px' }}>Tax ({taxRate}%):</Text>
                      </Col>
                      <Col>
                        <Text style={{ fontSize: '12px' }}>
                          ${((costBreakdown.baseCost + additionalCostsTotal) * (taxRate / 100)).toFixed(2)}
                        </Text>
                      </Col>
                    </Row>
                  )}
                  
                  <Divider style={{ margin: '8px 0' }} />
                  <Row justify="space-between">
                    <Col>
                      <Text strong>Total Before Credits:</Text>
                    </Col>
                    <Col>
                      <Text strong>
                        ${((costBreakdown.baseCost + additionalCostsTotal) * (1 + (taxEnabled ? taxRate / 100 : 0))).toFixed(2)}
                      </Text>
                    </Col>
                  </Row>
                </div>
              </Col>
            </Row>
          </div>

          {/* Tax Section */}
          <div>
            <Row justify="space-between" align="middle" style={{ marginBottom: 8 }}>
              <Col>
                <Title level={5} style={{ margin: 0 }}>
                  <CalculatorOutlined style={{ marginRight: 8, color: '#722ed1' }} />
                  Tax Settings
                </Title>
              </Col>
              <Col>
                <Switch
                  checked={taxEnabled}
                  onChange={setTaxEnabled}
                  checkedChildren="Enabled"
                  unCheckedChildren="Disabled"
                />
              </Col>
            </Row>
            
            {taxEnabled && (
              <Row gutter={16} style={{ marginBottom: 8 }}>
                <Col span={12}>
                  <Text style={{ fontSize: '12px', color: '#666' }}>Tax Rate (%):</Text>
                </Col>
                <Col span={12}>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={taxRate}
                    onChange={(value) => setTaxRate(value || 0)}
                    min={0}
                    max={100}
                    precision={2}
                    size="small"
                    formatter={value => `${value}%`}
                    parser={value => value!.replace('%', '') as any}
                  />
                </Col>
              </Row>
            )}
          </div>

          {/* Credits Section */}
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              <CreditCardOutlined style={{ marginRight: 8, color: '#52c41a' }} />
              Available Credits
            </Title>
            
            {availableCredits.length > 0 ? (
              <div>
                <Space wrap style={{ marginBottom: 8 }}>
                  {availableCredits.map(credit => (
                    <Tag 
                      key={credit.id}
                      color={credit.is_active ? 'green' : 'red'}
                      style={{ fontSize: '11px' }}
                    >
                      ${credit.amount} - {credit.description}
                    </Tag>
                  ))}
                </Space>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      Total Available:
                    </Text>
                  </Col>
                  <Col>
                    <Text style={{ fontSize: '12px', color: '#52c41a' }}>
                      ${costBreakdown.availableCredits.toFixed(2)}
                    </Text>
                  </Col>
                </Row>
                <Row justify="space-between">
                  <Col>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      Credits Applied:
                    </Text>
                  </Col>
                  <Col>
                    <Text style={{ fontSize: '12px', color: '#52c41a' }}>
                      -${costBreakdown.creditsApplied.toFixed(2)}
                    </Text>
                  </Col>
                </Row>
              </div>
            ) : (
              <Alert
                message="No credits available"
                type="info"
                showIcon
                icon={<InfoCircleOutlined />}
              />
            )}
          </div>

          {/* Manual Override Section */}
          {manualOverride && (
            <div>
              <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
                Manual Cost Override
              </Title>
              <InputNumber
                style={{ width: '100%' }}
                value={overrideCost}
                onChange={handleOverrideCostChange}
                min={0}
                precision={2}
                formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                size="large"
              />
              <Text type="warning" style={{ fontSize: '11px', display: 'block', marginTop: 4 }}>
                Manual override is enabled. Auto-calculation is disabled.
              </Text>
            </div>
          )}

          {/* Final Cost */}
          <div>
            <Row 
              justify="space-between" 
              align="middle"
              style={{ 
                padding: '12px',
                background: '#f0f9ff',
                borderRadius: '6px',
                border: '1px solid #d1ecf1'
              }}
            >
              <Col>
                <Title level={4} style={{ margin: 0, color: '#1890ff' }}>
                  Final Cost:
                </Title>
              </Col>
              <Col>
                <Title level={3} style={{ margin: 0, color: '#1890ff' }}>
                  ${costBreakdown.finalCost.toFixed(2)}
                </Title>
              </Col>
            </Row>
          </div>
        </Space>
      </Spin>
    </Card>
  );
};

export default CostCalculationPanel;