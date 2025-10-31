/**
 * Common formatter utilities
 */

/**
 * Format ISO date string to readable format
 * @param dateString - ISO date string
 * @returns Formatted date string (e.g., "Oct 30, 2025 10:30 AM")
 */
export const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';

  const date = new Date(dateString);

  // Check if date is valid
  if (isNaN(date.getTime())) return '-';

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };

  return new Intl.DateTimeFormat('en-US', options).format(date);
};

/**
 * Format date to short format (date only)
 * @param dateString - ISO date string
 * @returns Short formatted date (e.g., "Oct 30, 2025")
 */
export const formatDateShort = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';

  const date = new Date(dateString);

  if (isNaN(date.getTime())) return '-';

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };

  return new Intl.DateTimeFormat('en-US', options).format(date);
};

/**
 * Format date to relative time (e.g., "2 hours ago", "3 days ago")
 * @param dateString - ISO date string
 * @returns Relative time string
 */
export const formatRelativeTime = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';

  const date = new Date(dateString);

  if (isNaN(date.getTime())) return '-';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;

  return formatDateShort(dateString);
};
