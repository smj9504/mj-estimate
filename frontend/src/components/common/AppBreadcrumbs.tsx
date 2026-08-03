import React, { useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Breadcrumb } from 'antd';
import type { ItemType } from 'antd/es/breadcrumb/Breadcrumb';
import { colors } from '../../styles/tokens';
import { useBreadcrumb } from '../../contexts/BreadcrumbContext';

interface AppBreadcrumbsProps {
  menuItems: any[];
}

// Matches UUIDs and numeric IDs — these should not display raw in breadcrumbs
const isIdSegment = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
  /^\d+$/.test(s);

const AppBreadcrumbs: React.FC<AppBreadcrumbsProps> = ({ menuItems }) => {
  const location = useLocation();
  const { pageTitle } = useBreadcrumb();

  const breadcrumbItems = useMemo(() => {
    const { pathname } = location;

    let parentLabel: string | null = null;
    let childLabel: string | null = null;
    let parentKey: string | null = null;
    let matchedChildKey: string | null = null;

    for (const item of menuItems) {
      if (item.children) {
        for (const child of item.children) {
          if (pathname === child.key || pathname.startsWith(child.key + '/')) {
            parentLabel = item.label;
            childLabel = child.label;
            parentKey = item.key;
            matchedChildKey = child.key;
            break;
          }
        }
        if (childLabel) break;
      } else if (item.key.startsWith('/') && (pathname === item.key || pathname.startsWith(item.key + '/'))) {
        childLabel = item.label;
        matchedChildKey = item.key;
        break;
      }
    }

    const segments: ItemType[] = [];

    if (parentLabel) {
      segments.push({ title: parentLabel });
    }

    if (childLabel && matchedChildKey) {
      const isDeep = pathname !== matchedChildKey && pathname.startsWith(matchedChildKey + '/');

      if (isDeep) {
        // Child label is a link back to the list page
        segments.push({
          title: <Link to={matchedChildKey} style={{ color: colors.neutral700 }}>{childLabel}</Link>,
        });

        // Show pageTitle from context (e.g., address), or nothing if ID-like
        const deepSegment = pathname.slice(matchedChildKey.length + 1).split('/')[0];
        if (pageTitle) {
          segments.push({ title: pageTitle });
        } else if (deepSegment && !isIdSegment(deepSegment)) {
          // Show non-ID segments as-is (e.g., "new", "edit")
          segments.push({ title: deepSegment.charAt(0).toUpperCase() + deepSegment.slice(1) });
        }
        // If it's an ID and no pageTitle set yet, just show parent > child (no raw ID)
      } else {
        segments.push({ title: childLabel });
      }
    }

    return segments;
  }, [location.pathname, menuItems, pageTitle]);

  if (breadcrumbItems.length <= 0) return null;

  return (
    <Breadcrumb
      items={breadcrumbItems}
      style={{
        marginBottom: 12,
        fontSize: 12,
      }}
    />
  );
};

export default AppBreadcrumbs;
