import React, { useEffect } from 'react';
import { Card, Button, Space, Typography, Alert } from 'antd';
import { DatabaseOutlined, ArrowRightOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

const AdminRedirect: React.FC = () => {
  const adminUrl = 'http://localhost:8000/admin';

  const handleRedirect = () => {
    window.location.href = adminUrl;
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '80vh',
      padding: '24px' 
    }}>
      <Card style={{ maxWidth: 600, width: '100%' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <DatabaseOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            <Title level={2} style={{ marginTop: 16 }}>
              SQLAdmin 데이터베이스 관리
            </Title>
          </div>

          <Alert
            message="별도 인터페이스"
            description="SQLAdmin은 데이터베이스를 직접 관리하는 별도의 관리자 인터페이스입니다. 새 탭에서 열립니다."
            type="info"
            showIcon
          />

          <Paragraph>
            SQLAdmin을 통해 다음 작업을 수행할 수 있습니다:
          </Paragraph>
          <ul>
            <li>데이터베이스 테이블 직접 조회 및 편집</li>
            <li>회사, 송장, 견적서 등 모든 데이터 관리</li>
            <li>문서 유형 및 가격 규칙 설정</li>
            <li>업종 분류 관리</li>
          </ul>

          <Space style={{ width: '100%', justifyContent: 'center' }}>
            <Button 
              type="primary" 
              size="large"
              icon={<ArrowRightOutlined />}
              onClick={handleRedirect}
            >
              SQLAdmin으로 이동 (포트 8000)
            </Button>
          </Space>

          <Alert
            message="로그인 정보"
            description={
              <>
                <div>사용자명: <Text code>admin</Text></div>
                <div>비밀번호: <Text code>admin123</Text></div>
              </>
            }
            type="warning"
          />
        </Space>
      </Card>
    </div>
  );
};

export default AdminRedirect;