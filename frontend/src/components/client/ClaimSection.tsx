/**
 * ClaimSection — a heading over a hairline with its actions on the right,
 * for the sections inside a client's claim (estimates, contracts, email,
 * todos, notes). `size="page"` is the 16px heading used directly in a tab.
 */

import React from 'react';

interface ClaimSectionProps {
  title: React.ReactNode;
  /** Quiet count after the title */
  count?: number;
  /** Pills or a grey note after the title */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'claim' | 'page';
  className?: string;
  children: React.ReactNode;
}

const ClaimSection: React.FC<ClaimSectionProps> = ({
  title, count, meta, actions, size = 'claim', className, children,
}) => (
  <section className={`ui-section cl-section${size === 'claim' ? ' cl-section--claim' : ''}${className ? ` ${className}` : ''}`}>
    <div className="ui-section-head">
      <div className="cl-section-title-row">
        <h3 className="ui-section-title">
          {title}
          {count != null && <span className="sup-section-count">{count}</span>}
        </h3>
        {meta}
      </div>
      {actions && <div className="cl-section-actions">{actions}</div>}
    </div>
    {children}
  </section>
);

export default ClaimSection;
