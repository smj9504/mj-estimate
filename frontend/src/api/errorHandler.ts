import { AxiosError } from 'axios';

/**
 * Extract error message from various error types
 * Provides consistent error message handling across the application
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof AxiosError) {
    return error.response?.data?.detail || 
           error.response?.data?.message || 
           error.message || 
           'An error occurred';
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'An unknown error occurred';
};

/**
 * Check if error is an AxiosError
 */
export const isAxiosError = (error: unknown): error is AxiosError => {
  return error instanceof AxiosError;
};

/**
 * Get HTTP status code from error
 */
export const getErrorStatus = (error: unknown): number | undefined => {
  if (error instanceof AxiosError) {
    return error.response?.status;
  }
  return undefined;
};

/**
 * Get detailed error information for debugging
 */
export const getErrorDetails = (error: unknown) => {
  if (error instanceof AxiosError) {
    return {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      code: error.code
    };
  }
  
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }
  
  return { error: String(error) };
};