/**
 * The bathrooms of one job (one house: its claim, or its address), above the
 * open bathroom's restoration and options. Each bathroom is its own
 * estimate, so its scope (demo, sketch, shower & tub, vanity, floor &
 * walls, plumbing & electrical, accessories) is its own; the house's facts
 * on Project Info are shared. Picking one opens it on the same tab; adding
 * one starts it with the house's facts.
 */

import React, { useState } from 'react';
import { Button, Modal, Segmented, Tooltip, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bathroomEstimateService } from '../../services/bathroomEstimateService';
import type { BathroomEstimate, JobBathroom } from '../../types/bathroomEstimate';
import { bathroomName } from '../../types/bathroomEstimate';
import BathroomTypeSelect from './BathroomTypeSelect';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

interface BEBathroomBarProps {
  estimate: BathroomEstimate;
  /** Open another estimate; the page checks for unsaved changes first */
  onOpen: (id: string) => void;
  /** Run `action` once the page's unsaved changes are saved or discarded */
  guardUnsaved: (action: () => void) => void;
}

const BEBathroomBar: React.FC<BEBathroomBarProps> = ({ estimate, onOpen, guardUnsaved }) => {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [designation, setDesignation] = useState<string | undefined>();

  const { data: bathrooms } = useQuery({
    queryKey: ['bathroom-job', estimate.id],
    queryFn: () => bathroomEstimateService.getBathrooms(estimate.id),
  });

  const add = useMutation({
    mutationFn: () => bathroomEstimateService.addBathroom(estimate.id, designation),
    onSuccess: (created) => {
      message.success(`${bathroomName(created.designation)} added to this job`);
      setAdding(false);
      setDesignation(undefined);
      queryClient.invalidateQueries({ queryKey: ['bathroom-job'] });
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimates'] });
      onOpen(created.id);
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not add the bathroom'),
  });

  const rows: JobBathroom[] = bathrooms ?? [];
  const current = rows.find((r) => r.current);
  // The claim or the address is what puts the job's bathrooms together
  const canAdd = !!estimate.claim_id || !!estimate.property_address?.trim();

  return (
    <div className="be-bathroom-bar" style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8,
    }}>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>Bathrooms</span>
      {rows.length > 0 && (
        <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Segmented
            aria-label="Bathrooms on this job"
            value={current?.group_id}
            onChange={(groupId) => {
              const row = rows.find((r) => r.group_id === groupId);
              if (row && !row.current) onOpen(row.estimate_id);
            }}
            options={rows.map((r) => ({
              value: r.group_id,
              label: (
                <div style={{ padding: '2px 4px', lineHeight: 1.3, textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: 'nowrap' }}>
                    {r.calculated ? money(r.total) : 'Not calculated'}
                    {r.alone && ' · on its own'}
                  </div>
                </div>
              ),
            }))}
          />
        </div>
      )}
      <Tooltip title={canAdd
        ? 'Another bathroom in this house: its own scope, with this job’s company, claim and address'
        : 'Set the claim or the property address on Project Info first'}
      >
        <Button
          icon={<PlusOutlined />}
          disabled={!canAdd}
          onClick={() => guardUnsaved(() => setAdding(true))}
        >
          Bathroom
        </Button>
      </Tooltip>

      <Modal
        title="Add a bathroom to this job"
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={() => add.mutate()}
        okText="Add bathroom"
        okButtonProps={{ loading: add.isPending }}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          It starts with this job&rsquo;s company, claim and address. Its demo, sketch, fixtures,
          finishes and costs are its own.
        </p>
        <BathroomTypeSelect
          aria-label="Bathroom type"
          style={{ width: '100%' }}
          value={designation}
          onChange={setDesignation}
        />
      </Modal>
    </div>
  );
};

export default BEBathroomBar;
