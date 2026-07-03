import React from 'react';
import { Alert, Checkbox, Space, Tag, Typography } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { ConditionSuggestion, RepairCondition } from '../../types/repairSpec';

const { Text } = Typography;

interface ConditionCheckListProps {
  conditions: RepairCondition[];
  suggestions: ConditionSuggestion[];
  checkedIds: Set<string>;
  onChange: (checkedIds: Set<string>) => void;
}

const ConditionCheckList: React.FC<ConditionCheckListProps> = ({
  conditions,
  suggestions,
  checkedIds,
  onChange,
}) => {
  const toggle = (id: string) => {
    const next = new Set(checkedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(next);
  };

  // Build suggestion map: from_condition_id → to_condition names
  const suggestionMap = new Map<string, string[]>();
  for (const s of suggestions) {
    const from = s.from_condition_id;
    const toName = s.to_condition?.name || conditions.find((c) => c.id === s.to_condition_id)?.name || '';
    if (!suggestionMap.has(from)) suggestionMap.set(from, []);
    if (toName) suggestionMap.get(from)!.push(toName);
  }

  // Find active suggestions (checked conditions that suggest unchecked conditions)
  const activeSuggestions: Array<{ from: string; to: string; toId: string }> = [];
  for (const s of suggestions) {
    if (checkedIds.has(s.from_condition_id) && !checkedIds.has(s.to_condition_id)) {
      const fromName = conditions.find((c) => c.id === s.from_condition_id)?.name || '';
      const toName = s.to_condition?.name || conditions.find((c) => c.id === s.to_condition_id)?.name || '';
      activeSuggestions.push({ from: fromName, to: toName, toId: s.to_condition_id });
    }
  }

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {conditions.map((cond) => {
          const isChecked = checkedIds.has(cond.id);
          const scopeColor = cond.scope === 'affected' ? 'blue' : 'red';
          const suggests = suggestionMap.get(cond.id);

          return (
            <div key={cond.id} style={{ padding: '4px 0' }}>
              <Checkbox checked={isChecked} onChange={() => toggle(cond.id)}>
                <Space size={6}>
                  <Text strong={isChecked}>{cond.name}</Text>
                  <Tag color={scopeColor} style={{ fontSize: 11 }}>{cond.scope}</Tag>
                </Space>
              </Checkbox>
              {isChecked && suggests && suggests.length > 0 && (
                <div style={{ marginLeft: 24, marginTop: 2 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <BulbOutlined /> Suggests: {suggests.join(', ')}
                  </Text>
                </div>
              )}
            </div>
          );
        })}
      </Space>

      {activeSuggestions.length > 0 && (
        <Alert
          type="info"
          showIcon
          icon={<BulbOutlined />}
          style={{ marginTop: 12 }}
          message={
            <Space direction="vertical" size={2}>
              {activeSuggestions.map((s, i) => (
                <Text key={i} style={{ fontSize: 13 }}>
                  <strong>{s.from}</strong> recommends{' '}
                  <a onClick={() => toggle(s.toId)} style={{ cursor: 'pointer' }}>
                    {s.to}
                  </a>
                </Text>
              ))}
            </Space>
          }
        />
      )}
    </div>
  );
};

export default ConditionCheckList;
