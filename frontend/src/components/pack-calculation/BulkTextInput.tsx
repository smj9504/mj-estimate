/**
 * Bulk Text Input Component
 *
 * Large textarea for pasting item lists with intelligent parsing.
 * Supports multiple text formats for flexible data entry.
 */

import React, { useState } from 'react';
import {
  Input,
  Button,
  Alert,
  Space,
  Typography,
  Tag,
  Collapse,
  Card,
  Divider,
  Spin,
  Row,
  Col,
  Tooltip,
  Progress,
} from 'antd';
import {
  ThunderboltOutlined,
  ClearOutlined,
  QuestionCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ImportOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import { parseBulkText } from '../../services/packTemplateService';
import {
  BulkTextParseResponse,
  ParsedItem,
} from '../../types/pack-calculation';

const { TextArea } = Input;
const { Text, Title, Paragraph } = Typography;
const { Panel } = Collapse;

// ============================================================================
// Component Props
// ============================================================================

interface BulkTextInputProps {
  onImport: (items: ParsedItem[]) => void;
  maxHeight?: number;
}

// ============================================================================
// Example Text
// ============================================================================

const EXAMPLE_TEXT = `5 plates
3x coffee mugs
books x10
lamp (2)
desk chair
towels (6)
kitchen utensils x20`;

const FORMAT_GUIDE = [
  { format: '5 plates', description: 'Quantity before item name' },
  { format: '5x plates', description: 'Quantity with "x" separator' },
  { format: 'plates x5', description: 'Quantity after item name' },
  { format: 'plates (5)', description: 'Quantity in parentheses' },
  { format: 'coffee maker', description: 'No quantity (defaults to 1)' },
  { format: '3 large boxes', description: 'Size modifiers are preserved' },
  { format: '2 boxes of books', description: 'Descriptive text is parsed' },
];

// ============================================================================
// Main Component
// ============================================================================

export const BulkTextInput: React.FC<BulkTextInputProps> = ({
  onImport,
  maxHeight = 400,
}) => {
  // State management
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [parseResult, setParseResult] = useState<BulkTextParseResponse | null>(
    null
  );
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [showAllItems, setShowAllItems] = useState<boolean>(false);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle text parse request
   */
  const handleParse = async () => {
    if (!text.trim()) {
      return;
    }

    setLoading(true);
    try {
      const result = await parseBulkText({
        text: text.trim(),
        options: { strict_mode: false },
      });
      setParseResult(result);
      setShowPreview(true);
    } catch (error: any) {
      console.error('[BulkTextInput] Parse failed:', error);
      // Show error to user (could use message.error)
      setParseResult({
        items: [],
        unparsed_lines: [text],
        warnings: [error.message || 'Failed to parse text'],
        confidence: 0,
        summary: {},
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle import parsed items
   */
  const handleImport = () => {
    if (parseResult && parseResult.items.length > 0) {
      onImport(parseResult.items);
      // Reset state after successful import
      setText('');
      setParseResult(null);
      setShowPreview(false);
    }
  };

  /**
   * Handle clear/reset
   */
  const handleClear = () => {
    setText('');
    setParseResult(null);
    setShowPreview(false);
    setShowAllItems(false);
  };

  /**
   * Load example text
   */
  const handleLoadExample = () => {
    setText(EXAMPLE_TEXT);
    setParseResult(null);
    setShowPreview(false);
  };

  // ============================================================================
  // Computed Values
  // ============================================================================

  const hasText = text.trim().length > 0;
  const hasResults = parseResult !== null;
  const hasSuccessfulParse =
    hasResults && parseResult.items.length > 0;
  const hasUnparsedLines =
    hasResults && parseResult.unparsed_lines.length > 0;
  const itemsToShow = showAllItems
    ? parseResult?.items
    : parseResult?.items.slice(0, 10);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Help Section */}
      <Collapse
        ghost
        items={[
          {
            key: 'help',
            label: (
              <Space>
                <QuestionCircleOutlined />
                <Text strong>Supported Formats</Text>
              </Space>
            ),
            children: (
              <Card size="small" style={{ backgroundColor: '#fafafa' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Paragraph>
                    <Text strong>The parser supports multiple formats:</Text>
                  </Paragraph>
                  {FORMAT_GUIDE.map((item, index) => (
                    <Row key={index} gutter={16}>
                      <Col span={8}>
                        <Tag color="blue">{item.format}</Tag>
                      </Col>
                      <Col span={16}>
                        <Text type="secondary">{item.description}</Text>
                      </Col>
                    </Row>
                  ))}
                  <Divider style={{ margin: '12px 0' }} />
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    <Text strong>Tips:</Text> One item per line. Empty lines
                    are ignored. The AI will intelligently categorize items.
                  </Paragraph>
                </Space>
              </Card>
            ),
          },
        ]}
      />

      <Divider />

      {/* Text Input Section */}
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <div>
          <Space style={{ marginBottom: 8 }}>
            <Title level={5} style={{ margin: 0 }}>
              Paste Your Item List
            </Title>
            <Tooltip title="Load example text">
              <Button type="link" size="small" onClick={handleLoadExample}>
                Load Example
              </Button>
            </Tooltip>
          </Space>

          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Enter items to pack (one per line):\n\n${EXAMPLE_TEXT}`}
            rows={10}
            maxLength={5000}
            showCount
            style={{ fontFamily: 'monospace' }}
            disabled={loading}
          />

          <Space style={{ marginTop: 12 }}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleParse}
              loading={loading}
              disabled={!hasText}
            >
              Parse Items
            </Button>
            <Button
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={!hasText && !hasResults}
            >
              Clear
            </Button>
          </Space>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <Card>
            <Space direction="vertical" align="center" style={{ width: '100%' }}>
              <Spin size="large" />
              <Text type="secondary">Analyzing text and categorizing items...</Text>
            </Space>
          </Card>
        )}

        {/* Parse Results */}
        {!loading && hasResults && (
          <>
            {/* Success Summary */}
            {hasSuccessfulParse && (
              <Alert
                type="success"
                icon={<CheckCircleOutlined />}
                message={
                  <Space>
                    <Text strong>
                      Successfully parsed {parseResult.items.length} item
                      {parseResult.items.length !== 1 ? 's' : ''}
                    </Text>
                    <Tag color="green">
                      {Math.round(parseResult.confidence)}% Confidence
                    </Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Progress
                      percent={Math.round(parseResult.confidence)}
                      status={
                        parseResult.confidence >= 80
                          ? 'success'
                          : parseResult.confidence >= 60
                          ? 'normal'
                          : 'exception'
                      }
                      showInfo={false}
                    />
                    <Space wrap>
                      <Text type="secondary">Total items:</Text>
                      {Object.entries(parseResult.summary).map(
                        ([category, count]) => (
                          <Tag key={category}>
                            {category}: {count}
                          </Tag>
                        )
                      )}
                    </Space>
                  </Space>
                }
                style={{ marginBottom: 16 }}
              />
            )}

            {/* Unparsed Lines Warning */}
            {hasUnparsedLines && (
              <Alert
                type="warning"
                icon={<WarningOutlined />}
                message={
                  <Text strong>
                    {parseResult.unparsed_lines.length} line
                    {parseResult.unparsed_lines.length !== 1 ? 's' : ''} could
                    not be parsed
                  </Text>
                }
                description={
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Text type="secondary">
                      The following lines were not understood:
                    </Text>
                    <div
                      style={{
                        maxHeight: 150,
                        overflow: 'auto',
                        backgroundColor: '#fff',
                        padding: 8,
                        borderRadius: 4,
                        border: '1px solid #d9d9d9',
                      }}
                    >
                      {parseResult.unparsed_lines.map((line, index) => (
                        <div key={index} style={{ fontFamily: 'monospace' }}>
                          {line}
                        </div>
                      ))}
                    </div>
                    <Text type="secondary" italic>
                      Tip: Try rephrasing these lines or add quantity numbers.
                    </Text>
                  </Space>
                }
                style={{ marginBottom: 16 }}
              />
            )}

            {/* Warnings */}
            {parseResult.warnings.length > 0 && (
              <Alert
                type="info"
                message="Parsing Warnings"
                description={
                  <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                    {parseResult.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                }
                style={{ marginBottom: 16 }}
              />
            )}

            {/* Parsed Items Preview */}
            {hasSuccessfulParse && (
              <Card
                title={
                  <Space>
                    <Text strong>Parsed Items Preview</Text>
                    <Tag color="blue">{parseResult.items.length} items</Tag>
                  </Space>
                }
                extra={
                  parseResult.items.length > 10 && (
                    <Button
                      type="link"
                      size="small"
                      icon={
                        showAllItems ? (
                          <EyeInvisibleOutlined />
                        ) : (
                          <EyeOutlined />
                        )
                      }
                      onClick={() => setShowAllItems(!showAllItems)}
                    >
                      {showAllItems ? 'Show Less' : 'Show All'}
                    </Button>
                  )
                }
                style={{ marginBottom: 16 }}
              >
                <Space
                  direction="vertical"
                  style={{ width: '100%' }}
                  size="small"
                >
                  {itemsToShow?.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '8px 12px',
                        backgroundColor: '#fafafa',
                        borderRadius: 4,
                        border: '1px solid #d9d9d9',
                      }}
                    >
                      <Row gutter={16} align="middle">
                        <Col flex="auto">
                          <Space>
                            <Text strong>
                              {item.quantity} ×
                            </Text>
                            <Text>{item.subcategory || item.category}</Text>
                            <Tag color="blue">{item.category}</Tag>
                            <Tag>Pack: {item.pack_size}</Tag>
                          </Space>
                        </Col>
                        <Col>
                          <Tooltip title="Confidence score">
                            <Tag
                              color={
                                item.confidence >= 0.8
                                  ? 'green'
                                  : item.confidence >= 0.6
                                  ? 'orange'
                                  : 'red'
                              }
                            >
                              {Math.round(item.confidence * 100)}%
                            </Tag>
                          </Tooltip>
                        </Col>
                      </Row>
                      <Text
                        type="secondary"
                        italic
                        style={{ fontSize: '0.85em' }}
                      >
                        "{item.original_text}"
                      </Text>
                    </div>
                  ))}

                  {!showAllItems && parseResult.items.length > 10 && (
                    <Text type="secondary" style={{ textAlign: 'center' }}>
                      ... and {parseResult.items.length - 10} more items
                    </Text>
                  )}
                </Space>
              </Card>
            )}

            {/* Import Button */}
            {hasSuccessfulParse && (
              <Space style={{ width: '100%', justifyContent: 'center' }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<ImportOutlined />}
                  onClick={handleImport}
                >
                  Import {parseResult.items.length} Item
                  {parseResult.items.length !== 1 ? 's' : ''} to Calculation
                </Button>
              </Space>
            )}
          </>
        )}
      </Space>
    </div>
  );
};

export default BulkTextInput;
