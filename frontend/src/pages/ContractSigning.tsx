/**
 * ContractSigning - Public (no-auth) tablet/mobile signing page.
 *
 * Route: /sign/:token
 * Renders PDF with pdfjs and overlays signature/initial fields at
 * positions defined in the template's field mappings.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  Result,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleFilled,
  CloseCircleOutlined,
  EditOutlined,
  FileProtectOutlined,
  FormOutlined,
  MailOutlined,
  SendOutlined,
} from '@ant-design/icons';
import * as pdfjs from 'pdfjs-dist';
import { signingService } from '../services/contractService';
import api from '../services/api';
import type { ContractViewData, SignatureFieldPlacement } from '../types/contract';
import WMSignaturePad from '../components/water-mitigation/pdf-annotator/WMSignaturePad';

const { Title, Text, Paragraph } = Typography;

// Setup pdfjs worker
if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  authorization: 'Authorization to Work',
  certificate_of_satisfaction: 'Certificate of Satisfaction',
  certificate_of_completion: 'Certificate of Completion',
  scope_of_work: 'Scope of Work',
  lien_waiver: 'Lien Waiver',
  change_order: 'Change Order',
  other: 'Other',
};

const FIELD_TYPE_LABELS: Record<string, string> = {
  signature: 'Sign Here',
  initial: 'Initial Here',
  date_signed: 'Date',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getErrorDisplay(err: unknown) {
  const status = (err as any)?.response?.status;
  if (status === 410)
    return { status: 'warning' as const, title: 'Link Expired', subTitle: 'This signing link has expired. Please contact the company for a new link.' };
  if (status === 404)
    return { status: 'error' as const, title: 'Link Not Found', subTitle: 'This signing link is invalid. Please check the URL and try again.' };
  return { status: 'error' as const, title: 'Something Went Wrong', subTitle: 'Unable to load the document. Please try again or contact the company.' };
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface RenderedPage {
  dataUrl: string;
  width: number;
  height: number;
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

// ── Send Signed Copy Card ────────────────────────────────────────────────────

const SendCopyCard: React.FC<{ token: string; clientEmail?: string }> = ({ token, clientEmail }) => {
  const [email, setEmail] = useState(clientEmail || '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    const emails = email.split(/[,;\n]+/).map(e => e.trim()).filter(e => e && e.includes('@'));
    if (emails.length === 0) {
      message.warning('Please enter a valid email address.');
      return;
    }
    setSending(true);
    try {
      await signingService.sendSignedCopy(token, emails);
      message.success(`Signed copy sent to ${emails.join(', ')}`);
      setSent(true);
    } catch {
      message.error('Failed to send email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      size="small"
      style={{ marginTop: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <MailOutlined style={{ color: '#1677ff' }} />
        <Text strong>Send a signed copy via email</Text>
      </div>
      {sent ? (
        <Alert type="success" message={`Signed copy sent to ${email}`} showIcon />
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="Enter email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onPressEnter={handleSend}
            disabled={sending}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={sending}
          >
            Send
          </Button>
        </div>
      )}
      {!sent && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          Separate multiple emails with commas.
        </Text>
      )}
    </Card>
  );
};

// ── Signature Field Overlay ───────────────────────────────────────────────────

interface SignatureOverlayProps {
  field: SignatureFieldPlacement;
  containerWidth: number;
  containerHeight: number;
  capturedImage?: string;
  onClick: () => void;
  disabled?: boolean;
}

const SignatureFieldOverlay: React.FC<SignatureOverlayProps> = ({
  field, containerWidth, containerHeight, capturedImage, onClick, disabled,
}) => {
  const left = field.x * containerWidth;
  const top = field.y * containerHeight;
  const width = field.width * containerWidth;
  const height = field.height * containerHeight;

  const isSig = field.fieldType === 'signature' || field.fieldType === 'initial';
  const label = FIELD_TYPE_LABELS[field.fieldType] || field.label;

  return (
    <div
      style={{
        position: 'absolute',
        left, top, width, height,
        border: capturedImage
          ? '2px solid #52c41a'
          : '2px dashed #f5222d',
        borderRadius: 4,
        background: capturedImage
          ? 'rgba(82, 196, 26, 0.05)'
          : 'rgba(245, 34, 34, 0.06)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        transition: 'all 0.2s',
      }}
      onClick={disabled ? undefined : onClick}
    >
      {capturedImage ? (
        <img
          src={capturedImage}
          alt="Signature"
          style={{
            maxWidth: '95%',
            maxHeight: '90%',
            objectFit: 'contain',
          }}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: 4 }}>
          {isSig && <EditOutlined style={{ fontSize: 16, color: '#f5222d', display: 'block', marginBottom: 2 }} />}
          <span style={{ fontSize: 11, color: '#f5222d', fontWeight: 500 }}>
            {label}
          </span>
        </div>
      )}
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

const ContractSigning: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [sigSuccess, setSigSuccess] = useState(false);
  // Map of fieldId -> captured signature/initial image (base64)
  const [capturedSignatures, setCapturedSignatures] = useState<Record<string, string>>({});
  // Remember last drawn signature/initial for reuse
  const [lastSignatureImage, setLastSignatureImage] = useState<string | null>(null);
  const [lastInitialImage, setLastInitialImage] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  // PDF rendering
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const containerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [containerWidths, setContainerWidths] = useState<number[]>([]);

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

  const sigFields = contract?.signature_fields || [];
  const hasPositionedFields = sigFields.length > 0;

  // ── Load PDF pages ─────────────────────────────────────────────────────────

  const renderPdf = useCallback(async (pdfUrl: string) => {
    setPdfLoading(true);
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const pages: RenderedPage[] = [];
      const RENDER_SCALE = 2;

      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push({
          dataUrl: canvas.toDataURL('image/png'),
          width: viewport.width / RENDER_SCALE,
          height: viewport.height / RENDER_SCALE,
        });
      }
      setRenderedPages(pages);
    } catch (err) {
      console.error('Failed to render PDF:', err);
    } finally {
      setPdfLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!contract || !hasPositionedFields) return;
    const pdfUrl = contract.filled_pdf_url || contract.file_url;
    if (pdfUrl) {
      const baseURL = api.defaults.baseURL || '';
      const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : `${baseURL}${pdfUrl}`;
      renderPdf(fullUrl);
    }
  }, [contract, hasPositionedFields, renderPdf]);

  // Measure container widths for responsive overlay positioning
  useEffect(() => {
    if (renderedPages.length === 0) return;
    const measure = () => {
      const widths = containerRefs.current.map(el => el?.clientWidth || 0);
      setContainerWidths(widths);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [renderedPages]);

  // ── Mutation ─────────────────────────────────────────────────────────────────

  const signMutation = useMutation({
    mutationFn: (payload: {
      signatureImage: string;
      signatureType?: 'drawn' | 'typed';
      typedName?: string;
      signatureFields?: Record<string, string>;
    }) =>
      signingService.sign(token!, {
        signer_name: signerName.trim(),
        signer_role: 'homeowner',
        signature_image: payload.signatureImage,
        signature_type: payload.signatureType || 'drawn',
        typed_name: payload.typedName,
        signature_fields: payload.signatureFields,
        consent_agreed: true,
        consent_text: 'I have reviewed the document and agree to sign it electronically. I understand that my electronic signature has the same legal effect as a handwritten signature.',
      }),
    onSuccess: () => setSigSuccess(true),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleFieldClick = (fieldId: string) => {
    setNameError(undefined);
    const field = sigFields.find(f => f.id === fieldId);
    if (field?.fieldType === 'date_signed') {
      const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      setCapturedSignatures(prev => ({ ...prev, [fieldId]: today }));
      return;
    }
    const alreadyFilled = !!capturedSignatures[fieldId];
    if (alreadyFilled) {
      // Re-open pad to redraw
      setActiveFieldId(fieldId);
      setSigPadOpen(true);
      return;
    }
    // Reuse previous signature/initial if already drawn
    const previousImage = field?.fieldType === 'initial'
      ? lastInitialImage
      : lastSignatureImage;
    if (previousImage) {
      setCapturedSignatures(prev => ({ ...prev, [fieldId]: previousImage }));
      return;
    }
    // First time — open signature pad
    setActiveFieldId(fieldId);
    setSigPadOpen(true);
  };

  const handleSignatureSave = (
    imageData: string,
    signatureType?: 'drawn' | 'typed',
    typedName?: string,
  ) => {
    setSigPadOpen(false);
    if (activeFieldId) {
      // Remember for reuse on same-type fields
      const field = sigFields.find(f => f.id === activeFieldId);
      if (field?.fieldType === 'initial') {
        setLastInitialImage(imageData);
      } else {
        setLastSignatureImage(imageData);
      }
      setCapturedSignatures(prev => ({
        ...prev,
        [activeFieldId]: imageData,
      }));
      setActiveFieldId(null);
    }
  };

  // Legacy: single-signature flow (no positioned fields)
  const handleLegacySignClick = () => {
    setNameError(undefined);
    setActiveFieldId(null);
    setSigPadOpen(true);
  };

  const handleLegacySignatureSave = (
    imageData: string,
    signatureType?: 'drawn' | 'typed',
    typedName?: string,
  ) => {
    setSigPadOpen(false);
    signMutation.mutate({ signatureImage: imageData, signatureType, typedName });
  };

  const handleSubmitAll = () => {
    // Check all required signature/initial fields are filled
    const requiredFields = sigFields.filter(
      f => f.fieldType === 'signature' || f.fieldType === 'initial'
    );
    const missing = requiredFields.filter(f => !capturedSignatures[f.id]);
    if (missing.length > 0) {
      message.warning(`Please complete all ${missing.length} signature/initial field(s).`);
      return;
    }

    // Use first signature image as the primary
    const firstSig = requiredFields.find(f => f.fieldType === 'signature' && capturedSignatures[f.id]);
    const primaryImage = firstSig
      ? capturedSignatures[firstSig.id]
      : Object.values(capturedSignatures)[0] || '';

    signMutation.mutate({
      signatureImage: primaryImage,
      signatureFields: capturedSignatures,
    });
  };

  // ── Render states ─────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <PageShell>
        <Result status="error" title="Invalid Link" subTitle="No signing token was found in this URL." />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}><Text type="secondary">Loading document...</Text></div>
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

  if (contract.status === 'voided') {
    return (
      <PageShell>
        <Result status="warning" title="Contract Voided" subTitle="This contract has been voided and is no longer valid for signing." />
      </PageShell>
    );
  }

  // Success screen
  if (sigSuccess) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', paddingTop: 48 }}>
          <CheckCircleFilled style={{ fontSize: 72, color: '#52c41a', marginBottom: 16 }} />
          <Title level={2} style={{ color: '#262626' }}>Document Signed</Title>
          <Paragraph type="secondary" style={{ fontSize: 16, maxWidth: 400, margin: '0 auto' }}>
            Thank you, <strong>{signerName}</strong>. Your signature has been recorded successfully.
          </Paragraph>
          {contract.company_name && (
            <Paragraph type="secondary" style={{ marginTop: 12 }}>
              A copy will be retained by <strong>{contract.company_name}</strong>.
            </Paragraph>
          )}
          <SendCopyCard token={token!} clientEmail={contract.client_email} />
        </div>
      </PageShell>
    );
  }

  const isAlreadySigned = contract.status === 'signed' || (contract.existing_signatures?.length ?? 0) > 0;
  const documentTypeLabel = DOCUMENT_TYPE_LABELS[contract.document_type ?? ''] ?? contract.document_type ?? '';

  // Count completed signature fields
  const requiredSigFields = sigFields.filter(f => f.fieldType === 'signature' || f.fieldType === 'initial');
  const completedCount = requiredSigFields.filter(f => capturedSignatures[f.id]).length;

  return (
    <PageShell>
      {/* ── Company / Header ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: '50%',
            backgroundColor: '#1677ff', marginBottom: 12,
          }}
        >
          <FileProtectOutlined style={{ fontSize: 28, color: '#fff' }} />
        </div>
        {contract.company_name && (
          <Title level={4} style={{ margin: 0, color: '#595959' }}>{contract.company_name}</Title>
        )}
        <Title level={2} style={{ margin: '8px 0 0' }}>
          {contract.title || contract.template_name || 'Contract Document'}
        </Title>
        {documentTypeLabel && (
          <div style={{ marginTop: 8 }}>
            <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px' }}>{documentTypeLabel}</Tag>
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

      {/* Send signed copy (for already signed contracts) */}
      {isAlreadySigned && !sigSuccess && (
        <SendCopyCard token={token!} clientEmail={contract.client_email} />
      )}

      {/* Name input removed from here — moved into submit section */}

      {/* ── PDF Loading ── */}
      {hasPositionedFields && pdfLoading && (
        <Card style={{ marginBottom: 24, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#595959', fontSize: 15 }}>Loading document...</div>
            <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 13 }}>Please wait while the document is being prepared.</div>
          </div>
        </Card>
      )}

      {/* ── PDF with Signature Field Overlays ── */}
      {pdfLoading ? null : hasPositionedFields && renderedPages.length > 0 ? (
        <div style={{ marginBottom: 24 }}>
          {renderedPages.map((page, pageIdx) => {
            const fieldsOnPage = sigFields.filter(f => f.pageIndex === pageIdx);
            const containerWidth = containerWidths[pageIdx] || page.width;
            const scale = containerWidth / page.width;
            const containerHeight = page.height * scale;

            return (
              <div
                key={pageIdx}
                ref={el => { containerRefs.current[pageIdx] = el; }}
                style={{
                  position: 'relative',
                  marginBottom: 16,
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                  background: '#fff',
                }}
              >
                <img
                  src={page.dataUrl}
                  alt={`Page ${pageIdx + 1}`}
                  style={{ width: '100%', display: 'block' }}
                />
                {/* Signature field overlays */}
                {!isAlreadySigned && fieldsOnPage.map(field => (
                  <SignatureFieldOverlay
                    key={field.id}
                    field={field}
                    containerWidth={containerWidth}
                    containerHeight={containerHeight}
                    capturedImage={
                      field.fieldType === 'date_signed' && capturedSignatures[field.id]
                        ? undefined  // date fields show text, not image
                        : capturedSignatures[field.id]
                    }
                    onClick={() => handleFieldClick(field.id)}
                    disabled={isAlreadySigned}
                  />
                ))}
                {/* Date field text overlays */}
                {!isAlreadySigned && fieldsOnPage
                  .filter(f => f.fieldType === 'date_signed' && capturedSignatures[f.id])
                  .map(field => (
                    <div
                      key={`date-${field.id}`}
                      style={{
                        position: 'absolute',
                        left: field.x * containerWidth,
                        top: field.y * containerHeight,
                        width: field.width * containerWidth,
                        height: field.height * containerHeight,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 500,
                        color: '#000',
                        border: '2px solid #52c41a',
                        borderRadius: 4,
                        background: 'rgba(82, 196, 26, 0.05)',
                        pointerEvents: 'none',
                      }}
                    >
                      {capturedSignatures[field.id]}
                    </div>
                  ))
                }
              </div>
            );
          })}

        </div>
      ) : (
        /* Fallback: iframe for contracts without positioned signature fields */
        (contract.filled_pdf_url || contract.file_url) && (() => {
          const pdfSrc = contract.filled_pdf_url || contract.file_url || '';
          const baseURL = api.defaults.baseURL || '';
          const fullSrc = pdfSrc.startsWith('http') ? pdfSrc : `${baseURL}${pdfSrc}`;
          return (
            <Card
              style={{ marginBottom: 24, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}
              styles={{ body: { padding: 0 } }}
            >
              <iframe
                src={`${fullSrc}#toolbar=0&navpanes=0`}
                title="Contract Document"
                style={{ width: '100%', height: 520, border: 'none', display: 'block' }}
              />
            </Card>
          );
        })()
      )}

      {/* ── Submit Button (positioned fields mode) ── */}
      {hasPositionedFields && contract.requires_signature && !isAlreadySigned && (
        <Card style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text strong style={{ fontSize: 15 }}>
              <FormOutlined style={{ marginRight: 8 }} />
              Signatures
            </Text>
            {requiredSigFields.length > 0 && (
              <Tag color={completedCount === requiredSigFields.length ? 'green' : 'orange'}>
                {completedCount} / {requiredSigFields.length} completed
              </Tag>
            )}
          </div>
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            Click on each signature/initial field on the document above, then submit.
          </Paragraph>
          {signMutation.isError && (
            <Alert type="error" message="Signing failed. Please try again." style={{ marginBottom: 16, borderRadius: 8 }} closable />
          )}
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
            <Checkbox
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            >
              <Text style={{ fontSize: 13 }}>
                I have reviewed the document and agree to sign it electronically.
                I understand that my electronic signature has the same legal effect as a handwritten signature.
              </Text>
            </Checkbox>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<EditOutlined />}
            onClick={handleSubmitAll}
            loading={signMutation.isPending}
            disabled={completedCount < requiredSigFields.length || !consentChecked}
            block
            style={{ height: 52, borderRadius: 8, fontSize: 16, fontWeight: 600 }}
          >
            Submit Signatures
          </Button>
        </Card>
      )}

      {/* ── Legacy: Signing Section (no positioned fields) ── */}
      {!hasPositionedFields && contract.requires_signature && !isAlreadySigned && (
        <Card style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>Sign This Document</Title>
          <Paragraph type="secondary" style={{ marginBottom: 20 }}>
            By signing, you confirm that you have read and agree to the terms of this document.
          </Paragraph>
          <Divider style={{ margin: '0 0 20px' }} />
          {signMutation.isError && (
            <Alert type="error" message="Signing failed. Please try again." style={{ marginBottom: 16, borderRadius: 8 }} closable />
          )}
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
            <Checkbox
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            >
              <Text style={{ fontSize: 13 }}>
                I have reviewed the document and agree to sign it electronically.
                I understand that my electronic signature has the same legal effect as a handwritten signature.
              </Text>
            </Checkbox>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<EditOutlined />}
            onClick={handleLegacySignClick}
            loading={signMutation.isPending}
            disabled={!consentChecked}
            block
            style={{ height: 52, borderRadius: 8, fontSize: 16, fontWeight: 600, marginTop: 8 }}
          >
            Sign Contract
          </Button>
        </Card>
      )}

      {/* ── No signature required notice ── */}
      {!contract.requires_signature && (
        <Alert type="info" showIcon message="No signature required for this document." style={{ borderRadius: 8 }} />
      )}

      {/* ── Signature Pad Modal ── */}
      <WMSignaturePad
        open={sigPadOpen}
        onClose={() => { setSigPadOpen(false); setActiveFieldId(null); }}
        onSave={hasPositionedFields ? handleSignatureSave : handleLegacySignatureSave}
        defaultName={signerName}
        initialImage={activeFieldId ? capturedSignatures[activeFieldId] : undefined}
      />
    </PageShell>
  );
};

export default ContractSigning;
