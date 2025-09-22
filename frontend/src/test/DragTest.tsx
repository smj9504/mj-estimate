import React, { useState } from 'react';
import DraggableTable from '../components/common/DraggableTable';

const DragTest: React.FC = () => {
  const [items, setItems] = useState([
    { key: 'item1', item: 'Test Item 1', quantity: 1, total: 100 },
    { key: 'item2', item: 'Test Item 2', quantity: 2, total: 200 },
    { key: 'item3', item: 'Test Item 3', quantity: 3, total: 300 },
  ]);

  const handleReorder = (newItems: any[]) => {
    console.log('Reordering items:', newItems);
    setItems(newItems);
  };

  const columns = [
    {
      title: 'Item',
      dataIndex: 'item',
      key: 'item',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      render: (value: number) => `$${value}`,
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      <h2>DragTable Test</h2>
      <DraggableTable
        dataSource={items}
        columns={columns}
        onReorder={handleReorder}
        showDragHandle={true}
        dragHandlePosition="start"
        pagination={false}
      />
    </div>
  );
};

export default DragTest;