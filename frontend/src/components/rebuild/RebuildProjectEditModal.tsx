/**
 * Edit a rebuild project's facts: title, status, contractor, amounts, dates,
 * and whether the customer builds it with their own contractor.
 */

import React, { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, Input, InputNumber, Select, Row, Col, DatePicker, Checkbox, message,
} from 'antd';
import dayjs from 'dayjs';
import { rebuildService } from '../../services/rebuildService';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { useSheetModal } from '../common/ui';
import { REBUILD_STATUSES, rebuildStatusLabel } from './rebuildUi';
import type { RebuildContractor, RebuildProject } from '../../types/rebuild';

const { TextArea } = Input;

interface Props {
  /** The project being edited; null keeps the dialog closed */
  project: RebuildProject | null;
  onClose: () => void;
}

const RebuildProjectEditModal: React.FC<Props> = ({ project, onClose }) => {
  const queryClient = useQueryClient();
  const { isPhone, sheetProps } = useSheetModal();
  // Phones get thumb-sized controls at 16px, which also keeps iOS from zooming on focus
  const formSize = isPhone ? 'large' : 'small';
  const [form] = Form.useForm();

  const { data: contractors = [] } = useQuery({
    queryKey: ['rebuild-contractors'],
    queryFn: () => rebuildService.listContractors(),
    enabled: !!project,
  });

  useEffect(() => {
    if (!project) return;
    form.setFieldsValue({
      title: project.title,
      description: project.description,
      scope_of_work: project.scope_of_work,
      property_address: project.property_address,
      status: project.status,
      priority: project.priority,
      contractor_id: project.contractor_id,
      insurance_estimate_amount: project.insurance_estimate_amount,
      contract_amount: project.contract_amount,
      final_invoice_amount: project.final_invoice_amount,
      start_date: project.start_date ? dayjs(project.start_date) : undefined,
      estimated_completion: project.estimated_completion ? dayjs(project.estimated_completion) : undefined,
      notes: project.notes,
      customer_managed: !!project.customer_managed,
    });
  }, [project, form]);

  const save = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RebuildProject> }) =>
      rebuildService.updateProject(id, data),
    onSuccess: (_, { id }) => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-project', id] });
      onClose();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not update the project'),
  });

  const submit = () => form.validateFields().then(values => {
    if (!project) return;
    save.mutate({
      id: project.id,
      data: {
        ...values,
        start_date: values.start_date?.toISOString() || null,
        estimated_completion: values.estimated_completion?.toISOString() || null,
      },
    });
  });

  return (
    <Modal title="Edit Project" open={!!project} width={600} {...sheetProps}
      okText="Save"
      onOk={submit}
      onCancel={onClose}
      afterClose={() => form.resetFields()}
      confirmLoading={save.isPending}>
      <Form form={form} layout="vertical" size={formSize}>
        <Form.Item name="title" label="Title" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="status" label="Status">
              <Select options={REBUILD_STATUSES.map(s => ({ value: s, label: rebuildStatusLabel(s) }))} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="priority" label="Priority">
              <Select options={[
                { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
              ]} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="contractor_id" label="Contractor">
          <Select allowClear placeholder="Select contractor"
            options={contractors.map((c: RebuildContractor) => ({ value: c.id, label: c.company_name }))} />
        </Form.Item>
        {/* Moves the project off the list into the "Customer's own contractor" tab */}
        <Form.Item name="customer_managed" valuePropName="checked"
          extra="We don't build it. It moves off the main list and out of the totals, into the Customer's contractor tab.">
          <Checkbox>Customer hires their own contractor</Checkbox>
        </Form.Item>
        <Form.Item name="property_address" label="Property Address">
          <AddressAutocomplete fillFullAddress />
        </Form.Item>
        {/* Three amounts share a row on desktop; phones take two per row */}
        <Row gutter={12}>
          <Col xs={12} sm={8}>
            <Form.Item name="insurance_estimate_amount" label="Insurance $">
              <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="contract_amount" label="Contract $">
              <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="final_invoice_amount" label="Final Invoice $">
              <InputNumber min={0} step={0.01} prefix="$" inputMode="decimal" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="start_date" label="Start Date">
              <DatePicker inputReadOnly={isPhone} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="estimated_completion" label="Est. Completion">
              <DatePicker inputReadOnly={isPhone} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="scope_of_work" label="Scope of Work">
          <TextArea rows={3} />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <TextArea rows={2} />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RebuildProjectEditModal;
