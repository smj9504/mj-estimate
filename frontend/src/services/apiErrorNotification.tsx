import { notification, Button } from 'antd';
import type { AxiosError, AxiosInstance } from 'axios';

// Prevent unbounded stacking if several different endpoints fail around
// the same time - newer alerts replace older ones once maxCount is hit.
notification.config({ placement: 'topRight', maxCount: 3 });

// When the backend goes down (e.g. Render cold start / crash), a single
// page can fire several parallel requests that all fail within the same
// instant - each with a different URL, so the per-key dedupe above doesn't
// help. Suppress additional alerts for a short window after the first one,
// since "the server is down" only needs to be communicated once; the user
// doesn't need one retry prompt per failed request.
const SUPPRESS_WINDOW_MS = 4000;
let lastAlertShownAt = 0;

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
  axiosInstance: AxiosInstance,
  isRetry: boolean = false
): void {
  const config = error.config;
  if (!config) return;

  const now = Date.now();
  if (!isRetry && now - lastAlertShownAt < SUPPRESS_WINDOW_MS) {
    return;
  }
  lastAlertShownAt = now;

  const method = (config.method || 'request').toUpperCase();
  const url = config.url || '';
  const key = `retry-${method}-${url}`;
  const isMutating = method !== 'GET';
  const responseData = error.response?.data as { request_id?: string } | undefined;
  const requestId = responseData?.request_id;

  const handleRetry = () => {
    notification.destroy(key);
    // Mark this specific request as a user-initiated retry so the response
    // interceptor skips its own (possibly-suppressed) call and defers to
    // the explicit one below - avoids double-invoking for the same failure.
    axiosInstance({ ...config, suppressErrorNotification: true })
      .then(() => {
        notification.success({
          key,
          message: '재시도 성공',
          description: '요청이 성공적으로 처리되었습니다.',
          duration: 4,
        });
      })
      .catch((retryError) => {
        // Force this through regardless of the suppress window - a user
        // who explicitly clicked "다시 시도" should always get feedback.
        showRetryableErrorNotification(retryError, axiosInstance, true);
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
