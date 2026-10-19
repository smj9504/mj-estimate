import React from 'react';
import { Checkbox, Col, Row, Typography } from 'antd';
import { SCREEN_GROUPS } from '../../constants/screens';

const { Text } = Typography;

interface ScreenChecklistProps {
  value: string[];
  onChange?: (screens: string[]) => void;
  disabled?: boolean;
}

// Sidebar screens grouped the way the sidebar shows them, with a
// whole-group checkbox on each heading.
const ScreenChecklist: React.FC<ScreenChecklistProps> = ({ value, onChange, disabled }) => {
  const selected = new Set(value);

  const setGroup = (keys: string[], checked: boolean) => {
    const next = new Set(selected);
    keys.forEach(key => (checked ? next.add(key) : next.delete(key)));
    onChange?.(Array.from(next));
  };

  const toggle = (key: string, checked: boolean) => setGroup([key], checked);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {SCREEN_GROUPS.map(group => {
        const keys = group.screens.map(s => s.key);
        const count = keys.filter(k => selected.has(k)).length;
        return (
          <div key={group.label}>
            <Checkbox
              checked={count === keys.length}
              indeterminate={count > 0 && count < keys.length}
              disabled={disabled}
              onChange={e => setGroup(keys, e.target.checked)}
            >
              <Text strong>{group.label}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>{count}/{keys.length}</Text>
            </Checkbox>
            <Row gutter={[8, 4]} style={{ marginTop: 6, paddingLeft: 24 }}>
              {group.screens.map(screen => (
                <Col xs={24} sm={12} key={screen.key}>
                  <Checkbox
                    checked={selected.has(screen.key)}
                    disabled={disabled}
                    onChange={e => toggle(screen.key, e.target.checked)}
                  >
                    {screen.label}
                  </Checkbox>
                </Col>
              ))}
            </Row>
          </div>
        );
      })}
    </div>
  );
};

export default ScreenChecklist;
