import React, { useState } from 'react';
import { Space, Tag, Button, Input, message, Checkbox } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

interface CategoryManagerProps {
  categories: string[];
  selectedCategory: string | string[];
  onCategorySelect: (category: string | string[]) => void;
  allowCreate?: boolean;
  onCategoryCreate?: (category: string) => void;
  multiSelect?: boolean;  // Enable multi-category selection
}

const CategoryManager: React.FC<CategoryManagerProps> = ({
  categories,
  selectedCategory,
  onCategorySelect,
  allowCreate = false,
  onCategoryCreate,
  multiSelect = false
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

  const handleCategoryClick = (category: string) => {
    if (!multiSelect) {
      // Single selection mode
      onCategorySelect(category);
      return;
    }

    // Multi selection mode
    const selectedArray = Array.isArray(selectedCategory) ? selectedCategory : [selectedCategory];

    // Handle 'all' category specially
    if (category === 'all') {
      onCategorySelect('all');
      return;
    }

    // If 'all' was previously selected, start fresh with new category
    if (selectedArray.includes('all')) {
      onCategorySelect([category]);
      return;
    }

    // Toggle category selection
    if (selectedArray.includes(category)) {
      const newSelection = selectedArray.filter(c => c !== category);
      // If no categories selected, default to 'all'
      onCategorySelect(newSelection.length === 0 ? 'all' : newSelection);
    } else {
      onCategorySelect([...selectedArray, category]);
    }
  };

  const isSelected = (category: string): boolean => {
    if (Array.isArray(selectedCategory)) {
      return selectedCategory.includes(category);
    }
    return selectedCategory === category;
  };

  const getCategoryDisplayName = (category: string) => {
    switch (category) {
      case 'all':
        return 'All Files';
      case '':
        return 'Uncategorized';
      default:
        return category.charAt(0).toUpperCase() + category.slice(1);
    }
  };

  return (
    <div className="category-manager" style={{ marginTop: 12 }}>
      <Space wrap size={[8, 8]}>
        <span style={{ fontSize: '14px', fontWeight: 500, color: '#666' }}>
          Category{multiSelect ? ' (Multi-select)' : ''}:
        </span>

        {/* Category Tags */}
        {categories.map(category => {
          const selected = isSelected(category);
          return (
            <Tag
              key={category}
              color={selected ? 'blue' : 'default'}
              style={{
                cursor: 'pointer',
                borderRadius: 12,
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: selected ? 600 : 400,
                border: selected ? '2px solid #1890ff' : undefined
              }}
              onClick={() => handleCategoryClick(category)}
            >
              {multiSelect && category !== 'all' && (
                <Checkbox
                  checked={selected}
                  style={{ marginRight: 6, pointerEvents: 'none' }}
                />
              )}
              {getCategoryDisplayName(category)}
            </Tag>
          );
        })}

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