/**
 * What the water mitigation sketch says was torn out on this claim: where, what
 * and how big, floor by floor, to refer to while writing the supplement estimate.
 * Fetched only when opened and read only. No mask, so on a wide screen the
 * carrier's estimate stays usable beside it.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Drawer, Spin, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQueries } from '@tanstack/react-query';
import wmSketchService from '../../services/wmSketchService';
import { useAuth } from '../../contexts/AuthContext';
import { Pill } from '../common/ui';
import {
  addUpTotals,
  floorTakeoff,
  formatDemoQuantity,
  type DemoFloorTakeoff,
  type DemoRow,
  type DemoTotal,
} from '../water-mitigation/sketch/utils/demoTakeoff';
import WMDemoPlan from './WMDemoPlan';

const DRAWER_WIDTH = 'min(920px, 100vw)';

const Totals: React.FC<{ title: string; totals: DemoTotal[] }> = ({ title, totals }) => (
  <div className="wmd-totals">
    <div className="wmd-totals-title">{title}</div>
    {totals.map((total) => (
      <div key={`${total.name}|${total.unit}`} className="wmd-totals-row">
        <span>{total.name}</span>
        <span className="wmd-qty">{formatDemoQuantity(total.quantity, total.unit)}</span>
      </div>
    ))}
  </div>
);

const Row = React.forwardRef<HTMLButtonElement, {
  row: DemoRow;
  location: string | null;
  active: boolean;
  pinned: boolean;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}>(({ row, location, active, pinned, onHover, onPick }, ref) => {
  const details = [
    row.measurement,
    // Its label says something the heading above doesn't
    row.label && row.label !== location ? row.label : null,
  ].filter(Boolean).join(' · ');
  return (
    <button
      ref={ref}
      type="button"
      className={`wmd-row${active ? ' is-active' : ''}`}
      aria-pressed={pinned}
      onMouseEnter={() => onHover(row.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(row.id)}
      onBlur={() => onHover(null)}
      onClick={() => onPick(row.id)}
    >
      <span className="wmd-num" style={{ borderColor: row.unmeasured ? undefined : row.color }}>{row.number}</span>
      <span className="wmd-row-body">
        <span className="wmd-row-name">{row.name}</span>
        {details && <span className="wmd-row-meta">{details}</span>}
        {row.addOns.length > 0 && (
          <span className="wmd-row-meta">
            With {row.addOns.map((a) => `${a.name} ${formatDemoQuantity(a.quantity, a.unit)}`).join(', ')}
          </span>
        )}
      </span>
      {row.unmeasured
        ? <span className="wmd-qty wmd-qty--missing">Not measured</span>
        : <span className="wmd-qty">{formatDemoQuantity(row.quantity, row.unit)}</span>}
    </button>
  );
});
Row.displayName = 'Row';

const FloorSection: React.FC<{ takeoff: DemoFloorTakeoff }> = ({ takeoff }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeId = hoveredId ?? pinnedId;
  const { floor, groups, rows, totals, unmeasuredCount } = takeoff;

  const pick = (id: string) => setPinnedId((current) => (current === id ? null : id));
  const pickFromPlan = (id: string) => {
    pick(id);
    rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return (
    <section className="wmd-floor">
      <div className="wmd-floor-head">
        <h3 className="ui-section-title">
          {floor.floor_label}
          <span className="sup-section-count">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
        </h3>
        {unmeasuredCount > 0 && <Pill tone="orange">{unmeasuredCount} not measured</Pill>}
      </div>
      <div className="wmd-floor-body">
        <div className="wmd-plan">
          <WMDemoPlan takeoff={takeoff} activeId={activeId} onHover={setHoveredId} onPick={pickFromPlan} />
        </div>
        <div className="wmd-list">
          {groups.map((group) => (
            <div key={group.location ?? 'none'} className="wmd-group">
              <div className="wmd-group-title">{group.location ?? 'No room marked: see its number on the plan'}</div>
              {group.rows.map((row) => (
                <Row
                  key={row.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(row.id, node);
                    else rowRefs.current.delete(row.id);
                  }}
                  row={row}
                  location={group.location}
                  active={row.id === activeId}
                  pinned={row.id === pinnedId}
                  onHover={setHoveredId}
                  onPick={pick}
                />
              ))}
            </div>
          ))}
          {totals.length > 0 && <Totals title={`${floor.floor_label} total`} totals={totals} />}
        </div>
      </div>
    </section>
  );
};

interface DemoJob {
  id: string;
  property_address?: string;
  company_name?: string;
}

const JobDemo: React.FC<{
  job: DemoJob;
  floors?: Parameters<typeof floorTakeoff>[0][];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}> = ({ job, floors, loading, failed, onRetry }) => {
  const { canAccessPath } = useAuth();
  const takeoffs = useMemo(() => (floors ?? []).map(floorTakeoff), [floors]);
  const withDemo = takeoffs.filter((t) => t.rows.length > 0);
  const withoutDemo = takeoffs.filter((t) => t.rows.length === 0);
  const allTotals = useMemo(() => addUpTotals(withDemo.flatMap((t) => t.totals)), [withDemo]);
  const canOpenJob = canAccessPath(`/water-mitigation/${job.id}`);

  const heading = [job.property_address, job.company_name].filter(Boolean).join(' · ');
  return (
    <div className="wmd-job">
      <div className="wmd-job-head">
        <span>{heading || 'Water mitigation job'}</span>
        {canOpenJob && <Link className="ui-ink-link" to={`/water-mitigation/${job.id}`}>Open job</Link>}
      </div>

      {loading ? (
        <div className="wmd-state"><Spin /></div>
      ) : failed ? (
        <div className="wmd-state" role="alert">
          Could not load this job's sketch.{' '}
          <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={onRetry}>Try again</Button>
        </div>
      ) : takeoffs.length === 0 ? (
        <div className="wmd-state">This job has no sketch yet.</div>
      ) : withDemo.length === 0 ? (
        <div className="wmd-state">No demolition is drawn on this job's sketch.</div>
      ) : (
        <>
          {withDemo.map((takeoff) => <FloorSection key={takeoff.floor.id} takeoff={takeoff} />)}
          {withoutDemo.length > 0 && (
            <div className="wmd-note">
              No demolition drawn on {withoutDemo.map((t) => t.floor.floor_label).join(', ')}.
            </div>
          )}
          {withDemo.length > 1 && <Totals title="All floors total" totals={allTotals} />}
        </>
      )}
    </div>
  );
};

interface WMDemoDrawerProps {
  open: boolean;
  onClose: () => void;
  jobs: DemoJob[];
}

const WMDemoDrawer: React.FC<WMDemoDrawerProps> = ({ open, onClose, jobs }) => {
  const results = useQueries({
    queries: jobs.map((job) => ({
      queryKey: ['wm-demo-floors', job.id],
      // Failure shows in the drawer, whose Try again refreshes it; the global
      // notification's retry would only resend the request
      queryFn: () => wmSketchService.getFloorSketches(job.id, { suppressErrorNotification: true }),
      enabled: open,
      // The sketch may have changed since this was last opened
      staleTime: 0,
    })),
  });
  const refreshing = results.some((r) => r.isFetching);

  return (
    <Drawer
      title="Water mitigation demo"
      open={open}
      onClose={onClose}
      width={DRAWER_WIDTH}
      mask={false}
      destroyOnHidden
      rootClassName="wmd-root"
      extra={
        <Tooltip title="Fetch the sketch again">
          <Button
            type="text"
            size="small"
            className="ui-icon-btn"
            icon={<ReloadOutlined spin={refreshing} />}
            aria-label="Fetch the sketch again"
            disabled={refreshing}
            onClick={() => results.forEach((r) => r.refetch())}
          />
        </Tooltip>
      }
    >
      {jobs.map((job, i) => (
        <JobDemo
          key={job.id}
          job={job}
          floors={results[i]?.data}
          loading={!!results[i]?.isLoading}
          failed={!!results[i]?.isError}
          onRetry={() => results[i]?.refetch()}
        />
      ))}
    </Drawer>
  );
};

export default WMDemoDrawer;
