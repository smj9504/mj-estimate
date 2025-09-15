/**
 * 네트워크 상태 감지 Hook
 * 온라인/오프라인 상태를 추적하고 관리하는 기능
 */

import { useState, useEffect } from 'react';
import { message } from 'antd';

interface NetworkStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
  connectionType: string;
}

interface UseNetworkStatusReturn extends NetworkStatus {
  retryConnection: () => Promise<boolean>;
}

export const useNetworkStatus = (): UseNetworkStatusReturn => {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    isSlowConnection: false,
    connectionType: 'unknown',
  });

  const [hasShownOfflineMessage, setHasShownOfflineMessage] = useState(false);

  // 네트워크 상태 업데이트
  const updateNetworkStatus = () => {
    const isOnline = navigator.onLine;
    
    // Connection API가 지원되는 경우 연결 정보 가져오기
    let connectionType = 'unknown';
    let isSlowConnection = false;

    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      connectionType = connection.effectiveType || connection.type || 'unknown';
      
      // 느린 연결 감지 (2G, slow-2g)
      isSlowConnection = ['slow-2g', '2g'].includes(connection.effectiveType);
    }

    setNetworkStatus({
      isOnline,
      isSlowConnection,
      connectionType,
    });

    return isOnline;
  };

  // 연결 재시도
  const retryConnection = async (): Promise<boolean> => {
    try {
      // 간단한 네트워크 테스트 (Google DNS)
      const response = await fetch('https://8.8.8.8', {
        method: 'HEAD',
        mode: 'no-cors',
        timeout: 5000,
      } as any);
      
      const isOnline = true;
      setNetworkStatus(prev => ({ ...prev, isOnline }));
      
      if (isOnline && hasShownOfflineMessage) {
        message.success({
          content: '인터넷 연결이 복구되었습니다.',
          key: 'network-status',
          duration: 3,
        });
        setHasShownOfflineMessage(false);
      }
      
      return isOnline;
    } catch (error) {
      setNetworkStatus(prev => ({ ...prev, isOnline: false }));
      return false;
    }
  };

  // 온라인 이벤트 핸들러
  const handleOnline = () => {
    updateNetworkStatus();
    
    if (hasShownOfflineMessage) {
      message.success({
        content: '인터넷 연결이 복구되었습니다.',
        key: 'network-status',
        duration: 3,
      });
      setHasShownOfflineMessage(false);
    }
  };

  // 오프라인 이벤트 핸들러
  const handleOffline = () => {
    updateNetworkStatus();
    
    if (!hasShownOfflineMessage) {
      message.warning({
        content: '인터넷 연결이 끊어졌습니다. 일부 기능이 제한될 수 있습니다.',
        key: 'network-status',
        duration: 0, // 무한 표시
      });
      setHasShownOfflineMessage(true);
    }
  };

  // 연결 타입 변경 핸들러
  const handleConnectionChange = () => {
    updateNetworkStatus();
  };

  useEffect(() => {
    // 초기 네트워크 상태 업데이트
    updateNetworkStatus();

    // 이벤트 리스너 등록
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Connection API 지원 시 연결 변경 감지
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      connection.addEventListener('change', handleConnectionChange);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        connection.removeEventListener('change', handleConnectionChange);
      };
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [hasShownOfflineMessage]);

  return {
    ...networkStatus,
    retryConnection,
  };
};