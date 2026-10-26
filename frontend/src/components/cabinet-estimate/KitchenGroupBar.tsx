/**
 * The estimates of one kitchen job, side by side above the estimate: an
 * insurance job's restoration and its upgrade options, or a remodel's
 * options. Picking one opens it; the bar also adds an option (a copy of
 * the estimate on screen), renames or deletes the open option, and switches
 * the job between insurance and remodel.
 */

import React, { useState } from 'react';
import { Button, Dropdown, Input, Modal, Segmented, Space, Tag, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  DiffOutlined,
  DownOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cabinetEstimateService } from '../../services/cabinetEstimateService';
import type { CabinetEstimate, KitchenGroupMember, KitchenProjectType } from '../../types/cabinetEstimate';
import { memberName } from '../../types/cabinetEstimate';

export const PROJECT_TYPE_LABELS: Record<KitchenProjectType, string> = {
  insurance: 'Insurance claim',
  remodel: 'Remodel',
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

interface KitchenGroupBarProps {
  estimate: CabinetEstimate;
  /**
   * Open another estimate of the job. The page checks for unsaved changes
   * first, unless `discard` says they no longer matter.
   */
  onOpen: (id: string, options?: { discard?: boolean }) => void;
  /** Run `action` once the page's unsaved changes are saved or discarded. */
  guardUnsaved: (action: () => void) => void;
  onCompare: () => void;
}

const KitchenGroupBar: React.FC<KitchenGroupBarProps> = ({ estimate, onOpen, guardUnsaved, onCompare }) => {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);

  const projectType: KitchenProjectType = estimate.project_type || 'insurance';
  const insurance = projectType === 'insurance';
  // The restoration reads first, then the options in their order
  const byRestorationFirst = (a: KitchenGroupMember, b: KitchenGroupMember) =>
    Number(a.kind !== 'restore') - Number(b.kind !== 'restore') || a.option_order - b.option_order;
  const members: KitchenGroupMember[] = estimate.group_members?.length
    ? estimate.group_members.slice().sort(byRestorationFirst)
    : [{
      id: estimate.id,
      kind: estimate.kind || 'restore',
      option_label: estimate.option_label,
      option_order: 0,
      status: estimate.status,
      total: estimate.total || 0,
    }];
  const restoration = members.find((m) => m.kind === 'restore');
  const isOption = estimate.kind === 'option';
  const chosenProducts = Object.values(estimate.selections || {}).filter(Boolean).length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cabinet-estimate'] });
    queryClient.invalidateQueries({ queryKey: ['cabinet-estimates'] });
    queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-group'] });
  };

  const addOption = useMutation({
    mutationFn: () => cabinetEstimateService.addOption(estimate.id),
    onSuccess: (created) => {
      message.success(`${memberName(created)} added — a copy of ${memberName(estimate)}`);
      refresh();
      onOpen(created.id);
    },
    onError: () => message.error('Could not add an option'),
  });

  const rename = useMutation({
    mutationFn: (label: string) => cabinetEstimateService.renameOption(estimate.id, label),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Rename failed'),
  });

  const remove = useMutation({
    mutationFn: () => cabinetEstimateService.delete(estimate.id),
    onSuccess: () => {
      message.success(`${memberName(estimate)} deleted`);
      refresh();
      const next = restoration || members.find((m) => m.id !== estimate.id);
      // Whatever was unsaved belonged to the estimate just deleted
      if (next) onOpen(next.id, { discard: true });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Delete failed'),
  });

  const switchType = useMutation({
    mutationFn: (to: KitchenProjectType) => cabinetEstimateService.setProjectType(estimate.id, to),
    onSuccess: (_, to) => {
      message.success(`This job is now a ${PROJECT_TYPE_LABELS[to].toLowerCase()}`);
      refresh();
    },
    onError: () => message.error('Could not change the job type'),
  });

  const confirmTypeChange = (to: KitchenProjectType) => {
    if (to === projectType) return;
    const name = memberName(estimate);
    const products = chosenProducts
      ? `${chosenProducts} chosen product${chosenProducts === 1 ? '' : 's'}`
      : 'chosen products, if any,';
    Modal.confirm({
      title: `Make this job a ${PROJECT_TYPE_LABELS[to].toLowerCase()}?`,
      content: to === 'remodel'
        ? 'The restoration becomes an option like the others, and the job no longer has an estimate for the insurance company.'
        : `${name} becomes the restoration — the estimate the insurance company gets. A restoration is priced from `
          + `the rate tables alone, so ${name} lets go of its ${products} and goes back to rate-table prices. `
          + 'Any other options stay upgrade options.',
      okText: 'Change',
      onOk: () => switchType.mutateAsync(to),
    });
  };

  const changeType = (to: KitchenProjectType) => {
    // Letting go of products reprices the estimate on screen; settle its edits first
    if (to === 'insurance' && !restoration && chosenProducts) guardUnsaved(() => confirmTypeChange(to));
    else confirmTypeChange(to);
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: `Delete ${memberName(estimate)}?`,
      content: 'Its cabinets, scope, products and line items are deleted. The other estimates of this job stay as they are.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync(),
    });
  };

  const segments = members.map((m) => {
    const overRestoration = insurance && restoration && m.kind === 'option' && m.total && restoration.total
      ? signedMoney(m.total - restoration.total)
      : null;
    return {
      value: m.id,
      label: (
        <div style={{ padding: '2px 4px', lineHeight: 1.3, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{memberName(m)}</div>
          <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: 'nowrap' }}>
            {m.total ? money(m.total) : 'Not calculated'}
            {overRestoration && ` · ${overRestoration}`}
          </div>
        </div>
      ),
    };
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12,
    }}>
      <Dropdown
        trigger={['click']}
        menu={{
          selectable: true,
          selectedKeys: [projectType],
          items: (Object.keys(PROJECT_TYPE_LABELS) as KitchenProjectType[]).map((t) => ({
            key: t,
            label: PROJECT_TYPE_LABELS[t],
          })),
          onClick: ({ key }) => changeType(key as KitchenProjectType),
        }}
      >
        <Tag
          color={insurance ? 'blue' : 'green'}
          style={{ cursor: 'pointer', margin: 0, padding: '2px 8px' }}
        >
          {PROJECT_TYPE_LABELS[projectType]} <DownOutlined style={{ fontSize: 10 }} />
        </Tag>
      </Dropdown>

      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Segmented
          value={estimate.id}
          options={segments}
          onChange={(id) => { if (id !== estimate.id) onOpen(id as string); }}
        />
      </div>

      <Space size={4} wrap>
        <Tooltip title={`New option, starting as a copy of ${memberName(estimate)}`}>
          <Button
            icon={<PlusOutlined />}
            loading={addOption.isPending}
            onClick={() => guardUnsaved(() => addOption.mutate())}
          >
            {insurance ? 'Upgrade option' : 'Option'}
          </Button>
        </Tooltip>
        {members.length > 1 && (
          <Button icon={<DiffOutlined />} onClick={onCompare}>
            Compare
          </Button>
        )}
        {isOption && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'rename', icon: <EditOutlined />, label: 'Rename option' },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: 'Delete option',
                  danger: true,
                  // A remodel's last option is the job; it goes from the list
                  disabled: members.length < 2,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'rename') setRenaming(estimate.option_label || '');
                if (key === 'delete') confirmDelete();
              },
            }}
          >
            <Button icon={<MoreOutlined />} aria-label="Option actions" />
          </Dropdown>
        )}
      </Space>

      <Modal
        title="Rename option"
        open={renaming !== null}
        onCancel={() => setRenaming(null)}
        onOk={() => renaming?.trim() && rename.mutate(renaming.trim())}
        okButtonProps={{ disabled: !renaming?.trim(), loading: rename.isPending }}
        okText="Rename"
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renaming ?? ''}
          maxLength={100}
          placeholder="e.g. Quartz & white shaker"
          onChange={(e) => setRenaming(e.target.value)}
          onPressEnter={() => renaming?.trim() && rename.mutate(renaming.trim())}
        />
      </Modal>
    </div>
  );
};

export default KitchenGroupBar;
