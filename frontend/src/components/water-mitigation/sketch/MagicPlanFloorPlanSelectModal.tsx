/**
 * MagicPlanFloorPlanSelectModal
 *
 * Modal that lets the user:
 * 1. Search / auto-match a MagicPlan project for the current job
 * 2. Browse available floor plans within that project
 * 3. Select which floor plan to import into the current WM sketch floor
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Steps,
  List,
  Button,
  Tag,
  Typography,
  Spin,
  Empty,
  Space,
  Alert,
  Radio,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  HomeOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { magicPlanService } from '../../../services/waterMitigationService';
import type {
  MagicPlanProjectMatch,
  MagicPlanFloorPlanInfo,
} from '../../../types/waterMitigation';

const { Text, Title } = Typography;

// ============================================================================
// Types
// ============================================================================

export interface MagicPlanFloorSelection {
  projectId: string;
  projectName: string;
  planId: string;
  planTitle?: string;
  floorIndex: number;
  floorName: string;
  imageUrl?: string;
}

export interface MagicPlanFloorPlanSelectModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: MagicPlanFloorSelection) => void;
  jobId: string;
  currentFloorLabel: string;
  loading?: boolean;
}

// ============================================================================
// Component
// ============================================================================

const MagicPlanFloorPlanSelectModal: React.FC<MagicPlanFloorPlanSelectModalProps> = ({
  open,
  onClose,
  onSelect,
  jobId,
  currentFloorLabel,
  loading: externalLoading,
}) => {
  // Step management
  const [currentStep, setCurrentStep] = useState(0);

  // Step 0: Project search
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [autoMatch, setAutoMatch] = useState<MagicPlanProjectMatch | null>(null);
  const [candidates, setCandidates] = useState<MagicPlanProjectMatch[]>([]);
  const [selectedProject, setSelectedProject] = useState<MagicPlanProjectMatch | null>(null);

  // Step 1: Floor plan selection
  const [floorPlansLoading, setFloorPlansLoading] = useState(false);
  const [floorPlansError, setFloorPlansError] = useState<string | null>(null);
  const [floorPlans, setFloorPlans] = useState<MagicPlanFloorPlanInfo[]>([]);
  const [selectedFloorKey, setSelectedFloorKey] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setCurrentStep(0);
      setSelectedProject(null);
      setFloorPlans([]);
      setSelectedFloorKey(null);
      setProjectError(null);
      setFloorPlansError(null);
      searchProjects();
    }
  }, [open, jobId]);

  // ------------------------------------------------------------------
  // Step 0: Search projects
  // ------------------------------------------------------------------
  const searchProjects = useCallback(async () => {
    setProjectLoading(true);
    setProjectError(null);
    try {
      const result = await magicPlanService.searchProjects(jobId);
      setAutoMatch(result.auto_match || null);
      setCandidates(result.candidates || []);

      // Auto-advance if there's exactly one match
      if (result.auto_match && result.candidates.length === 0) {
        handleProjectSelect(result.auto_match);
      }
    } catch (err: any) {
      setProjectError(
        err?.response?.data?.detail || 'Failed to search MagicPlan projects'
      );
    } finally {
      setProjectLoading(false);
    }
  }, [jobId]);

  // ------------------------------------------------------------------
  // Step 1: Load floor plans for selected project
  // ------------------------------------------------------------------
  const handleProjectSelect = useCallback(async (project: MagicPlanProjectMatch) => {
    setSelectedProject(project);
    setCurrentStep(1);
    setFloorPlansLoading(true);
    setFloorPlansError(null);
    setSelectedFloorKey(null);

    try {
      const plans = await magicPlanService.getFloorPlans(project.project_id);
      setFloorPlans(plans);

      // Auto-select if there's only one floor across all plans
      const allFloors = plans.flatMap((p) =>
        (p.floors || []).map((f) => ({ planId: p.plan_id, ...f }))
      );
      if (allFloors.length === 1) {
        setSelectedFloorKey(`${allFloors[0].planId}__${allFloors[0].index}`);
      }
    } catch (err: any) {
      setFloorPlansError(
        err?.response?.data?.detail || 'Failed to load floor plans'
      );
    } finally {
      setFloorPlansLoading(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Confirm selection
  // ------------------------------------------------------------------
  const handleConfirm = useCallback(() => {
    if (!selectedProject || !selectedFloorKey) return;

    const [planId, floorIndexStr] = selectedFloorKey.split('__');
    const floorIndex = parseInt(floorIndexStr, 10);

    // Find the matching plan and floor
    const plan = floorPlans.find((p) => p.plan_id === planId);
    const floor = plan?.floors?.find((f) => f.index === floorIndex);

    onSelect({
      projectId: selectedProject.project_id,
      projectName: selectedProject.project_name,
      planId,
      planTitle: plan?.plan_title,
      floorIndex,
      floorName: floor?.name || `Floor ${floorIndex + 1}`,
      imageUrl: floor?.image_url,
    });
  }, [selectedProject, selectedFloorKey, floorPlans, onSelect]);

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const renderProjectList = () => {
    if (projectLoading) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#8c8c8c' }}>
            Searching MagicPlan projects...
          </div>
        </div>
      );
    }

    if (projectError) {
      return (
        <Alert
          type="error"
          message="Search Failed"
          description={projectError}
          showIcon
          action={
            <Button size="small" onClick={searchProjects}>
              Retry
            </Button>
          }
        />
      );
    }

    const allProjects = [
      ...(autoMatch ? [autoMatch] : []),
      ...candidates.filter((c) => c.project_id !== autoMatch?.project_id),
    ];

    if (allProjects.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No MagicPlan projects found for this job"
        />
      );
    }

    return (
      <List
        dataSource={allProjects}
        renderItem={(project) => (
          <List.Item
            key={project.project_id}
            style={{
              cursor: 'pointer',
              padding: '12px 16px',
              borderRadius: 8,
              border: selectedProject?.project_id === project.project_id
                ? '2px solid #722ed1'
                : '1px solid #f0f0f0',
              marginBottom: 8,
              background: selectedProject?.project_id === project.project_id
                ? '#f9f0ff'
                : '#fff',
            }}
            onClick={() => handleProjectSelect(project)}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Text strong>{project.project_name}</Text>
                  {project.match_type === 'auto' && (
                    <Tag color="green" icon={<CheckCircleOutlined />}>
                      Auto-matched
                    </Tag>
                  )}
                  {project.match_type === 'fuzzy' && (
                    <Tag color="orange">Fuzzy match</Tag>
                  )}
                </Space>
              }
              description={
                <Space direction="vertical" size={0}>
                  {project.address && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {project.address}
                    </Text>
                  )}
                  <Space size={12}>
                    {project.plan_count != null && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        <HomeOutlined /> {project.plan_count} plan(s)
                      </Text>
                    )}
                    {project.photo_count != null && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        <PictureOutlined /> {project.photo_count} photo(s)
                      </Text>
                    )}
                  </Space>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    );
  };

  const renderFloorPlanSelection = () => {
    if (floorPlansLoading) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#8c8c8c' }}>
            Loading floor plans...
          </div>
        </div>
      );
    }

    if (floorPlansError) {
      return (
        <Alert
          type="error"
          message="Load Failed"
          description={floorPlansError}
          showIcon
        />
      );
    }

    // Flatten all floors from all plans
    const allFloors = floorPlans.flatMap((plan) =>
      (plan.floors || []).map((floor) => ({
        key: `${plan.plan_id}__${floor.index}`,
        planId: plan.plan_id,
        planTitle: plan.plan_title,
        ...floor,
      }))
    );

    if (allFloors.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No floor plans found in this MagicPlan project"
        />
      );
    }

    return (
      <div>
        <Alert
          type="info"
          message={
            <span>
              Importing to: <strong>{currentFloorLabel}</strong>
            </span>
          }
          description="Select which MagicPlan floor plan to use as background for this floor."
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Radio.Group
          value={selectedFloorKey}
          onChange={(e) => setSelectedFloorKey(e.target.value)}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {allFloors.map((floor) => (
              <div
                key={floor.key}
                style={{
                  border: selectedFloorKey === floor.key
                    ? '2px solid #722ed1'
                    : '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: 12,
                  cursor: 'pointer',
                  background: selectedFloorKey === floor.key ? '#f9f0ff' : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
                onClick={() => setSelectedFloorKey(floor.key)}
              >
                <Radio value={floor.key} />
                <div style={{ flex: 1 }}>
                  <Text strong>{floor.name || `Floor ${floor.index + 1}`}</Text>
                  {floorPlans.length > 1 && floor.planTitle && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Plan: {floor.planTitle}
                      </Text>
                    </div>
                  )}
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {floor.room_count} room(s)
                      {!floor.has_image && (
                        <Tag color="warning" style={{ marginLeft: 8, fontSize: 11 }}>
                          No image
                        </Tag>
                      )}
                    </Text>
                  </div>
                </div>
              </div>
            ))}
          </Space>
        </Radio.Group>
      </div>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <CloudDownloadOutlined style={{ color: '#722ed1' }} />
          <span>Import from MagicPlan</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={600}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {currentStep > 0 && (
              <Button onClick={() => setCurrentStep(0)}>
                Back to Projects
              </Button>
            )}
          </div>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            {currentStep === 1 && (
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                disabled={!selectedFloorKey}
                loading={externalLoading}
                onClick={handleConfirm}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
              >
                Import Floor Plan
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Steps
        current={currentStep}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Select Project' },
          { title: 'Choose Floor Plan' },
        ]}
      />

      {currentStep === 0 && renderProjectList()}
      {currentStep === 1 && renderFloorPlanSelection()}
    </Modal>
  );
};

export default MagicPlanFloorPlanSelectModal;
