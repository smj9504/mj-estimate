/**
 * PageHeader — the top of a page: title, optional meta line, actions.
 * The page itself is the sheet, so this sits directly on it with no card.
 * On phones the actions drop under the title and scroll sideways if needed.
 */

import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  /** Small line under the title: counts, address, status pills */
  meta?: React.ReactNode;
  /** Element before the title (back button) */
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, meta, leading, actions, style }) => (
  <header className="ui-page-header" style={style}>
    <div className="ui-page-header-main">
      {leading && <div className="ui-page-header-leading">{leading}</div>}
      <div className="ui-page-header-titles">
        <h1 className="ui-page-title">{title}</h1>
        {meta && <div className="ui-page-meta">{meta}</div>}
      </div>
    </div>
    {actions && <div className="ui-page-actions">{actions}</div>}
  </header>
);

export default PageHeader;
