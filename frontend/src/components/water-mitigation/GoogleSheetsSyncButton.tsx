/**
 * Google Sheets Sync Button Component
 * Allows manual synchronization with Google Sheets
 */

import React, { useState } from 'react';
import { Button, message, Modal, Tooltip } from 'antd';
import { SyncOutlined, CloudSyncOutlined } from '@ant-design/icons';
import googleSheetsService from '../../services/googleSheetsService';

interface GoogleSheetsSyncButtonProps {
  spreadsheetId?: string;
  sheetName?: string;
  onSyncComplete?: () => void;
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

      if (result.status === 'success') {
        if (showStats) {
          Modal.success({
            title: '동기화 완료',
            content: (
              <div>
                <p>Google Sheets 데이터가 성공적으로 동기화되었습니다.</p>
                <ul style={{ marginTop: 12, paddingLeft: 20 }}>
                  <li>처리된 행: {result.processed}개</li>
                  <li>새로 생성: {result.created}개</li>
                  <li>업데이트: {result.updated}개</li>
                  {result.failed > 0 && (
                    <li style={{ color: 'red' }}>실패: {result.failed}개</li>
                  )}
                </ul>
              </div>
            )
          });
        } else {
          message.success(
            `동기화 완료: ${result.processed}개 행 처리 (생성: ${result.created}, 업데이트: ${result.updated})`
          );
        }

        // Call callback if provided
        if (onSyncComplete) {
          onSyncComplete();
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
                <li style={{ color: 'red' }}>실패: {result.failed}개</li>
              </ul>
              {result.errors && result.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontWeight: 'bold' }}>오류 내역:</p>
                  <ul style={{ maxHeight: 150, overflow: 'auto', paddingLeft: 20 }}>
                    {result.errors.map((err, idx) => (
                      <li key={idx}>
                        {err.row}번 행: {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        });

        if (onSyncComplete) {
          onSyncComplete();
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
    <Tooltip title="Google Sheets의 데이터를 동기화합니다 (매 5분 자동 실행 중)">
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
