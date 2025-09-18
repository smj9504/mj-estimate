import React, { useState } from 'react';
import { Space, Tag, Button, Input, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

interface CategoryManagerProps {
  categories: string[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
  allowCreate?: boolean;
  onCategoryCreate?: (category: string) => void;
}

const CategoryManager: React.FC<CategoryManagerProps> = ({
  categories,
  selectedCategory,
  onCategorySelect,
  allowCreate = false,
  onCategoryCreate
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const handleCreateCategory = () => {
    const trimmedCategory = newCategory.trim();

    if (!trimmedCategory) {
      message.warning('Please enter a category name.');
      return;
    }

    if (categories.includes(trimmedCategory)) {
      message.warning('This category already exists.');
      return;
    }

    if (onCategoryCreate) {
      onCategoryCreate(trimmedCategory);
    }

    setNewCategory('');
    setIsCreating(false);
  };

  const handleCancelCreate = () => {
    setNewCategory('');
    setIsCreating(false);
  };

  const getCategoryDisplayName = (category: string) => {
    switch (category) {
      case 'all':
        return 'All Files';
      default:
        return category.charAt(0).toUpperCase() + category.slice(1);
    }
  };

  return (
    <div className="category-manager" style={{ marginTop: 12 }}>
      <Space wrap size={[8, 8]}>
        <span style={{ fontSize: '14px', fontWeight: 500, color: '#666' }}>Category:</span>

        {/* Category Tags */}
        {categories.map(category => (
          <Tag
            key={category}
            color={selectedCategory === category ? 'blue' : 'default'}
            style={{
              cursor: 'pointer',
              borderRadius: 12,
              padding: '4px 12px',
              fontSize: '12px'
            }}
            onClick={() => onCategorySelect(category)}
          >
            {getCategoryDisplayName(category)}
          </Tag>
        ))}

        {/* Create New Category */}
        {allowCreate && (
          <>
            {isCreating ? (
              <Space size={4}>
                <Input
                  size="small"
                  placeholder="Enter category name"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onPressEnter={handleCreateCategory}
                  style={{ width: 150 }}
                  autoFocus
                />
                <Button size="small" type="primary" onClick={handleCreateCategory}>
                  Add
                </Button>
                <Button size="small" onClick={handleCancelCreate}>
                  Cancel
                </Button>
              </Space>
            ) : (
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setIsCreating(true)}
                style={{ borderRadius: 12 }}
              >
                New Category
              </Button>
            )}
          </>
        )}
      </Space>
    </div>
  );
};

export default CategoryManager;