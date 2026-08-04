import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Input } from 'antd';
import {
  SearchOutlined,
  FileTextOutlined,
  PlusOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { colors } from '../../styles/tokens';
import './CommandPalette.css';

const RECENT_PAGES_KEY = 'commandPalette_recentPages';
const MAX_RECENT = 10;

interface SearchableItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  parentLabel?: string;
}

interface QuickAction {
  key: string;
  label: string;
  icon: React.ReactNode;
}

interface CommandPaletteProps {
  menuItems: any[];
}

const quickActions: QuickAction[] = [
  { key: '/create/estimate', label: 'New Estimate', icon: <PlusOutlined /> },
  { key: '/work-orders/new', label: 'New Work Order', icon: <PlusOutlined /> },
  { key: '/water-mitigation/new', label: 'New WM Job', icon: <PlusOutlined /> },
  { key: '/create/invoice', label: 'New Invoice', icon: <PlusOutlined /> },
];

function getRecentPages(): { key: string; label: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || '[]');
  } catch {
    return [];
  }
}

function addRecentPage(key: string, label: string) {
  const recent = getRecentPages().filter(p => p.key !== key);
  recent.unshift({ key, label });
  localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ menuItems }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flatten menu items into searchable list
  const searchableItems = useMemo<SearchableItem[]>(() => {
    const items: SearchableItem[] = [];
    for (const item of menuItems) {
      if (item.children) {
        for (const child of item.children) {
          items.push({
            key: child.key,
            label: child.label,
            icon: child.icon,
            parentLabel: item.label,
          });
        }
      } else if (item.key.startsWith('/')) {
        items.push({
          key: item.key,
          label: item.label,
          icon: item.icon,
        });
      }
    }
    return items;
  }, [menuItems]);

  // Filter results based on query
  const results = useMemo(() => {
    const recentPages = getRecentPages();
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      return {
        recent: recentPages.slice(0, 5),
        actions: quickActions,
        pages: [],
      };
    }

    const matchedPages = searchableItems.filter(item => {
      const searchText = `${item.label} ${item.parentLabel || ''}`.toLowerCase();
      return searchText.includes(lowerQuery);
    });

    const matchedActions = quickActions.filter(a =>
      a.label.toLowerCase().includes(lowerQuery)
    );

    const matchedRecent = recentPages.filter(p =>
      p.label.toLowerCase().includes(lowerQuery)
    ).slice(0, 3);

    return {
      recent: matchedRecent,
      actions: matchedActions,
      pages: matchedPages,
    };
  }, [query, searchableItems]);

  // Total results count for keyboard nav
  const allResults = useMemo(() => {
    const items: { key: string; label: string; type: string }[] = [];
    for (const r of results.recent) items.push({ ...r, type: 'recent' });
    for (const a of results.actions) items.push({ ...a, type: 'action' });
    for (const p of results.pages) items.push({ key: p.key, label: p.label, type: 'page' });
    return items;
  }, [results]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('.cp-item--selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleNavigate = useCallback((key: string, label: string) => {
    addRecentPage(key, label);
    setOpen(false);
    navigate(key);
  }, [navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      e.preventDefault();
      const item = allResults[selectedIndex];
      handleNavigate(item.key, item.label);
    }
  }, [allResults, selectedIndex, handleNavigate]);

  let itemIndex = -1;

  const renderItem = (key: string, label: string, icon: React.ReactNode, subtitle?: string) => {
    itemIndex++;
    const isSelected = itemIndex === selectedIndex;
    return (
      <div
        key={key}
        className={`cp-item ${isSelected ? 'cp-item--selected' : ''}`}
        onClick={() => handleNavigate(key, label)}
        onMouseEnter={() => setSelectedIndex(itemIndex)}
      >
        <span className="cp-item-icon">{icon}</span>
        <span className="cp-item-label">{label}</span>
        {subtitle && <span className="cp-item-subtitle">{subtitle}</span>}
      </div>
    );
  };

  const hasResults = allResults.length > 0;

  return (
    <>
      {/* Header trigger */}
      <div
        className="cp-trigger"
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        aria-label="Search pages (Ctrl+K)"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
      >
        <SearchOutlined />
        <span className="cp-trigger-text">Search...</span>
        <kbd className="cp-trigger-kbd">
          {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}K
        </kbd>
      </div>

      {/* Palette modal */}
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        closable={false}
        centered
        width={560}
        className="command-palette-modal"
        destroyOnHidden
      >
        <div className="cp-search">
          <SearchOutlined className="cp-search-icon" />
          <Input
            ref={inputRef}
            placeholder="Search pages, actions..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            variant="borderless"
            className="cp-search-input"
            autoComplete="off"
          />
        </div>

        <div className="cp-results" ref={listRef}>
          {!hasResults && query && (
            <div className="cp-empty">No results for "{query}"</div>
          )}

          {results.recent.length > 0 && (
            <div className="cp-group">
              <div className="cp-group-label">Recent</div>
              {results.recent.map(p =>
                renderItem(p.key, p.label, <ClockCircleOutlined />, undefined)
              )}
            </div>
          )}

          {results.actions.length > 0 && (
            <div className="cp-group">
              <div className="cp-group-label">Quick Actions</div>
              {results.actions.map(a =>
                renderItem(a.key, a.label, a.icon, undefined)
              )}
            </div>
          )}

          {results.pages.length > 0 && (
            <div className="cp-group">
              <div className="cp-group-label">Pages</div>
              {results.pages.map(p =>
                renderItem(p.key, p.label, p.icon || <FileTextOutlined />, p.parentLabel)
              )}
            </div>
          )}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </Modal>
    </>
  );
};

export default CommandPalette;
