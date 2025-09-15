import React, { useState, useEffect, useMemo } from 'react';
import { Layout as AntLayout, Menu, Avatar, Dropdown, Space, Button } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  PlusOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  ProjectOutlined,
  BarChartOutlined,
  ToolOutlined,
  DatabaseOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
} from '@ant-design/icons';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../contexts/AuthContext';
import './Layout.css';

const { Header, Sider, Content } = AntLayout;

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedCompany } = useStore();
  const { user, logout, isAdmin, isManager } = useAuth();

  // State for sidebar collapse with localStorage persistence
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('siderCollapsed');
    // On mobile devices, default to collapsed
    const isMobile = window.innerWidth <= 768;
    return saved !== null ? JSON.parse(saved) : isMobile;
  });

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Handle window resize for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      // Auto-collapse on mobile, but preserve user preference on desktop
      if (mobile && !collapsed) {
        setCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [collapsed]);

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
    const items = [
      {
        key: '/dashboard',
        icon: <DashboardOutlined />,
        label: 'Dashboard',
      },
      {
        key: '/documents',
        icon: <FileTextOutlined />,
        label: 'Documents',
        children: [
          {
            key: '/documents/estimate',
            label: 'Estimates',
          },
          {
            key: '/documents/invoice',
            label: 'Invoices',
          },
        ],
      },
      {
        key: '/work-orders',
        icon: <ProjectOutlined />,
        label: 'Work Orders',
      },
      {
        key: '/create',
        icon: <PlusOutlined />,
        label: 'Create Documents',
        children: [
          {
            key: '/create/estimate',
            label: 'Create Estimate',
          },
          {
            key: '/create/invoice',
            label: 'Create Invoice',
          },
          {
            key: '/create/insurance-estimate',
            label: 'Create Insurance Estimate',
          },
          {
            key: '/create/plumber',
            label: 'Create Plumber Report',
          },
          {
            key: '/create/work-order',
            label: 'Create Work Order',
          },
        ],
      },
    ];

    // Add admin menus only for admin users
    if (isAdmin()) {
      items.push({
        key: '/admin',
        icon: <SettingOutlined />,
        label: 'Admin',
        children: [
          {
            key: '/admin/dashboard',
            label: 'Admin Dashboard',
          },
          {
            key: '/admin/config',
            label: 'System Configuration',
          },
          {
            key: '/admin/users',
            label: 'User Management',
          },
          {
            key: '/companies',
            label: 'Company Management',
          },
        ],
      });
    } else if (isManager()) {
      // Managers can manage companies but not system settings
      items.push({
        key: '/companies',
        icon: <TeamOutlined />,
        label: 'Company Management',
      });
    }

    return items;
  }, [isAdmin, isManager]);

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Profile',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
    },
  ];

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout();
      navigate('/login');
    } else if (key === 'profile') {
      navigate('/profile');
    } else if (key === 'settings') {
      navigate('/settings');
    } else {
      navigate(key);
    }
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      {/* Mobile overlay */}
      {isMobile && !collapsed && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            zIndex: 999,
            transition: 'opacity 0.3s ease',
          }}
          onClick={toggleCollapsed}
          aria-label="Close sidebar"
        />
      )}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        collapsedWidth={isMobile ? 0 : 80}
        width={280}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          transition: 'all 0.3s ease',
          zIndex: isMobile ? 1000 : 'auto',
        }}
        trigger={null} // Disable default trigger to use custom buttons
      >
        <div className="sidebar-logo" style={{ 
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '0' : '0 16px',
          fontSize: collapsed ? '16px' : '20px',
        }}>
          {collapsed ? 'MJ' : 'MJ Estimate'}
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
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{
            border: 'none',
            height: 'calc(100vh - 64px)',
            overflowY: 'auto',
          }}
          inlineCollapsed={collapsed}
        />
      </Sider>
      <AntLayout 
        className="main-content" 
        style={{ 
          marginLeft: isMobile ? 0 : (collapsed ? 80 : 280),
          transition: 'margin-left 0.3s ease',
        }}
      >
        <Header style={{ 
          padding: '0 24px', 
          background: '#fff',
          display: 'flex',
          justifyContent: collapsed ? 'space-between' : 'space-between',
          alignItems: 'center',
          boxShadow: '0 1px 4px rgba(0,21,41,.08)',
        }}>
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
              }}
              aria-label="Expand sidebar"
            />
          )}
          <div style={{ flex: 1, paddingLeft: collapsed ? '16px' : '0' }}>
            {selectedCompany && (
              <Space>
                <span>Current Company:</span>
                <strong>{selectedCompany.name}</strong>
              </Space>
            )}
          </div>
          <Dropdown menu={{ items: userMenuItems, onClick: handleMenuClick }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user?.full_name || user?.username || 'User'}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ 
          margin: '24px', 
          minHeight: 'calc(100vh - 112px)',
          padding: '24px',
          background: '#fff',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        }}>
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
}

export default Layout;