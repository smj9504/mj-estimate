/**
 * Environment-aware logging utility
 * Only logs in development mode, except for errors which always log
 */

const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = {
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  error: (...args: unknown[]): void => {
    // Errors are always logged
    console.error(...args);
  },

  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },

  // For API/network related logs
  api: (message: string, data?: unknown): void => {
    if (isDevelopment) {
      console.log(`[API] ${message}`, data ?? '');
    }
  }
};

export default logger;
