/**
 * Adjusters 2 and 3 on a claim or WM job form. A carrier sometimes hands the
 * claim to a third-party firm; the first adjuster keeps its own fields.
 * Sits inside the form and edits its additional_adjusters list.
 */

import React from 'react';
import { Button, Col, Form, Input, Row, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { MAX_ADDITIONAL_ADJUSTERS } from '../../types/client';

const AdditionalAdjustersFields: React.FC = () => (
  <Form.List name="additional_adjusters">
    {(fields, { add, remove }) => (
      <>
        {fields.map(({ key, name }, index) => (
          <div key={key}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Typography.Text type="secondary">Adjuster {index + 2}</Typography.Text>
              <Button
                type="text"
                size="small"
                danger
                icon={<MinusCircleOutlined />}
                onClick={() => remove(name)}
              >
                Remove
              </Button>
            </div>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name={[name, 'company']} label="Company"
                  tooltip="The adjusting firm, when it isn't the insurance company">
                  <Input placeholder="e.g. third-party firm" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={[name, 'name']} label="Name">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={[name, 'phone']} label="Phone">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name={[name, 'email']} label="Email"
                  rules={[{ type: 'email', message: 'Invalid email' }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </div>
        ))}
        {fields.length < MAX_ADDITIONAL_ADJUSTERS && (
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => add({ company: '', name: '', phone: '', email: '' })}
            style={{ marginBottom: 16 }}
          >
            Add adjuster
          </Button>
        )}
      </>
    )}
  </Form.List>
);

export default AdditionalAdjustersFields;
