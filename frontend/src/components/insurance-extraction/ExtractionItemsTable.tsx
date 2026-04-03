import React from 'react';
import { Table } from 'antd';
import { InsuranceExtractionItem } from '../../types/insuranceExtraction';

interface ExtractionItemsTableProps {
  items: InsuranceExtractionItem[];
}

const ExtractionItemsTable: React.FC<ExtractionItemsTableProps> = ({ items }) => {
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={{ pageSize: 6 }}
      dataSource={items}
      columns={[
        { title: 'Room', dataIndex: 'room', key: 'room', width: 160 },
        { title: 'Line Item', dataIndex: 'line_item', key: 'line_item' },
        {
          title: 'Notes',
          dataIndex: 'notes',
          key: 'notes',
          width: 200,
          ellipsis: true,
          render: (v: string | null | undefined) => v || '—',
        },
        { title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 90 },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 80 },
        { title: 'Unit Price', dataIndex: 'unit_price', key: 'unit_price', width: 120 },
        { title: 'Conf.', dataIndex: 'confidence', key: 'confidence', width: 90 },
      ]}
    />
  );
};

export default ExtractionItemsTable;
