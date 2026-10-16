/**
 * PropertyList — facts as quiet rows: grey label on the left, value on the
 * right, no grid lines. Replaces bordered Descriptions on detail pages.
 */

import React from 'react';

export interface PropertyItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  value: React.ReactNode;
  /** Hide the row when the value is empty instead of showing a dash */
  hideEmpty?: boolean;
}

interface PropertyListProps {
  items: PropertyItem[];
  /** Label column width on desktop; phones use a narrower column */
  labelWidth?: number;
  style?: React.CSSProperties;
}

const isEmpty = (v: React.ReactNode) => v === null || v === undefined || v === '' || v === false;

const PropertyList: React.FC<PropertyListProps> = ({ items, labelWidth = 160, style }) => (
  <dl
    className="ui-props"
    style={{ ['--ui-props-label' as string]: `${labelWidth}px`, ...style }}
  >
    {items
      .filter(item => !(item.hideEmpty && isEmpty(item.value)))
      .map(item => (
        <div className="ui-props-row" key={item.key}>
          <dt className="ui-props-label">
            {item.icon && <span className="ui-props-icon" aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
          </dt>
          <dd className="ui-props-value">
            {isEmpty(item.value) ? <span className="ui-props-empty">Empty</span> : item.value}
          </dd>
        </div>
      ))}
  </dl>
);

export default PropertyList;
