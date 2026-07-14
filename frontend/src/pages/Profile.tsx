import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Form, Input, Button, Typography, Space, Alert, Divider,
  Row, Col, message, Modal, Switch, Spin, Tag, List, Breadcrumb
} from 'antd';
import {
  UserOutlined, MailOutlined, PhoneOutlined, LockOutlined,
  SaveOutlined, GoogleOutlined, FolderOutlined,
  CheckCircleOutlined, CloseCircleOutlined, CloudUploadOutlined,
  DisconnectOutlined, LinkOutlined, FolderAddOutlined,
  ArrowLeftOutlined, HomeOutlined
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import authService from '../services/authService';

const { Title, Text } = Typography;

interface OAuthStatus {
  connected: boolean;
  auth_type: 'oauth' | 'service_account' | 'none';
  email: string | null;
  gdrive_enabled: boolean;
  gdrive_root_folder_id: string | null;
}

interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

interface FolderPath {
  id: string;
  name: string;
}

const Profile: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google OAuth state
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [connectingOAuth, setConnectingOAuth] = useState(false);

  // Folder browser state
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState('root');
  const [folderPath, setFolderPath] = useState<FolderPath[]>([{ id: 'root', name: 'My Drive' }]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    if (user) {
      form.setFieldsValue({
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone || '',
        mobile_phone: user.mobile_phone || '',
      });

      // Load OAuth status
      loadOAuthStatus();
    }
  }, [user, form]);

  // Handle OAuth callback from popup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'google-oauth-callback' && event.data?.code) {
        await handleOAuthCallback(event.data.code, event.data.state);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user]);

  const loadOAuthStatus = async () => {
    if (!user?.id) return;

    setOauthLoading(true);
    try {
      const status = await authService.getGoogleOAuthStatus(user.id);
      setOauthStatus(status);
    } catch (err: any) {
      console.error('Failed to load OAuth status:', err);
    } finally {
      setOauthLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
    if (!user?.id) return;

    setConnectingOAuth(true);
    try {
      const { authorization_url } = await authService.initGoogleOAuth(user.id);

      // Open OAuth popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authorization_url,
        'google-oauth',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      );

      // Poll for popup close
      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          setConnectingOAuth(false);
          loadOAuthStatus();
        }
      }, 500);

    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to start Google authentication';
      message.error(errorMsg);
      setConnectingOAuth(false);
    }
  };

  const handleOAuthCallback = async (code: string, state?: string) => {
    if (!user?.id) return;

    setConnectingOAuth(true);
    try {
      const result = await authService.completeGoogleOAuth(user.id, code, state);
      if (result.success) {
        message.success(`Connected to Google Drive as ${result.email || 'user'}`);
        loadOAuthStatus();
      } else {
        message.error(result.message);
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to complete authentication';
      message.error(errorMsg);
    } finally {
      setConnectingOAuth(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!user?.id) return;

    Modal.confirm({
      title: 'Disconnect Google Drive?',
      content: 'This will remove your Google Drive connection. You will need to reconnect to export photos.',
      okText: 'Disconnect',
      okType: 'danger',
      onOk: async () => {
        setOauthLoading(true);
        try {
          await authService.disconnectGoogleOAuth(user.id);
          message.success('Disconnected from Google Drive');
          loadOAuthStatus();
        } catch (err: any) {
          const errorMsg = err.response?.data?.detail || 'Failed to disconnect';
          message.error(errorMsg);
        } finally {
          setOauthLoading(false);
        }
      },
    });
  };

  const loadFolders = useCallback(async (parentId: string = 'root') => {
    if (!user?.id) return;

    setFoldersLoading(true);
    try {
      const result = await authService.listGoogleDriveFolders(user.id, parentId);
      setFolders(result.folders);
      setCurrentFolderId(parentId);
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to load folders';
      message.error(errorMsg);
    } finally {
      setFoldersLoading(false);
    }
  }, [user?.id]);

  const handleOpenFolderBrowser = () => {
    setFolderBrowserOpen(true);
    setFolderPath([{ id: 'root', name: 'My Drive' }]);
    setSelectedFolderId(null);
    loadFolders('root');
  };

  const handleFolderClick = (folder: DriveFolder) => {
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedFolderId(null);
    loadFolders(folder.id);
  };

  const handleBreadcrumbClick = (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setSelectedFolderId(null);
    loadFolders(newPath[newPath.length - 1].id);
  };

  const handleSelectFolder = async () => {
    if (!user?.id) return;

    const folderId = selectedFolderId || currentFolderId;

    setOauthLoading(true);
    try {
      const result = await authService.selectGoogleDriveFolder(user.id, folderId);
      message.success(result.message);
      setFolderBrowserOpen(false);
      loadOAuthStatus();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to select folder';
      message.error(errorMsg);
    } finally {
      setOauthLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!user?.id || !newFolderName.trim()) return;

    setCreatingFolder(true);
    try {
      const newFolder = await authService.createGoogleDriveFolder(
        user.id,
        newFolderName.trim(),
        currentFolderId
      );
      message.success(`Created folder "${newFolder.name}"`);
      setNewFolderName('');
      loadFolders(currentFolderId);
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to create folder';
      message.error(errorMsg);
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleUpdateProfile = async (values: any) => {
    setLoading(true);
    setError(null);

    try {
      const updatedUser = await authService.updateCurrentUser({
        email: values.email,
        first_name: values.first_name,
        last_name: values.last_name,
        phone: values.phone,
        mobile_phone: values.mobile_phone,
      });

      // Update localStorage so AuthContext picks up changes on reload
      const storedUser = localStorage.getItem('auth_user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        const merged = { ...parsed, ...updatedUser };
        localStorage.setItem('auth_user', JSON.stringify(merged));
      }

      message.success('Profile updated successfully');
      window.location.reload();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to update profile';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (values: any) => {
    setLoading(true);
    setError(null);

    try {
      await authService.changePassword(
        values.current_password,
        values.new_password
      );

      message.success('Password changed successfully');
      setPasswordModalVisible(false);
      passwordForm.resetFields();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to change password';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert
          message="Not Logged In"
          description="Please log in to view your profile"
          type="warning"
          showIcon
        />
      </div>
    );
  }

  const isConnected = oauthStatus?.connected && oauthStatus?.auth_type === 'oauth';

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={2}>My Profile</Title>
          <Text type="secondary">Manage your account information</Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            closable
            onClose={() => setError(null)}
          />
        )}

        {/* Account Information Card */}
        <Card title="Account Information">
          <Row gutter={16}>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Username</Text>
                <Text>{user.username}</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Staff Number</Text>
                <Text>{user.staff_number || 'N/A'}</Text>
              </Space>
            </Col>
          </Row>

          <Divider />

          <Row gutter={16}>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Role</Text>
                <Text>{user.role.replace(/_/g, ' ').toUpperCase()}</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Account Status</Text>
                <Text type={user.is_active ? 'success' : 'danger'}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Text>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Personal Information Form */}
        <Card title="Personal Information">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleUpdateProfile}
            requiredMark={false}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="first_name"
                  label="First Name"
                  rules={[{ required: true, message: 'Please enter your first name' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="First Name" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="last_name"
                  label="Last Name"
                  rules={[{ required: true, message: 'Please enter your last name' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="Last Name" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: 'Please enter your email' },
                { type: 'email', message: 'Please enter a valid email' }
              ]}
            >
              <Input prefix={<MailOutlined />} placeholder="Email" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="phone" label="Phone Number">
                  <Input prefix={<PhoneOutlined />} placeholder="Phone" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="mobile_phone" label="Mobile Phone">
                  <Input prefix={<PhoneOutlined />} placeholder="Mobile" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={loading}
                >
                  Save Changes
                </Button>
                <Button onClick={() => form.resetFields()}>Reset</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        {/* Security Section */}
        <Card title="Security">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>
              Keep your account secure by using a strong password and changing it regularly.
            </Text>
            <Button
              icon={<LockOutlined />}
              onClick={() => setPasswordModalVisible(true)}
            >
              Change Password
            </Button>
          </Space>
        </Card>

        {/* Google Drive Integration Section - OAuth Based */}
        <Card
          title={
            <Space>
              <GoogleOutlined style={{ color: '#4285F4' }} />
              <span>Google Drive Integration</span>
              {isConnected && (
                <Tag color="success" icon={<CheckCircleOutlined />}>
                  Connected
                </Tag>
              )}
            </Space>
          }
        >
          {oauthLoading && !oauthStatus ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin tip="Loading..." />
            </div>
          ) : (
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Alert
                message="Export CompanyCam Photos to Google Drive"
                description="Connect your Google account to export photos from Water Mitigation jobs directly to your Google Drive."
                type="info"
                showIcon
                icon={<CloudUploadOutlined />}
              />

              {!isConnected ? (
                // Not connected - show connect button
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <Button
                    type="primary"
                    size="large"
                    icon={<GoogleOutlined />}
                    onClick={handleConnectGoogle}
                    loading={connectingOAuth}
                    style={{
                      backgroundColor: '#4285F4',
                      borderColor: '#4285F4',
                      height: '48px',
                      fontSize: '16px'
                    }}
                  >
                    Connect with Google
                  </Button>
                  <div style={{ marginTop: '12px' }}>
                    <Text type="secondary">
                      Click to sign in with your Google account
                    </Text>
                  </div>
                </div>
              ) : (
                // Connected - show status and folder selection
                <>
                  <Card size="small" style={{ backgroundColor: '#f6ffed', border: '1px solid #b7eb8f' }}>
                    <Row gutter={16} align="middle">
                      <Col span={16}>
                        <Space direction="vertical" size="small">
                          <Text strong>
                            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                            Connected as {oauthStatus?.email}
                          </Text>
                          {oauthStatus?.gdrive_root_folder_id && (
                            <Text type="secondary">
                              <FolderOutlined style={{ marginRight: 4 }} />
                              Export folder selected
                            </Text>
                          )}
                        </Space>
                      </Col>
                      <Col span={8} style={{ textAlign: 'right' }}>
                        <Button
                          danger
                          icon={<DisconnectOutlined />}
                          onClick={handleDisconnectGoogle}
                        >
                          Disconnect
                        </Button>
                      </Col>
                    </Row>
                  </Card>

                  <Divider>Export Folder</Divider>

                  <Space direction="vertical" style={{ width: '100%' }}>
                    {oauthStatus?.gdrive_root_folder_id ? (
                      <Alert
                        message="Export folder is configured"
                        description="Photos will be exported to the selected Google Drive folder."
                        type="success"
                        showIcon
                      />
                    ) : (
                      <Alert
                        message="Select an export folder"
                        description="Choose a Google Drive folder where photos will be exported."
                        type="warning"
                        showIcon
                      />
                    )}

                    <Button
                      type={oauthStatus?.gdrive_root_folder_id ? 'default' : 'primary'}
                      icon={<FolderOutlined />}
                      onClick={handleOpenFolderBrowser}
                    >
                      {oauthStatus?.gdrive_root_folder_id ? 'Change Folder' : 'Select Folder'}
                    </Button>
                  </Space>
                </>
              )}
            </Space>
          )}
        </Card>
      </Space>

      {/* Change Password Modal */}
      <Modal
        title="Change Password"
        open={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false);
          passwordForm.resetFields();
          setError(null);
        }}
        footer={null}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
          requiredMark={false}
        >
          <Form.Item
            name="current_password"
            label="Current Password"
            rules={[{ required: true, message: 'Please enter your current password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Current Password" />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter a new password' },
              { min: 6, message: 'Password must be at least 6 characters' }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="New Password" />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="Confirm New Password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: 'Please confirm your new password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Confirm New Password" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                Change Password
              </Button>
              <Button onClick={() => {
                setPasswordModalVisible(false);
                passwordForm.resetFields();
              }}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Folder Browser Modal */}
      <Modal
        title="Select Google Drive Folder"
        open={folderBrowserOpen}
        onCancel={() => setFolderBrowserOpen(false)}
        width={600}
        footer={[
          <Button key="cancel" onClick={() => setFolderBrowserOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="select"
            type="primary"
            onClick={handleSelectFolder}
            loading={oauthLoading}
            icon={<CheckCircleOutlined />}
          >
            {selectedFolderId ? 'Select This Folder' : 'Use Current Folder'}
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {/* Breadcrumb Navigation */}
          <Breadcrumb
            items={folderPath.map((item, index) => ({
              title: (
                <a onClick={() => handleBreadcrumbClick(index)}>
                  {index === 0 ? <HomeOutlined /> : null} {item.name}
                </a>
              ),
            }))}
          />

          {/* Create New Folder */}
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onPressEnter={handleCreateFolder}
              style={{ width: 'calc(100% - 120px)' }}
            />
            <Button
              type="primary"
              icon={<FolderAddOutlined />}
              onClick={handleCreateFolder}
              loading={creatingFolder}
              disabled={!newFolderName.trim()}
            >
              Create
            </Button>
          </Space.Compact>

          {/* Folder List */}
          {foldersLoading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin tip="Loading folders..." />
            </div>
          ) : (
            <List
              bordered
              dataSource={folders}
              locale={{ emptyText: 'No folders in this location' }}
              style={{ maxHeight: '300px', overflow: 'auto' }}
              renderItem={(folder) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    backgroundColor: selectedFolderId === folder.id ? '#e6f7ff' : undefined,
                  }}
                  onClick={() => setSelectedFolderId(folder.id === selectedFolderId ? null : folder.id)}
                  onDoubleClick={() => handleFolderClick(folder)}
                  actions={[
                    <Button
                      type="link"
                      icon={<LinkOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFolderClick(folder);
                      }}
                    >
                      Open
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<FolderOutlined style={{ fontSize: '24px', color: '#faad14' }} />}
                    title={folder.name}
                    description={selectedFolderId === folder.id ? 'Click "Select This Folder" to choose' : 'Double-click to open'}
                  />
                </List.Item>
              )}
            />
          )}

          <Text type="secondary">
            Tip: Double-click a folder to navigate inside, or single-click to select it for export.
          </Text>
        </Space>
      </Modal>
    </div>
  );
};

export default Profile;
