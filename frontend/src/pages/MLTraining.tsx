/**
 * ML Training Page
 * Manage training datasets and train custom material detection models
 */

import React, { useState, useEffect } from 'react';
import {
  Layout,
  Card,
  Tabs,
  Button,
  Space,
  Typography,
  Row,
  Col,
  Statistic,
  Alert,
  Spin
} from 'antd';
import {
  DatabaseOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  BarChartOutlined
} from '@ant-design/icons';
import DatasetManager from '../components/ml-training/DatasetManager';
import TrainingJobs from '../components/ml-training/TrainingJobs';
import { listDatasets, listTrainingJobs } from '../services/mlTrainingService';
import type { TrainingDataset, TrainingJob } from '../services/mlTrainingService';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TabPane } = Tabs;

const MLTraining: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('datasets');
  const [datasets, setDatasets] = useState<TrainingDataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalDatasets: 0,
    readyDatasets: 0,
    totalJobs: 0,
    runningJobs: 0
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [datasetsData, jobsData] = await Promise.all([
        listDatasets(),
        listTrainingJobs()
      ]);

      setDatasets(datasetsData);
      setJobs(jobsData);

      // Calculate stats
      setStats({
        totalDatasets: datasetsData.length,
        readyDatasets: datasetsData.filter(d => d.status === 'ready').length,
        totalJobs: jobsData.length,
        runningJobs: jobsData.filter(j => j.status === 'training' || j.status === 'pending').length
      });
    } catch (error) {
      console.error('Failed to load ML training data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh' }}>
      <Content>
        <div style={{ marginBottom: 24 }}>
          <Title level={2}>
            <RocketOutlined /> ML Model Training
          </Title>
          <Text type="secondary">
            Train custom material detection models using Vision Transformer (ViT) architecture
          </Text>
        </div>

        {/* Stats Overview */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Total Datasets"
                value={stats.totalDatasets}
                prefix={<DatabaseOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Ready for Training"
                value={stats.readyDatasets}
                prefix={<ThunderboltOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Total Training Jobs"
                value={stats.totalJobs}
                prefix={<BarChartOutlined />}
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Running Jobs"
                value={stats.runningJobs}
                prefix={<RocketOutlined />}
                valueStyle={{ color: stats.runningJobs > 0 ? '#faad14' : '#8c8c8c' }}
              />
            </Card>
          </Col>
        </Row>

        {/* Info Alert */}
        <Alert
          message="About Model Training"
          description={
            <div>
              <p><strong>Training Process:</strong></p>
              <ol style={{ paddingLeft: 20, marginBottom: 0 }}>
                <li>Create a dataset and upload construction material images</li>
                <li>Use GPT-4 Vision to automatically label images (~$0.01/image)</li>
                <li>Review and verify labels for accuracy</li>
                <li>Assign train/validation/test splits</li>
                <li>Start training with custom hyperparameters</li>
                <li>Monitor training progress and metrics</li>
                <li>Deploy trained model for material detection</li>
              </ol>
            </div>
          }
          type="info"
          closable
          style={{ marginBottom: 24 }}
        />

        {/* Main Content Tabs */}
        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabBarExtraContent={
              <Button
                type="primary"
                onClick={loadData}
                loading={loading}
              >
                Refresh
              </Button>
            }
          >
            <TabPane
              tab={
                <span>
                  <DatabaseOutlined />
                  Datasets
                </span>
              }
              key="datasets"
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: 50 }}>
                  <Spin size="large" />
                </div>
              ) : (
                <DatasetManager
                  datasets={datasets}
                  onDatasetChange={loadData}
                />
              )}
            </TabPane>

            <TabPane
              tab={
                <span>
                  <RocketOutlined />
                  Training Jobs
                </span>
              }
              key="jobs"
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: 50 }}>
                  <Spin size="large" />
                </div>
              ) : (
                <TrainingJobs
                  jobs={jobs}
                  datasets={datasets}
                  onJobChange={loadData}
                />
              )}
            </TabPane>
          </Tabs>
        </Card>
      </Content>
    </Layout>
  );
};

export default MLTraining;
