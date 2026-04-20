/**
 * ContractSigning - Public (no-auth) tablet/mobile signing page.
 *
 * Route: /sign/:token
 * Add to App.tsx as a PUBLIC route (no ProtectedRoute wrapper):
 *
 *   const ContractSigning = lazy(() => import('./pages/ContractSigning'));
 *   {
 *     path: '/sign/:token',
 *     element: (
 *       <Suspense fallback={<PageLoader />}>
 *         <ContractSigning />
 *       </Suspense>
 *     ),
 *   }
 */

import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  Result,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  CloseCircleOutlined,
  EditOutlined,
  FileProtectOutlined,
} from '@ant-design/icons';
import { signingService } from '../services/contractService';
import type { ContractViewData } from '../types/contract';
import WMSignaturePad from '../components/water-mitigation/pdf-annotator/WMSignaturePad';

const { Title, Text, Paragraph } = Typography;

// ── Constants ─────────────────────────────────────────────────────────────────

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  authorization: 'Authorization to Work',
  certificate_of_satisfaction: 'Certificate of Satisfaction',
  scope_of_work: 'Scope of Work',
  lien_waiver: 'Lien Waiver',
  change_order: 'Change Order',
  other: 'Other',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getErrorDisplay(err: unknown): { title: string; subTitle: string; status: 'error' | 'warning' } {
  const status = (err as any)?.response?.status;
  if (status === 410)
    return {
      status: 'warning',
      title: 'Link Expired',
      subTitle: 'This signing link has expired. Please contact the company for a new link.',
    };
  if (status === 404)
    return {
      status: 'error',
      title: 'Link Not Found',
      subTitle: 'This signing link is invalid. Please check the URL and try again.',
    };
  return {
    status: 'error',
    title: 'Something Went Wrong',
    subTitle: 'Unable to load the document. Please try again or contact the company.',
  };
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 16px 48px',
    }}
  >
    <div style={{ width: '100%', maxWidth: 780 }}>{children}</div>
  </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

const ContractSigning: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [sigSuccess, setSigSuccess] = useState(false);

  // ── Query ────────────────────────────────────────────────────────────────────

  const {
    data: contract,
    isLoading,
    error,
  } = useQuery<ContractViewData, unknown>({
    queryKey: ['public-contract', token],
    queryFn: () => signingService.getContract(token!),
    enabled: !!token,
    retry: false,
  });

  // ── Mutation ─────────────────────────────────────────────────────────────────

  const signMutation = useMutation({
    mutationFn: ({
      signatureImage,
    }: {
      signatureImage: string;
    }) =>
      signingService.sign(token!, {
        signer_name: signerName.trim(),
        signer_role: 'client',
        signature_image: signatureImage,
      }),
    onSuccess: () => {
      setSigSuccess(true);
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSignClick = () => {
    if (!signerName.trim()) {
      setNameError('Please enter your full name before signing.');
      return;
    }
    setNameError(undefined);
    setSigPadOpen(true);
  };

  const handleSignatureSave = (imageData: string) => {
    setSigPadOpen(false);
    signMutation.mutate({ signatureImage: imageData });
  };

  // ── Render states ─────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <PageShell>
        <Result
          status="error"
          title="Invalid Link"
          subTitle="No signing token was found in this URL."
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">Loading document...</Text>
          </div>
        </div>
      </PageShell>
    );
  }

  if (error || !contract) {
    const { title, subTitle, status } = getErrorDisplay(error);
    return (
      <PageShell>
        <Result
          status={status}
          icon={<CloseCircleOutlined style={{ color: status === 'error' ? '#ff4d4f' : '#faad14' }} />}
          title={title}
          subTitle={subTitle}
        />
      </PageShell>
    );
  }

  // Voided
  if (contract.status === 'voided') {
    return (
      <PageShell>
        <Result
          status="warning"
          title="Contract Voided"
          subTitle="This contract has been voided and is no longer valid for signing."
        />
      </PageShell>
    );
  }

  // Success screen
  if (sigSuccess) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', paddingTop: 48 }}>
          <CheckCircleFilled style={{ fontSize: 72, color: '#52c41a', marginBottom: 16 }} />
          <Title level={2} style={{ color: '#262626' }}>
            Document Signed
          </Title>
          <Paragraph type="secondary" style={{ fontSize: 16, maxWidth: 400, margin: '0 auto' }}>
            Thank you, <strong>{signerName}</strong>. Your signature has been recorded successfully.
          </Paragraph>
          {contract.company_name && (
            <Paragraph type="secondary" style={{ marginTop: 12 }}>
              A copy will be retained by <strong>{contract.company_name}</strong>.
            </Paragraph>
          )}
        </div>
      </PageShell>
    );
  }

  const isAlreadySigned =
    contract.status === 'signed' || (contract.existing_signatures?.length ?? 0) > 0;
  const documentTypeLabel =
    DOCUMENT_TYPE_LABELS[contract.document_type ?? ''] ?? contract.document_type ?? '';

  return (
    <PageShell>
      {/* ── Company / Header ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: '#1677ff',
            marginBottom: 12,
          }}
        >
          <FileProtectOutlined style={{ fontSize: 28, color: '#fff' }} />
        </div>
        {contract.company_name && (
          <Title level={4} style={{ margin: 0, color: '#595959' }}>
            {contract.company_name}
          </Title>
        )}
        <Title level={2} style={{ margin: '8px 0 0' }}>
          {contract.title || contract.template_name || 'Contract Document'}
        </Title>
        {documentTypeLabel && (
          <div style={{ marginTop: 8 }}>
            <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px' }}>
              {documentTypeLabel}
            </Tag>
          </div>
        )}
        {contract.client_name && (
          <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
            Prepared for: <strong>{contract.client_name}</strong>
          </Text>
        )}
      </div>

      {/* ── Already Signed Banner ── */}
      {isAlreadySigned && !sigSuccess && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleFilled style={{ color: '#52c41a' }} />}
          message="This document has already been signed."
          description={
            contract.existing_signatures?.length ? (
              <div style={{ marginTop: 8 }}>
                {contract.existing_signatures.map((sig, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <strong>{sig.signer_name}</strong>
                    {sig.signer_role && ` (${sig.signer_role})`} —{' '}
                    <Text type="secondary">{formatDate(sig.signed_at)}</Text>
                  </div>
                ))}
              </div>
            ) : undefined
          }
          style={{ marginBottom: 24, borderRadius: 8 }}
        />
      )}

      {/* ── PDF Viewer ── */}
      {contract.file_url && (
        <Card
          style={{
            marginBottom: 24,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}
          bodyStyle={{ padding: 0 }}
        >
          <iframe
            src={contract.file_url}
            title="Contract Document"
            style={{
              width: '100%',
              height: 520,
              border: 'none',
              display: 'block',
            }}
          />
        </Card>
      )}

      {/* ── Signing Section ── */}
      {contract.requires_signature && !isAlreadySigned && (
        <Card
          style={{
            borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}
        >
          <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
            Sign This Document
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 20 }}>
            By signing, you confirm that you have read and agree to the terms of this document.
          </Paragraph>

          <Divider style={{ margin: '0 0 20px' }} />

          {signMutation.isError && (
            <Alert
              type="error"
              message="Signing failed. Please try again."
              style={{ marginBottom: 16, borderRadius: 8 }}
              closable
            />
          )}

          <Form layout="vertical">
            <Form.Item
              label={<Text strong>Full Name</Text>}
              validateStatus={nameError ? 'error' : undefined}
              help={nameError}
              required
            >
              <Input
                size="large"
                placeholder="Enter your full name"
                value={signerName}
                onChange={(e) => {
                  setSignerName(e.target.value);
                  if (e.target.value.trim()) setNameError(undefined);
                }}
                style={{ borderRadius: 8 }}
              />
            </Form.Item>
          </Form>

          <Button
            type="primary"
            size="large"
            icon={<EditOutlined />}
            onClick={handleSignClick}
            loading={signMutation.isPending}
            block
            style={{
              height: 52,
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              marginTop: 8,
            }}
          >
            Sign Contract
          </Button>
        </Card>
      )}

      {/* ── No signature required notice ── */}
      {!contract.requires_signature && (
        <Alert
          type="info"
          showIcon
          message="No signature required for this document."
          style={{ borderRadius: 8 }}
        />
      )}

      {/* ── Signature Pad Modal ── */}
      <WMSignaturePad
        open={sigPadOpen}
        onClose={() => setSigPadOpen(false)}
        onSave={handleSignatureSave}
      />
    </PageShell>
  );
};

export default ContractSigning;
