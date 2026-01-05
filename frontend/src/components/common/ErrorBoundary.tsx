import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Result, Button, Typography, Space } from 'antd';
import { ReloadOutlined, HomeOutlined, BugOutlined } from '@ant-design/icons';
import { logger } from '../../utils/logger';

const { Text, Paragraph } = Typography;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * React Error Boundary Component
 *
 * Catches JavaScript errors anywhere in child component tree,
 * logs them, and displays a fallback UI instead of crashing the app.
 *
 * Usage:
 * <ErrorBoundary>
 *   <SomeComponent />
 * </ErrorBoundary>
 *
 * Or with custom fallback:
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <SomeComponent />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: undefined,
    errorInfo: undefined,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details
    logger.error('ErrorBoundary caught an error:', error);
    logger.error('Component stack:', errorInfo.componentStack);

    // Update state with error info
    this.setState({ errorInfo });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Future: Send to error reporting service (Sentry, etc.)
    // Example:
    // Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleGoHome = (): void => {
    window.location.href = '/dashboard';
  };

  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
    });
  };

  public render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, showDetails = false } = this.props;

    if (hasError) {
      // Custom fallback provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      const isDevelopment = process.env.NODE_ENV === 'development';

      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            backgroundColor: '#f0f2f5',
            padding: '20px',
          }}
        >
          <Result
            status="error"
            title="Something went wrong"
            subTitle={
              <div style={{ textAlign: 'center' }}>
                <Text>We're sorry, but something unexpected happened.</Text>
                <br />
                <Text type="secondary">
                  Please try refreshing the page or go back to the home page.
                </Text>
              </div>
            }
            extra={
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space wrap>
                  <Button
                    type="primary"
                    size="large"
                    icon={<ReloadOutlined />}
                    onClick={this.handleReload}
                  >
                    Refresh Page
                  </Button>
                  <Button
                    size="large"
                    icon={<HomeOutlined />}
                    onClick={this.handleGoHome}
                  >
                    Go to Dashboard
                  </Button>
                  <Button size="large" onClick={this.handleRetry}>
                    Try Again
                  </Button>
                </Space>

                {/* Show error details in development mode or when showDetails is true */}
                {(isDevelopment || showDetails) && error && (
                  <div
                    style={{
                      marginTop: '24px',
                      padding: '16px',
                      backgroundColor: '#fff1f0',
                      borderRadius: '8px',
                      border: '1px solid #ffa39e',
                      textAlign: 'left',
                      maxWidth: '600px',
                      margin: '24px auto 0',
                    }}
                  >
                    <Space align="start">
                      <BugOutlined style={{ color: '#ff4d4f', fontSize: '16px' }} />
                      <div>
                        <Text strong style={{ color: '#cf1322' }}>
                          Error Details (Development Only)
                        </Text>
                        <Paragraph
                          code
                          copyable
                          style={{
                            marginTop: '8px',
                            marginBottom: '8px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {error.message}
                        </Paragraph>
                        {errorInfo?.componentStack && (
                          <details style={{ marginTop: '8px' }}>
                            <summary style={{ cursor: 'pointer', color: '#595959' }}>
                              Component Stack
                            </summary>
                            <pre
                              style={{
                                fontSize: '12px',
                                marginTop: '8px',
                                padding: '8px',
                                backgroundColor: '#fafafa',
                                borderRadius: '4px',
                                overflow: 'auto',
                                maxHeight: '200px',
                              }}
                            >
                              {errorInfo.componentStack}
                            </pre>
                          </details>
                        )}
                      </div>
                    </Space>
                  </div>
                )}
              </Space>
            }
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              padding: '40px',
              maxWidth: '700px',
              margin: '0 auto',
            }}
          />
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
