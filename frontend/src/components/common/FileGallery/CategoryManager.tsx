import React, { useState, useRef, useEffect } from 'react';
import { Space, Tag, Button, Input, message, Checkbox, Tooltip } from 'antd';
import { PlusOutlined, LeftOutlined, RightOutlined, FilterOutlined } from '@ant-design/icons';

interface CategoryManagerProps {
  categories: string[];
  selectedCategory: string | string[];
  onCategorySelect: (category: string | string[]) => void;
  allowCreate?: boolean;
  onCategoryCreate?: (category: string) => void;
  multiSelect?: boolean;  // Enable multi-category selection
}

// Category color mapping for visual distinction
const getCategoryColor = (category: string): string => {
  const colorMap: Record<string, string> = {
    'all': '#1890ff',
    'uncategorized': '#d9d9d9',
    'wet-area': '#13c2c2',
    'pre-mitigation-moving': '#faad14',
    'demolition': '#f5222d',
    'containment': '#722ed1',
    'protection': '#52c41a',
    'drying-process': '#2f54eb',
    'day-1': '#eb2f96',
    'day-2': '#fa8c16',
    'day-3': '#a0d911',
    'documentation': '#1890ff',
  };
  return colorMap[category] || '#1890ff';
};

// Category icon/emoji mapping
const getCategoryIcon = (category: string): string => {
  const iconMap: Record<string, string> = {
    'all': '📁',
    'uncategorized': '📋',
    'wet-area': '💧',
    'pre-mitigation-moving': '📦',
    'demolition': '🔨',
    'containment': '🛡️',
    'protection': '🔒',
    'drying-process': '🌬️',
    'day-1': '1️⃣',
    'day-2': '2️⃣',
    'day-3': '3️⃣',
    'documentation': '📄',
  };
  return iconMap[category] || '📌';
};

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll state
  const updateScrollState = () => {
    const container = scrollContainerRef.current;
    if (container) {
      const hasOverflow = container.scrollWidth > container.clientWidth;
      setShowScrollButtons(hasOverflow);
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1);
    }
  };

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [categories]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      setTimeout(updateScrollState, 300);
    }
  };

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
      case 'uncategorized':
        return 'Uncategorized';
      case 'wet-area':
        return 'Wet Area';
      case 'pre-mitigation-moving':
        return 'Pre-Mitigation';
      case 'drying-process':
        return 'Drying';
      default:
        return category.split('-').map(word =>
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
  };

  // Count selected categories for badge display
  const getSelectedCount = (): number => {
    if (Array.isArray(selectedCategory)) {
      return selectedCategory.filter(c => c !== 'all').length;
    }
    return selectedCategory === 'all' ? 0 : 1;
  };

  return (
    <div className="category-manager" style={{
      marginTop: 12,
      background: '#fafafa',
      borderRadius: '8px',
      padding: '12px 16px',
      border: '1px solid #f0f0f0'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Filter Icon and Label */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0
        }}>
          <FilterOutlined style={{ fontSize: '16px', color: '#667eea' }} />
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#333',
            whiteSpace: 'nowrap'
          }}>
            Filter
            {getSelectedCount() > 0 && (
              <span style={{
                marginLeft: '6px',
                background: '#667eea',
                color: 'white',
                borderRadius: '10px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 500
              }}>
                {getSelectedCount()}
              </span>
            )}
          </span>
        </div>

        {/* Scroll Left Button */}
        {showScrollButtons && (
          <Button
            type="text"
            size="small"
            icon={<LeftOutlined style={{}} />}
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            style={{
              opacity: canScrollLeft ? 1 : 0.3,
              flexShrink: 0
            }}
          />
        )}

        {/* Scrollable Category Container */}
        <div
          ref={scrollContainerRef}
          onScroll={updateScrollState}
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            flex: 1,
            padding: '4px 0'
          }}
        >
          {categories.map(category => {
            const selected = isSelected(category);
            const color = getCategoryColor(category);
            const icon = getCategoryIcon(category);

            return (
              <Tooltip
                key={category}
                title={multiSelect && category !== 'all' ? 'Click to toggle' : undefined}
              >
                <Tag
                  color={selected ? color : 'default'}
                  style={{
                    cursor: 'pointer',
                    borderRadius: '16px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: selected ? 600 : 400,
                    border: selected ? `2px solid ${color}` : '1px solid #d9d9d9',
                    background: selected ? `${color}15` : 'white',
                    color: selected ? color : '#595959',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                    boxShadow: selected ? `0 2px 8px ${color}25` : 'none'
                  }}
                  onClick={() => handleCategoryClick(category)}
                >
                  {multiSelect && category !== 'all' && (
                    <Checkbox
                      checked={selected}
                      style={{
                        marginRight: 0,
                        pointerEvents: 'none'
                      }}
                    />
                  )}
                  <span style={{ fontSize: '14px' }}>{icon}</span>
                  {getCategoryDisplayName(category)}
                </Tag>
              </Tooltip>
            );
          })}
        </div>

        {/* Scroll Right Button */}
        {showScrollButtons && (
          <Button
            type="text"
            size="small"
            icon={<RightOutlined style={{}} />}
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            style={{
              opacity: canScrollRight ? 1 : 0.3,
              flexShrink: 0
            }}
          />
        )}

        {/* Create New Category */}
        {allowCreate && (
          <>
            {isCreating ? (
              <Space size={4} style={{ flexShrink: 0 }}>
                <Input
                  size="small"
                  placeholder="Category name"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onPressEnter={handleCreateCategory}
                  style={{ width: 120 }}
                  autoFocus
                />
                <Button size="small" type="primary" onClick={handleCreateCategory}>
                  Add
                </Button>
                <Button size="small" onClick={handleCancelCreate}>
                  ✕
                </Button>
              </Space>
            ) : (
              <Tooltip title="Add new category">
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined style={{}} />}
                  onClick={() => setIsCreating(true)}
                  style={{
                    borderRadius: '16px',
                    flexShrink: 0,
                    borderColor: '#667eea',
                    color: '#667eea'
                  }}
                >
                  New
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {/* Hide scrollbar with CSS */}
      <style>{`
        .category-manager div::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default CategoryManager;