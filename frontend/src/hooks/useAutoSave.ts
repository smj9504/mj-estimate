/**
 * Auto-save Hook
 * Auto-save functionality that detects changes and saves automatically after specified delay
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { message } from 'antd';
import { EstimateLineItem } from '../services/EstimateService';
import { AutoSaveState, AutoSaveOptions, AutoSaveError } from '../types/lineItemManager';

interface UseAutoSaveOptions extends Partial<AutoSaveOptions> {
  enabled?: boolean;
}

interface UseAutoSaveReturn extends AutoSaveState {
  save: () => Promise<void>;
  markDirty: () => void;
  markClean: () => void;
  clearError: () => void;
}

export const useAutoSave = (
  items: EstimateLineItem[],
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn => {
  const {
    delay = 3000, // 3초 딜레이
    enabled = true,
    onSave,
    onError,
  } = options;

  // 상태 관리
  const [state, setState] = useState<AutoSaveState>({
    isDirty: false,
    isSaving: false,
    lastSaved: null,
    saveError: null,
  });

  // refs
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const itemsRef = useRef<EstimateLineItem[]>(items);
  const isFirstRender = useRef(true);

  // 에러 처리
  const handleError = useCallback((error: any) => {
    const autoSaveError: AutoSaveError = {
      type: 'AUTO_SAVE_ERROR',
      message: 'An error occurred during auto-save.',
      originalError: error,
    };

    setState(prev => ({
      ...prev,
      isSaving: false,
      saveError: autoSaveError.message,
    }));

    // 네트워크 오류이거나 서버 오류일 때만 사용자에게 알림
    if (error?.response?.status >= 400 || error?.code === 'NETWORK_ERROR') {
      message.error({
        content: 'Auto-save failed. Please check your network connection.',
        key: 'auto-save-error',
        duration: 5,
      });
    }

    onError?.(autoSaveError);
  }, [onError]);

  // 저장 함수
  const save = useCallback(async () => {
    if (!onSave || state.isSaving) return;

    setState(prev => ({ ...prev, isSaving: true, saveError: null }));

    try {
      await onSave(itemsRef.current);
      setState(prev => ({
        ...prev,
        isDirty: false,
        isSaving: false,
        lastSaved: new Date(),
        saveError: null,
      }));
    } catch (error) {
      handleError(error);
    }
  }, [onSave, state.isSaving, handleError]);

  // 더티 마킹
  const markDirty = useCallback(() => {
    setState(prev => ({ ...prev, isDirty: true, saveError: null }));
  }, []);

  // 클린 마킹
  const markClean = useCallback(() => {
    setState(prev => ({ ...prev, isDirty: false }));
  }, []);

  // 에러 클리어
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, saveError: null }));
  }, []);

  // items 변경 감지 및 자동 저장
  useEffect(() => {
    // 첫 렌더링은 무시
    if (isFirstRender.current) {
      isFirstRender.current = false;
      itemsRef.current = items;
      return;
    }

    // items가 변경되었는지 확인
    const hasChanged = JSON.stringify(itemsRef.current) !== JSON.stringify(items);
    if (hasChanged) {
      itemsRef.current = items;
      markDirty();

      if (enabled && onSave) {
        // 기존 타이머 취소
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // 새 타이머 설정
        timeoutRef.current = setTimeout(() => {
          save();
        }, delay);
      }
    }
  }, [items, enabled, onSave, delay, markDirty, save]);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // 브라우저 종료 시 미저장 변경사항 경고
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.isDirty) {
        const message = '저장되지 않은 변경사항이 있습니다. 정말로 페이지를 떠나시겠습니까?';
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [state.isDirty]);

  return {
    ...state,
    save,
    markDirty,
    markClean,
    clearError,
  };
};