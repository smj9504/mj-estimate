/**
 * Google Sheets Sync Button Component
 * Allows manual synchronization with Google Sheets
 */

import React, { useState } from 'react';
import { Button, message, Modal, Tooltip } from 'antd';
import { SyncOutlined, CloudSyncOutlined } from '@ant-design/icons';
import googleSheetsService, { type SyncStats } from '../../services/googleSheetsService';

interface GoogleSheetsSyncButtonProps {
  spreadsheetId?: string;
  sheetName?: string;
  onSyncComplete?: (result: SyncStats) => void;
  type?: 'default' | 'primary' | 'text' | 'link';
  size?: 'small' | 'middle' | 'large';
  showStats?: boolean;
}

const GoogleSheetsSyncButton: React.FC<GoogleSheetsSyncButtonProps> = ({
  spreadsheetId = process.env.REACT_APP_GOOGLE_SHEETS_WATER_MITIGATION_ID || '',
  sheetName = 'Sheet1',
  onSyncComplete,
  type = 'default',
  size = 'middle',
  showStats = true
}) => {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (!spreadsheetId) {
      message.error('Google Sheets ID가 설정되지 않았습니다. 환경 변수를 확인해주세요.');
      return;
    }

    setSyncing(true);

    try {
      const result = await googleSheetsService.syncGoogleSheets({
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        sync_type: 'full'
      });

      const needsReview = result.needs_review || 0;

      if (result.status === 'success') {
        // Rows to decide open their own dialog; a second one over it would only get in the way
        if (showStats && !needsReview) {
          Modal.success({
            title: '동기화 완료',
            content: (
              <div>
                <p>Google Sheets 데이터가 성공적으로 동기화되었습니다.</p>
                <ul style={{ marginTop: 12, paddingLeft: 20 }}>
                  <li>처리된 행: {result.processed}개</li>
                  <li>새로 생성: {result.created}개</li>
                  <li>업데이트: {result.updated}개</li>
                  {(result.moved || 0) > 0 && <li>행 위치가 바뀐 job: {result.moved}개</li>}
                  {(result.off_sheet || 0) > 0 && (
                    <li>시트에서 행이 사라진 job: {result.off_sheet}개 (데이터는 유지됨)</li>
                  )}
                  {result.failed > 0 && (
                    <li style={{ color: 'red' }}>실패: {result.failed}개</li>
                  )}
                </ul>
              </div>
            )
          });
        } else {
          message.success(
            `동기화 완료: ${result.processed}개 행 처리 (생성: ${result.created}, 업데이트: ${result.updated}` +
            `${needsReview ? `, 확인 필요: ${needsReview}` : ''})`
          );
        }

        // Call callback if provided
        if (onSyncComplete) {
          onSyncComplete(result);
        }
      } else if (result.status === 'partial') {
        Modal.warning({
          title: '부분 동기화 완료',
          content: (
            <div>
              <p>일부 데이터가 동기화되었습니다.</p>
              <ul style={{ marginTop: 12, paddingLeft: 20 }}>
                <li>처리된 행: {result.processed}개</li>
                <li>성공: {result.created + result.updated}개</li>
                {needsReview > 0 && <li>확인 필요: {needsReview}개</li>}
                {(result.moved || 0) > 0 && <li>행 위치가 바뀐 job: {result.moved}개</li>}
                {(result.off_sheet || 0) > 0 && (
                  <li>시트에서 행이 사라진 job: {result.off_sheet}개 (데이터는 유지됨)</li>
                )}
                <li style={{ color: 'red' }}>실패: {result.failed}개</li>
              </ul>
              {result.errors && result.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontWeight: 'bold' }}>오류 내역:</p>
                  <ul style={{ maxHeight: 150, overflow: 'auto', paddingLeft: 20 }}>
                    {result.errors.map((err, idx) => (
                      <li key={idx}>
                        {err.row ? `${err.row}번 행` : `${err.sheet_name} 탭`}: {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        });

        if (onSyncComplete) {
          onSyncComplete(result);
        }
      } else {
        message.error('동기화 실패: ' + (result.errors?.[0]?.error || '알 수 없는 오류'));
      }
    } catch (error: any) {
      console.error('Sync error:', error);

      const errorMessage = error.response?.data?.detail || error.message || '알 수 없는 오류';

      Modal.error({
        title: '동기화 실패',
        content: (
          <div>
            <p>Google Sheets 동기화 중 오류가 발생했습니다.</p>
            <p style={{ color: 'red', marginTop: 12 }}>
              오류 메시지: {errorMessage}
            </p>
            <p style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
              • Google Sheets가 공개 설정되어 있는지 확인해주세요.<br />
              • Spreadsheet ID가 올바른지 확인해주세요.<br />
              • 백엔드 서버가 실행 중인지 확인해주세요.
            </p>
          </div>
        )
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Tooltip title="Google Sheets의 데이터를 동기화합니다 (매일 오전 8시(ET) 자동 실행)">
      <Button
        type={type}
        size={size}
        icon={<SyncOutlined spin={syncing} />}
        onClick={handleSync}
        loading={syncing}
      >
        Google Sheets 동기화
      </Button>
    </Tooltip>
  );
};

export default GoogleSheetsSyncButton;
