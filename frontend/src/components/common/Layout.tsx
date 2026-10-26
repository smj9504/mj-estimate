import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Layout as AntLayout, Menu, Avatar, Dropdown, Space, Button, Modal } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  BarChartOutlined,
  ToolOutlined,
  DatabaseOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  DropboxOutlined,
  CalculatorOutlined,
  RobotOutlined,
  ExperimentOutlined,
  RocketOutlined,
  FilePdfOutlined,
  AppstoreAddOutlined,
  SafetyCertificateOutlined,
  BookOutlined,
  FileImageOutlined,
  ContactsOutlined,
  BuildOutlined,
  MailOutlined,
  HomeOutlined,
  ShoppingCartOutlined,
  ColumnWidthOutlined,
  DollarOutlined,
  PlusOutlined,
  AppstoreOutlined,
  BorderOuterOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../contexts/AuthContext';
import { colors, shadows, spacing, zIndex as zIndexScale, sidebar, breakpoints } from '../../styles/tokens';
import CommandPalette from './CommandPalette';
import MessagesButton from '../messaging/MessagesButton';
import AppBreadcrumbs from './AppBreadcrumbs';
import TodoQuickAdd from '../todo/TodoQuickAdd';
import { BreadcrumbProvider } from '../../contexts/BreadcrumbContext';
import { HeaderSlotContext } from '../../contexts/HeaderSlotContext';
import './Layout.css';

const { Header, Sider, Content } = AntLayout;

interface LayoutProps {
  children: React.ReactNode;
}

// Static styles extracted to avoid re-creation on every render
const rootLayoutStyle: React.CSSProperties = { minHeight: '100vh' };

// Same edge as the max-width: 768px rules in Layout.css
const MOBILE_QUERY = `(max-width: ${breakpoints.sm}px)`;
const isMobileViewport = () => window.matchMedia(MOBILE_QUERY).matches;

const savedDesktopCollapsed = (): boolean => {
  const saved = localStorage.getItem('siderCollapsed');
  return saved !== null ? JSON.parse(saved) : false;
};
const menuStyle: React.CSSProperties = { border: 'none', height: 'calc(100vh - 52px)', overflowY: 'auto', padding: '4px 0 24px' };

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedCompany } = useStore();
  const { user, logout, isAdmin, isManager, canAccessPath } = useAuth();

  // Sidebar collapse; the desktop choice is kept in localStorage, phones always start closed
  const [collapsed, setCollapsed] = useState(() => isMobileViewport() || savedDesktopCollapsed());

  const [isMobile, setIsMobile] = useState(isMobileViewport);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const siderRef = useRef<HTMLDivElement>(null);

  // Close mobile sidebar on Escape key
  useEffect(() => {
    if (!isMobile || collapsed) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCollapsed(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, collapsed]);

  // Trap focus inside mobile sidebar when open
  useEffect(() => {
    if (!isMobile || collapsed || !siderRef.current) return;
    const sider = siderRef.current;
    const focusable = sider.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [isMobile, collapsed]);

  // Follow the viewport across the phone edge (resize, rotation, devtools).
  // A media query fires once per crossing, so a single rotation can't be lost
  // the way a debounced resize timer could when the sidebar collapsed mid-wait.
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      // Phones start closed; back on desktop the saved choice returns
      setCollapsed(e.matches || savedDesktopCollapsed());
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  // Save collapse state to localStorage (only for non-mobile)
  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem('siderCollapsed', JSON.stringify(collapsed));
    }
  }, [collapsed, isMobile]);

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
  };

  const menuItems = useMemo(() => {
    const sections = [
      // ── Todos (the home page; the old dashboard is hidden, its route kept) ──
      {
        key: '/todos',
        icon: <CheckSquareOutlined />,
        label: 'Todos',
      },

      // ── Jobs & Claims ──────────────────────────────────
      {
        key: 'jobs-claims-menu',
        icon: <SafetyCertificateOutlined />,
        label: 'Jobs & Claims',
        children: [
          {
            key: '/claims-lifecycle',
            icon: <BarChartOutlined />,
            label: 'Claims Dashboard',
          },
          {
            key: '/claim-followup',
            icon: <ContactsOutlined />,
            label: 'Follow-up',
          },
          {
            key: '/water-mitigation',
            icon: <DropboxOutlined />,
            label: 'Water Mitigation',
          },
          {
            key: '/rebuild-projects',
            icon: <BuildOutlined />,
            label: 'Rebuild Projects',
          },
          {
            key: '/clients',
            icon: <ContactsOutlined />,
            label: 'Clients',
          },
          {
            key: '/supplements',
            icon: <FileTextOutlined />,
            label: 'Supplements',
          },
        ],
      },

      // ── Estimates ──────────────────────────────────────
      {
        key: 'estimates-menu',
        icon: <CalculatorOutlined />,
        label: 'Estimates',
        children: [
          {
            key: '/reconstruction-estimate/pack-calculator-new/list',
            icon: <RocketOutlined />,
            label: 'Pack Calculator',
          },
          {
            key: '/cabinet-estimates',
            icon: <BuildOutlined />,
            label: 'Cabinet',
          },
          {
            key: '/bathroom-estimates',
            icon: <ExperimentOutlined />,
            label: 'Bathroom',
          },
          {
            key: '/roofing-estimates',
            icon: <HomeOutlined />,
            label: 'Roofing',
          },
          {
            key: '/siding-estimates',
            icon: <ColumnWidthOutlined />,
            label: 'Siding',
          },
          {
            // Shared default supplier costs per purchase unit (BD/RL/PC).
            key: '/roofing/material-prices',
            icon: <DollarOutlined />,
            label: '자재 기본 단가',
          },
          {
            // Installed rates, multipliers, tax and fees — the pricing
            // inputs that are not material cost.
            key: '/roofing/pricing-settings',
            icon: <SettingOutlined />,
            label: '견적 계산 단가',
          },
        ],
      },

      // ── Documents ──────────────────────────────────────
      {
        key: 'documents-menu',
        icon: <FilePdfOutlined />,
        label: 'Documents',
        children: [
          {
            key: '/documents/estimate',
            icon: <FileTextOutlined />,
            label: 'Estimates',
          },
          {
            key: '/documents/invoice',
            icon: <FileTextOutlined />,
            label: 'Invoices',
          },
          {
            key: '/material-orders',
            icon: <ShoppingCartOutlined />,
            label: 'Material Orders',
          },
          {
            key: '/documents/plumber_report',
            icon: <ToolOutlined />,
            label: 'Plumber Reports',
          },
          {
            key: '/documents/electrician_report',
            icon: <ToolOutlined />,
            label: 'Electrician Reports',
          },
          {
            key: '/contract-templates',
            icon: <FilePdfOutlined />,
            label: 'Contract Templates',
          },
          {
            key: '/repair-templates',
            icon: <ToolOutlined />,
            label: 'Repair Templates',
          },
          {
            key: '/repair-estimate-wizard',
            icon: <FileTextOutlined />,
            label: 'Repair Estimate',
          },
        ],
      },

      // ── Tools & Data ───────────────────────────────────
      {
        key: 'tools-data-menu',
        icon: <ToolOutlined />,
        label: 'Tools & Data',
        children: [
          {
            key: '/line-items',
            icon: <DatabaseOutlined />,
            label: 'Line Items',
          },
          {
            key: '/insurance-extractions',
            icon: <SafetyCertificateOutlined />,
            label: 'Insurance Extraction',
          },
          {
            key: '/reconstruction-estimate/material-detection',
            icon: <RobotOutlined />,
            label: 'AI Material Detection',
          },
          {
            key: '/reconstruction-estimate/debris',
            icon: <CalculatorOutlined />,
            label: 'Debris Calculator',
          },
          {
            key: '/cheat-sheet',
            icon: <BookOutlined />,
            label: 'Cheat Sheet',
          },
          {
            key: '/water-mitigation/templates',
            icon: <FilePdfOutlined />,
            label: 'WM Report Templates',
          },
          {
            key: '/water-mitigation/standard-scope-items',
            icon: <AppstoreAddOutlined />,
            label: 'WM Scope Items',
          },
          {
            key: '/tools/photo-metadata',
            icon: <FileImageOutlined />,
            label: 'Photo Metadata',
          },
          {
            key: '/tools/room-dimensions',
            icon: <BorderOuterOutlined />,
            label: 'Room Dimensions',
          },
          {
            key: '/pdf-editor',
            icon: <FilePdfOutlined />,
            label: 'PDF Editor',
          },
          {
            key: '/email-ingestion',
            icon: <MailOutlined />,
            label: 'Email Ingestion',
          },
        ],
      },
    ];

    // Only the screens this person was given; a group left empty disappears
    const items = sections
      .map(item => (item.children
        ? { ...item, children: item.children.filter(child => canAccessPath(child.key)) }
        : item))
      .filter(item => !item.children || item.children.length > 0);

    // ── Admin (admin-only) ─────────────────────────────
    if (isAdmin()) {
      items.push({
        key: '/admin',
        icon: <SettingOutlined />,
        label: 'Admin',
        children: [
          {
            key: '/admin/dashboard',
            icon: <DashboardOutlined />,
            label: 'Admin Dashboard',
          },
          {
            key: '/admin/api-usage',
            icon: <BarChartOutlined />,
            label: 'API Usage',
          },
          {
            key: '/admin/config',
            icon: <SettingOutlined />,
            label: 'System Configuration',
          },
          {
            key: '/admin/users',
            icon: <TeamOutlined />,
            label: 'User Management',
          },
          {
            key: '/companies',
            icon: <TeamOutlined />,
            label: 'Company Management',
          },
          {
            key: '/admin/materials',
            icon: <DatabaseOutlined />,
            label: 'Material Management',
          },
          {
            key: '/ml-training',
            icon: <RocketOutlined />,
            label: 'ML Training',
          },
          {
            key: '/sketch-test',
            icon: <ExperimentOutlined />,
            label: 'Sketch Test',
          },
        ],
      });
    } else if (isManager()) {
      items.push({
        key: '/companies',
        icon: <TeamOutlined />,
        label: 'Company Management',
      });
    }

    return items;
  }, [isAdmin, isManager, canAccessPath]);

  // Get the selected menu key based on current location (memoized)
  const selectedKeys = useMemo(() => {
    const { pathname } = location;

    // Check for exact matches first
    const exactMatch = menuItems.find(item => item.key === pathname);
    if (exactMatch) return [pathname];

    // Check for parent menu items with children
    for (const item of menuItems) {
      if (item.children) {
        const childMatch = item.children.find((child: any) => child.key === pathname);
        if (childMatch) return [pathname];

        // Check if current path starts with any child path
        for (const child of item.children) {
          if (pathname.startsWith(child.key)) {
            return [child.key];
          }
        }
      }

      // Check if current path starts with the menu item path
      if (pathname.startsWith(item.key) && item.key !== '/') {
        return [item.key];
      }
    }

    // No menu entry for this route (e.g. /create/estimate): highlight nothing
    // rather than pretending the user is on the dashboard
    return [];
  }, [location.pathname, menuItems]);

  // Auto-expand parent menus based on current location (only when expanded)
  useEffect(() => {
    if (collapsed) {
      setOpenKeys([]);
      return;
    }
    const { pathname } = location;
    const newOpenKeys: string[] = [];

    // Find parent menu items that should be expanded
    for (const item of menuItems) {
      if (item.children) {
        const hasActiveChild = item.children.some((child: any) =>
          pathname === child.key || pathname.startsWith(child.key)
        );
        if (hasActiveChild) {
          newOpenKeys.push(item.key);
        }
      }
    }

    setOpenKeys(newOpenKeys);
  }, [location, menuItems, collapsed]);

  // Memoize dynamic style objects to avoid re-creation on every render
  // overlay uses .mobile-overlay CSS class (includes backdrop-filter: blur)

  const siderStyle = useMemo<React.CSSProperties>(() => ({
    overflow: 'auto',
    height: '100vh',
    position: 'fixed',
    left: 0,
    top: 0,
    bottom: 0,
    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: isMobile ? zIndexScale.mobileSidebar : 'auto',
  }), [isMobile]);

  const logoStyle = useMemo<React.CSSProperties>(() => ({
    justifyContent: collapsed ? 'center' : 'space-between',
    padding: collapsed ? '0' : `0 ${spacing.sm}px 0 ${spacing.md}px`,
  }), [collapsed]);

  const headerStyle = useMemo<React.CSSProperties>(() => ({
    padding: isMobile ? `0 ${spacing.sm}px 0 ${spacing.xs}px` : `0 ${spacing.lg}px`,
    height: 52,
    lineHeight: '52px',
    background: 'rgba(255, 255, 255, 0.92)',
    backdropFilter: 'saturate(180%) blur(8px)',
    WebkitBackdropFilter: 'saturate(180%) blur(8px)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: `1px solid ${colors.neutral200}`,
    boxShadow: shadows.header,
    position: 'sticky',
    top: 0,
    zIndex: zIndexScale.header,
  }), [isMobile]);

  const contentAreaStyle = useMemo<React.CSSProperties>(() => ({
    marginLeft: isMobile ? 0 : (collapsed ? sidebar.collapsedWidth : sidebar.expandedWidth),
    transition: 'margin-left 0.2s ease',
    background: colors.surface,
  }), [isMobile, collapsed]);

  // The page is the sheet: no card around it, just gutters.
  const contentStyle = useMemo<React.CSSProperties>(() => ({
    minHeight: 'calc(100vh - 52px)',
    padding: isMobile ? `${spacing.md}px ${spacing.lg}px` : `${spacing.xl}px ${spacing.xxl + 8}px ${spacing.xxl}px`,
    background: colors.surface,
  }), [isMobile]);

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Profile',
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
    },
  ];

  const handleLogout = useCallback(() => {
    Modal.confirm({
      title: 'Log out?',
      content: 'Any unsaved changes will be lost.',
      okText: 'Log out',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => {
        logout();
        navigate('/login');
      },
    });
  }, [logout, navigate]);

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      handleLogout();
      return;
    } else if (key === 'profile') {
      navigate('/profile');
    } else {
      navigate(key);
    }
    // Auto-close sidebar on mobile after navigation
    if (isMobile) {
      setCollapsed(true);
    }
  };

  return (
    <BreadcrumbProvider>
    <HeaderSlotContext.Provider value={isMobile ? null : headerSlot}>
    <AntLayout style={rootLayoutStyle}>
      {/* Skip to main content link for keyboard users */}
      <a
        href="#main-content"
        className="skip-to-content"
      >
        Skip to main content
      </a>
      {/* Mobile overlay */}
      {isMobile && !collapsed && (
        <div
          role="presentation"
          className="mobile-overlay"
          onClick={toggleCollapsed}
        />
      )}
      <Sider
        collapsible
        collapsed={collapsed}
        collapsedWidth={isMobile ? 0 : sidebar.collapsedWidth}
        width={sidebar.expandedWidth}
        style={siderStyle}
        trigger={null}
        theme="light"
        className={`app-sider${isMobile && !collapsed ? ' app-sider--floating' : ''}`}
      >
        <div ref={siderRef}>
          <div className="sidebar-logo" style={logoStyle}>
            <span className="sidebar-workspace">
              <span className="sidebar-workspace-mark" aria-hidden="true">S</span>
              {!collapsed && <span className="sidebar-workspace-name">SimpleWorks</span>}
            </span>
            {!collapsed && (
              <Button
                type="text"
                icon={<MenuFoldOutlined />}
                onClick={toggleCollapsed}
                className="sidebar-toggle-btn"
                aria-label="Collapse sidebar"
              />
            )}
          </div>
          <nav aria-label="Main navigation">
            <Menu
              theme="light"
              mode="inline"
              selectedKeys={selectedKeys}
              openKeys={openKeys}
              onOpenChange={setOpenKeys}
              items={menuItems}
              onClick={handleMenuClick}
              style={menuStyle}
              inlineCollapsed={collapsed}
            />
          </nav>
        </div>
      </Sider>
      <AntLayout
        className="main-content"
        style={contentAreaStyle}
      >
        <Header style={headerStyle}>
          {collapsed && (
            <Button
              type="text"
              icon={<MenuUnfoldOutlined />}
              onClick={toggleCollapsed}
              className="header-toggle-btn"
              style={{
                fontSize: '16px',
                width: 40,
                height: 40,
                flexShrink: 0,
              }}
              aria-label="Expand sidebar"
            />
          )}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: collapsed ? '4px' : '0', minWidth: 0, overflow: 'hidden', fontSize: 14 }}>
            {!isMobile && <div ref={setHeaderSlot} className="header-page-slot" />}
            {selectedCompany && (
              <Space size={4} className="header-company">
                {!isMobile && <span style={{ color: colors.neutral600 }}>Company</span>}
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedCompany.name}</span>
              </Space>
            )}
          </div>
          <CommandPalette menuItems={menuItems} />
          <MessagesButton />
          <Dropdown menu={{ items: userMenuItems, onClick: handleMenuClick }} placement="bottomRight">
            <button type="button" className="header-user" aria-label="Account menu">
              <Avatar size={24} className="header-user-avatar">
                {(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}
              </Avatar>
              {!isMobile && <span>{user?.full_name || user?.username || 'User'}</span>}
            </button>
          </Dropdown>
        </Header>
        <Content id="main-content" style={contentStyle} tabIndex={-1}>
          <AppBreadcrumbs menuItems={menuItems} />
          {children}
        </Content>
      </AntLayout>

      {/* Mobile bottom navigation — thumb-friendly access to key workflows */}
      {isMobile && (
        <nav className="mobile-bottom-nav" aria-label="Quick navigation">
          <button
            className={`bottom-nav-item${location.pathname === '/todos' ? ' active' : ''}`}
            onClick={() => navigate('/todos')}
            aria-label="Todos"
            aria-current={location.pathname === '/todos' ? 'page' : undefined}
          >
            <CheckSquareOutlined />
            <span>Todos</span>
          </button>
          {canAccessPath('/claims-lifecycle') && (
          <button
            className={`bottom-nav-item${location.pathname.startsWith('/claims') || location.pathname.startsWith('/water-mitigation') ? ' active' : ''}`}
            onClick={() => navigate('/claims-lifecycle')}
            aria-label="Claims"
            aria-current={location.pathname.startsWith('/claims') ? 'page' : undefined}
          >
            <SafetyCertificateOutlined />
            <span>Claims</span>
          </button>
          )}
          <button
            className="bottom-nav-item bottom-nav-create"
            onClick={() => setQuickAddOpen(true)}
            aria-label="New todo"
          >
            <PlusOutlined />
            <span>New todo</span>
          </button>
          {canAccessPath('/documents/estimate') && (
          <button
            className={`bottom-nav-item${location.pathname.startsWith('/documents') ? ' active' : ''}`}
            onClick={() => navigate('/documents/estimate')}
            aria-label="Estimates"
            aria-current={location.pathname.startsWith('/documents/estimate') ? 'page' : undefined}
          >
            <FileTextOutlined />
            <span>Estimates</span>
          </button>
          )}
          <button
            className="bottom-nav-item"
            onClick={toggleCollapsed}
            aria-label="Open menu"
          >
            <AppstoreOutlined />
            <span>More</span>
          </button>
        </nav>
      )}
      {isMobile && <TodoQuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />}
    </AntLayout>
    </HeaderSlotContext.Provider>
    </BreadcrumbProvider>
  );
}

export default Layout;