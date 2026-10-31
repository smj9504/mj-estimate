import React, { useState, useRef, useEffect } from 'react';
import { Space, Tag, Button, Input, message, Tooltip } from 'antd';
import { PlusOutlined, LeftOutlined, RightOutlined, FilterOutlined, CheckOutlined } from '@ant-design/icons';
import { getCategoryColor, getCategoryLabel } from './categoryColors';

interface CategoryManagerProps {
  categories: string[];
  selectedCategory: string | string[];
  onCategorySelect: (category: string | string[]) => void;
  allowCreate?: boolean;
  onCategoryCreate?: (category: string) => void;
  multiSelect?: boolean;  // Enable multi-category selection
}

// Category color mapping for visual distinction

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

  // Count selected categories for badge display
  const getSelectedCount = (): number => {
    if (Array.isArray(selectedCategory)) {
      return selectedCategory.filter(c => c !== 'all').length;
    }
    return selectedCategory === 'all' ? 0 : 1;
  };

  return (
    <div className="category-manager" style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Filter Icon and Label */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0
        }}>
          <FilterOutlined style={{ fontSize: '14px', color: '#73726e' }} />
          <span className="category-manager-label" style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#5f5e5b',
            whiteSpace: 'nowrap'
          }}>
            <span className="category-manager-label-text">Filter</span>
            {getSelectedCount() > 0 && (
              <span style={{
                marginLeft: '6px',
                background: '#37352f',
                color: 'white',
                borderRadius: '4px',
                padding: '1px 6px',
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
            padding: '2px 0'
          }}
        >
          {categories.map(category => {
            const selected = isSelected(category);
            const color = getCategoryColor(category);

            return (
              // Notion view-filter chip: quiet grey until selected, then ink
              // with a check. The category colour stays as a small dot so
              // categories still read apart without a rainbow of borders.
              <Tag
                key={category}
                role="button"
                aria-pressed={selected}
                className={`ui-filter-chip${selected ? ' is-selected' : ''}`}
                onClick={() => handleCategoryClick(category)}
              >
                {category !== 'all' && (
                  <span className="ui-filter-chip-dot" style={{ background: color }} aria-hidden="true" />
                )}
                {getCategoryLabel(category)}
                {multiSelect && selected && category !== 'all' && (
                  <CheckOutlined className="ui-filter-chip-check" aria-hidden="true" />
                )}
              </Tag>
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
                    borderRadius: '6px',
                    flexShrink: 0
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