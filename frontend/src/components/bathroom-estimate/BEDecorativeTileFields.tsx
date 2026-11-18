/**
 * Patterned tile on a tiled surface: border / listello and accent inserts,
 * priced on top of its field tile. Fields of the estimate form; a tub
 * surround or shower walls take border rows all the way around them, walls
 * and floor the border's LF (see decorativeTile.ts).
 */

import React from 'react';
import { Col, Form, InputNumber, Row, Typography } from 'antd';
import { borderLf, showerWallRunIn, tubSurroundRunIn } from './decorativeTile';

const { Text } = Typography;

const SPEC = {
  tub_surround: 'bathtub_spec',
  shower: 'shower_spec',
  walls: 'walls_spec',
  floor: 'floor_spec',
} as const;

interface Props {
  surface: keyof typeof SPEC;
}

const BEDecorativeTileFields: React.FC<Props> = ({ surface }) => {
  const form = Form.useFormInstance();
  const spec = SPEC[surface];
  const values = Form.useWatch(spec, { form, preserve: true });
  const runIn = surface === 'tub_surround' ? tubSurroundRunIn(values)
    : surface === 'shower' ? showerWallRunIn(values) : 0;
  const lf = runIn ? borderLf(values?.deco_border_rows, runIn) : 0;

  return (
    <Row gutter={16} align="top">
      <Col span={24}>
        <Text type="secondary" style={{ display: 'block', margin: '4px 0 6px', fontSize: 12 }}>
          Decorative tile (patterned border, inserts)
        </Text>
      </Col>
      <Col xs={12} sm={8} md={5}>
        {runIn ? (
          <Form.Item
            label="Border Rows"
            name={[spec, 'deco_border_rows']}
            tooltip="Rows of border, listello or liner, each all the way around"
            extra={lf > 0 ? `${lf} LF` : undefined}
            style={{ marginBottom: 8 }}
          >
            <InputNumber style={{ width: '100%' }} min={0} max={10} placeholder="0" addonAfter="rows" />
          </Form.Item>
        ) : (
          <Form.Item
            label="Border"
            name={[spec, 'deco_border_lf']}
            tooltip="Border, listello or liner strips, total length"
            style={{ marginBottom: 8 }}
          >
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" addonAfter="LF" />
          </Form.Item>
        )}
      </Col>
      <Col xs={12} sm={8} md={5}>
        <Form.Item
          label="Accent Inserts"
          name={[spec, 'deco_inserts']}
          tooltip="Deco pieces set into the field tile"
          style={{ marginBottom: 8 }}
        >
          <InputNumber style={{ width: '100%' }} min={0} max={200} placeholder="0" addonAfter="EA" />
        </Form.Item>
      </Col>
    </Row>
  );
};

export default BEDecorativeTileFields;
