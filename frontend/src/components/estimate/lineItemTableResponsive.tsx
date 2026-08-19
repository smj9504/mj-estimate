/**
 * Responsive helpers for the Estimate / Invoice line-item tables.
 *
 * Those tables carry Description + Qty + Unit + Rate + Amount + Tax + Actions.
 * That needs ~600px, so on a phone the table scrolls horizontally — and because
 * Description is a fixed-left column, the fixed set alone (checkbox + drag
 * handle + description + actions) is wider than the viewport. The result is a
 * description clipped to a few characters with no way to reveal the rest.
 *
 * On narrow viewports we therefore drop the numeric columns and fold their
 * values into the description cell as a compact second line. The table then
 * fits without horizontal scrolling and the description wraps in full.
 */

import React from 'react';
import { Grid, Switch, Tooltip } from 'antd';

const { useBreakpoint } = Grid;

/**
 * True when the viewport is too narrow (< antd `md`, 768px) to show the full
 * column set. Consumers use this to switch to the stacked cell layout.
 */
export function useIsNarrowLineItemTable(): boolean {
  const screens = useBreakpoint();
  // `screens` is empty on the very first paint; treat "md unknown" as wide so
  // desktop never flashes the stacked layout.
  return screens.md === false;
}

export interface LineItemPricing {
  quantity?: number | null;
  unit?: string | null;
  /** Preformatted, e.g. "$8.50" */
  rate: string;
  /** Preformatted, e.g. "$102.00" */
  amount: string;
}

export interface LineItemTax {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface MobileLineItemCellProps {
  /** Item description — trusted HTML, same as the desktop cell renders */
  description?: string | null;
  /** Note / photo indicators shown beside the description */
  adornments?: React.ReactNode;
  /** Omitted for lump-sum documents, where no per-item pricing is shown */
  pricing?: LineItemPricing;
  /** Omitted when tax is not tracked per item */
  tax?: LineItemTax;
}

/**
 * Description cell used on narrow viewports: the description wraps over as
 * many lines as it needs, with qty/unit/rate/amount underneath it.
 */
export const MobileLineItemCell: React.FC<MobileLineItemCellProps> = ({
  description,
  adornments,
  pricing,
  tax,
}) => {
  const qtyLabel = pricing
    ? [pricing.quantity ?? 0, pricing.unit].filter((part) => part !== null && part !== undefined && part !== '').join(' ')
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {description ? (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              // Long descriptions must wrap rather than clip — this is the
              // whole point of the stacked layout.
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              lineHeight: 1.45,
            }}
            dangerouslySetInnerHTML={{ __html: description }}
          />
        ) : (
          <div style={{ flex: 1, minWidth: 0 }} />
        )}
        {adornments}
      </div>

      {(pricing || tax) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 12,
            color: '#8c8c8c',
          }}
        >
          {pricing && (
            <>
              <span>
                {qtyLabel} × {pricing.rate}
              </span>
              <span style={{ color: '#262626', fontWeight: 600 }}>{pricing.amount}</span>
            </>
          )}
          {tax && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Tooltip title="Taxable">
                <span>Tax</span>
              </Tooltip>
              <Switch size="small" checked={tax.checked} onChange={tax.onChange} />
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default MobileLineItemCell;
