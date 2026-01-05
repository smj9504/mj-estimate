/**
 * useAsyncOperation - Custom hook for managing async operations with loading states
 *
 * Provides independent loading states for multiple async operations,
 * standardized error handling, and TypeScript support.
 *
 * @example
 * // Single operation
 * const { execute: save, isLoading: isSaving } = useAsyncOperation(
 *   async (data) => await api.save(data),
 *   { onSuccess: () => message.success('Saved!') }
 * );
 *
 * @example
 * // Multiple operations with useAsyncOperations
 * const { operations, isAnyLoading } = useAsyncOperations({
 *   save: {
 *     fn: async (data) => await api.save(data),
 *     onSuccess: () => message.success('Saved!')
 *   },
 *   preview: {
 *     fn: async (data) => await api.preview(data),
 *     onSuccess: (result) => openPreview(result)
 *   }
 * });
 *
 * <Button loading={operations.save.isLoading} onClick={() => operations.save.execute(data)}>
 *   Save
 * </Button>
 * <Button loading={operations.preview.isLoading} onClick={() => operations.preview.execute(data)}>
 *   Preview
 * </Button>
 */

import { useState, useCallback, useRef } from 'react';
import { message } from 'antd';

export interface AsyncOperationOptions<TData, TResult> {
  /** Called when operation succeeds */
  onSuccess?: (result: TResult, data: TData) => void;
  /** Called when operation fails */
  onError?: (error: Error, data: TData) => void;
  /** Called after operation completes (success or failure) */
  onSettled?: (data: TData, error: Error | null, result: TResult | null) => void;
  /** Default error message if error has no message */
  defaultErrorMessage?: string;
  /** Whether to show default error message via antd message */
  showErrorMessage?: boolean;
  /** Whether to show default success message via antd message */
  showSuccessMessage?: boolean;
  /** Success message to show */
  successMessage?: string;
}

export interface AsyncOperationResult<TData, TResult> {
  /** Execute the async operation */
  execute: (data: TData) => Promise<TResult | undefined>;
  /** Whether the operation is currently in progress */
  isLoading: boolean;
  /** The last error that occurred */
  error: Error | null;
  /** The last successful result */
  data: TResult | null;
  /** Reset the error and data states */
  reset: () => void;
}

/**
 * Hook for managing a single async operation with loading state
 */
export function useAsyncOperation<TData = void, TResult = void>(
  asyncFn: (data: TData) => Promise<TResult>,
  options: AsyncOperationOptions<TData, TResult> = {}
): AsyncOperationResult<TData, TResult> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);

  // Use ref to track if component is mounted
  const isMountedRef = useRef(true);

  const {
    onSuccess,
    onError,
    onSettled,
    defaultErrorMessage = 'An error occurred',
    showErrorMessage = true,
    showSuccessMessage = false,
    successMessage = 'Operation completed successfully',
  } = options;

  const execute = useCallback(
    async (inputData: TData): Promise<TResult | undefined> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await asyncFn(inputData);

        if (isMountedRef.current) {
          setData(result);

          if (showSuccessMessage && successMessage) {
            message.success(successMessage);
          }

          onSuccess?.(result, inputData);
          onSettled?.(inputData, null, result);
        }

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (isMountedRef.current) {
          setError(error);

          if (showErrorMessage) {
            message.error(error.message || defaultErrorMessage);
          }

          onError?.(error, inputData);
          onSettled?.(inputData, error, null);
        }

        return undefined;
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [asyncFn, onSuccess, onError, onSettled, defaultErrorMessage, showErrorMessage, showSuccessMessage, successMessage]
  );

  const reset = useCallback(() => {
    setError(null);
    setData(null);
  }, []);

  return {
    execute,
    isLoading,
    error,
    data,
    reset,
  };
}

// Types for useAsyncOperations
export type OperationConfig<TData, TResult> = {
  fn: (data: TData) => Promise<TResult>;
} & AsyncOperationOptions<TData, TResult>;

export type OperationsConfig = {
  [key: string]: OperationConfig<any, any>;
};

export type OperationsResult<T extends OperationsConfig> = {
  [K in keyof T]: AsyncOperationResult<
    Parameters<T[K]['fn']>[0],
    Awaited<ReturnType<T[K]['fn']>>
  >;
};

/**
 * Hook for managing multiple async operations with independent loading states
 *
 * @example
 * const { operations, isAnyLoading, isAllLoading } = useAsyncOperations({
 *   save: {
 *     fn: async (data: FormData) => await api.save(data),
 *     onSuccess: () => message.success('Saved!'),
 *     showErrorMessage: true
 *   },
 *   preview: {
 *     fn: async (id: string) => await api.preview(id),
 *     showSuccessMessage: false
 *   },
 *   delete: {
 *     fn: async (id: string) => await api.delete(id),
 *     onSuccess: () => navigate('/list'),
 *     successMessage: 'Deleted successfully'
 *   }
 * });
 */
export function useAsyncOperations<T extends OperationsConfig>(
  config: T
): {
  operations: OperationsResult<T>;
  isAnyLoading: boolean;
  isAllLoading: boolean;
  hasAnyError: boolean;
} {
  // Create individual hooks for each operation
  // We need to create states for each operation
  const [loadingStates, setLoadingStates] = useState<{ [K in keyof T]?: boolean }>({});
  const [errorStates, setErrorStates] = useState<{ [K in keyof T]?: Error | null }>({});
  const [dataStates, setDataStates] = useState<{ [K in keyof T]?: any }>({});

  const isMountedRef = useRef(true);

  const createOperation = useCallback(
    <TData, TResult>(
      key: keyof T,
      operationConfig: OperationConfig<TData, TResult>
    ): AsyncOperationResult<TData, TResult> => {
      const {
        fn,
        onSuccess,
        onError,
        onSettled,
        defaultErrorMessage = 'An error occurred',
        showErrorMessage = true,
        showSuccessMessage = false,
        successMessage = 'Operation completed successfully',
      } = operationConfig;

      const execute = async (inputData: TData): Promise<TResult | undefined> => {
        setLoadingStates(prev => ({ ...prev, [key]: true }));
        setErrorStates(prev => ({ ...prev, [key]: null }));

        try {
          const result = await fn(inputData);

          if (isMountedRef.current) {
            setDataStates(prev => ({ ...prev, [key]: result }));

            if (showSuccessMessage && successMessage) {
              message.success(successMessage);
            }

            onSuccess?.(result, inputData);
            onSettled?.(inputData, null, result);
          }

          return result;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));

          if (isMountedRef.current) {
            setErrorStates(prev => ({ ...prev, [key]: error }));

            if (showErrorMessage) {
              message.error(error.message || defaultErrorMessage);
            }

            onError?.(error, inputData);
            onSettled?.(inputData, error, null);
          }

          return undefined;
        } finally {
          if (isMountedRef.current) {
            setLoadingStates(prev => ({ ...prev, [key]: false }));
          }
        }
      };

      const reset = () => {
        setErrorStates(prev => ({ ...prev, [key]: null }));
        setDataStates(prev => ({ ...prev, [key]: null }));
      };

      return {
        execute,
        isLoading: loadingStates[key] ?? false,
        error: errorStates[key] ?? null,
        data: dataStates[key] ?? null,
        reset,
      };
    },
    [loadingStates, errorStates, dataStates]
  );

  // Build operations object
  const operations = {} as OperationsResult<T>;
  for (const key of Object.keys(config) as Array<keyof T>) {
    operations[key] = createOperation(key, config[key]);
  }

  const isAnyLoading = Object.values(loadingStates).some(Boolean);
  const isAllLoading = Object.keys(config).length > 0 && Object.values(loadingStates).every(Boolean);
  const hasAnyError = Object.values(errorStates).some(error => error !== null);

  return {
    operations,
    isAnyLoading,
    isAllLoading,
    hasAnyError,
  };
}

export default useAsyncOperation;
