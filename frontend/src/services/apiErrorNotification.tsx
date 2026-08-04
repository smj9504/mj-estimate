import { notification, Button } from 'antd';
import type { AxiosError, AxiosInstance } from 'axios';

// Prevent unbounded stacking if several different endpoints fail around
// the same time - newer alerts replace older ones once maxCount is hit.
notification.config({ placement: 'topRight', maxCount: 3 });

/**
 * Shows a "다시 시도" notification for a server-side error (5xx response,
 * or a network failure where no response was received at all).
 *
 * Intentionally NOT shown for 4xx errors - those are already handled by
 * each page's own try/catch + message.error(), which has the right
 * context to explain a validation/permission error to the user. This is
 * purely for "the server broke, let the user retry without being stuck".
 */
export function showRetryableErrorNotification(
  error: AxiosError,
  axiosInstance: AxiosInstance
): void {
  const config = error.config;
  if (!config) return;

  const method = (config.method || 'request').toUpperCase();
  const url = config.url || '';
  const key = `retry-${method}-${url}`;
  const isMutating = method !== 'GET';
  const responseData = error.response?.data as { request_id?: string } | undefined;
  const requestId = responseData?.request_id;

  const handleRetry = () => {
    notification.destroy(key);
    axiosInstance(config)
      .then(() => {
        notification.success({
          key,
          message: '재시도 성공',
          description: '요청이 성공적으로 처리되었습니다.',
          duration: 4,
        });
      })
      .catch(() => {
        // The response interceptor runs again for this failure and will
        // re-open the same `key` notification with fresh state - nothing
        // else to do here.
      });
  };

  notification.error({
    key,
    message: '일시적인 서버 오류가 발생했습니다',
    description: (
      <>
        <div>
          {error.response
            ? `요청을 처리하지 못했습니다 (상태 코드 ${error.response.status}).`
            : '서버에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.'}
        </div>
        {isMutating && (
          <div style={{ marginTop: 4, color: '#faad14' }}>
            다시 시도하면 동일한 요청이 중복 처리될 수 있습니다.
          </div>
        )}
        {requestId && (
          <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
            오류 코드: {String(requestId).slice(0, 8)}
          </div>
        )}
      </>
    ),
    duration: 0, // stays open until the user dismisses or retries - an actionable alert shouldn't vanish unread
    actions: (
      <Button type="primary" size="small" onClick={handleRetry}>
        다시 시도
      </Button>
    ),
  });
}
