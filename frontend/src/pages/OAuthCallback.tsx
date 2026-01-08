import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Result, Typography, Space } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import authService from '../services/authService';

const { Text } = Typography;

/**
 * OAuth Callback Page
 *
 * This page handles the OAuth 2.0 callback from Google.
 * It can work in two modes:
 * 1. Popup mode: Sends result back to parent window and closes
 * 2. Redirect mode: Processes callback and redirects to profile
 */
const OAuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    const processCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      // Handle error from Google
      if (error) {
        setStatus('error');
        setMessage(`Authentication failed: ${error}`);

        // If in popup, notify parent and close
        if (window.opener) {
          window.opener.postMessage({
            type: 'google-oauth-callback',
            error: error,
          }, window.location.origin);
          setTimeout(() => window.close(), 2000);
        }
        return;
      }

      // Check for authorization code
      if (!code) {
        setStatus('error');
        setMessage('No authorization code received');
        return;
      }

      // If in popup mode, send message to parent and close
      if (window.opener) {
        window.opener.postMessage({
          type: 'google-oauth-callback',
          code: code,
          state: state,
        }, window.location.origin);

        setStatus('success');
        setMessage('Authentication successful! This window will close...');
        setTimeout(() => window.close(), 1500);
        return;
      }

      // If not in popup, process directly (fallback mode)
      if (!user?.id) {
        setStatus('error');
        setMessage('User not logged in. Please log in and try again.');
        return;
      }

      try {
        const result = await authService.completeGoogleOAuth(user.id, code, state || undefined);

        if (result.success) {
          setStatus('success');
          setMessage(`Connected to Google Drive as ${result.email}`);
          setTimeout(() => navigate('/profile'), 2000);
        } else {
          setStatus('error');
          setMessage(result.message || 'Failed to complete authentication');
        }
      } catch (err: any) {
        setStatus('error');
        setMessage(err.response?.data?.detail || 'Failed to process authentication');
      }
    };

    processCallback();
  }, [searchParams, user, navigate]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: '#f0f2f5',
    }}>
      {status === 'loading' && (
        <Space direction="vertical" align="center">
          <Spin size="large" />
          <Text>{message}</Text>
        </Space>
      )}

      {status === 'success' && (
        <Result
          icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
          title="Success!"
          subTitle={message}
        />
      )}

      {status === 'error' && (
        <Result
          icon={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
          status="error"
          title="Authentication Failed"
          subTitle={message}
          extra={
            !window.opener && (
              <a href="/profile">Return to Profile</a>
            )
          }
        />
      )}
    </div>
  );
};

export default OAuthCallback;
