/**
 * FieldContractSigning - iPad-optimized field contract signing page.
 *
 * Route: /field-sign (Public, no auth)
 * Flow: Company Select -> Contract List -> Field Edit + PDF + Sign -> Email Send
 */

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Divider,
  Empty,
  Input,
  Result,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  EditOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { fieldSigningService, signingService } from '../services/contractService';
import type {
  ContractInstance,
  ContractTemplate,
  ContractFieldViewData,
  FieldSignCompany,
  FieldMappingItem,
  SignatureFieldPlacement,
} from '../types/contract';
import WMSignaturePad from '../components/water-mitigation/pdf-annotator/WMSignaturePad';
import ContractSignatureOverlay from '../components/contract/ContractSignatureOverlay';
import { usePdfRenderer } from '../components/contract/usePdfRenderer';
import AddressAutocomplete from '../components/common/AddressAutocomplete';

const { Title, Text, Paragraph } = Typography;

// ── Constants ─────────────────────────────────────────────────────────────────

type FlowStep = 'company-select' | 'contract-list' | 'field-edit-sign' | 'post-sign';

const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  sent: 'processing',
  viewed: 'warning',
  signed: 'success',
  voided: 'error',
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  authorization: 'Authorization',
  certificate_of_satisfaction: 'Certificate of Satisfaction',
  certificate_of_completion: 'Certificate of Completion',
  scope_of_work: 'Scope of Work',
  lien_waiver: 'Lien Waiver',
  change_order: 'Change Order',
  other: 'Other',
};

// Address fields and their siblings for auto-fill
const ADDRESS_FIELD_GROUPS: Record<string, {
  siblings: string[];
  map: (addr: any) => Record<string, string>;
}> = {
  'client.address': {
    siblings: ['client.city', 'client.state', 'client.zipcode', 'client.full_address'],
    map: (a) => ({
      'client.address': a.streetAddress,
      'client.city': a.city,
      'client.state': a.state,
      'client.zipcode': a.zip,
      'client.full_address': `${a.streetAddress}, ${a.city}, ${a.state} ${a.zip}`,
    }),
  },
  'wm_job.property_address': {
    siblings: ['wm_job.property_street', 'wm_job.property_city', 'wm_job.property_state', 'wm_job.property_zipcode'],
    map: (a) => ({
      'wm_job.property_address': `${a.streetAddress}, ${a.city}, ${a.state} ${a.zip}`,
      'wm_job.property_street': a.streetAddress,
      'wm_job.property_city': a.city,
      'wm_job.property_state': a.state,
      'wm_job.property_zipcode': a.zip,
    }),
  },
  'company.address': {
    siblings: [],
    map: (a) => ({
      'company.address': `${a.streetAddress}, ${a.city}, ${a.state} ${a.zip}`,
    }),
  },
};

const isAddressField = (key: string) =>
  key in ADDRESS_FIELD_GROUPS || key.includes('address') || key.includes('street');
const isDateField = (key: string) =>
  (key.includes('date') || key.includes('_at')) &&
  !key.startsWith('signature.') &&
  !key.startsWith('initial.') &&
  !key.startsWith('date_signed.');

// ── Page Shell ────────────────────────────────────────────────────────────────

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
    <div style={{ width: '100%', maxWidth: 800 }}>{children}</div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

const FieldContractSigning: React.FC = () => {
  const [step, setStep] = useState<FlowStep>('company-select');
  const [selectedCompany, setSelectedCompany] = useState<FieldSignCompany | null>(null);
  const [selectedContract, setSelectedContract] = useState<ContractInstance | null>(null);
  const [contractToken, setContractToken] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fieldsLocked, setFieldsLocked] = useState(false);

  // ── Step 1: Company Select ──────────────────────────────────────────────────

  const companiesQuery = useQuery({
    queryKey: ['field-sign-companies'],
    queryFn: () => fieldSigningService.getCompanies(),
    staleTime: 60_000,
  });

  const handleCompanySelect = (company: FieldSignCompany) => {
    setSelectedCompany(company);
    setStep('contract-list');
    setSearch('');
  };

  // ── Step 2: Contract List ───────────────────────────────────────────────────

  const contractsQuery = useQuery({
    queryKey: ['field-sign-contracts', selectedCompany?.id],
    queryFn: () => fieldSigningService.getCompanyContracts(selectedCompany!.id),
    enabled: !!selectedCompany,
    staleTime: 30_000,
  });

  const handleContractSelect = (contract: ContractInstance) => {
    setSelectedContract(contract);
    setContractToken(contract.signing_token || null);
    if (contract.status === 'signed') {
      setStep('post-sign');
    } else {
      setStep('field-edit-sign');
    }
  };

  // ── Navigation ──────────────────────────────────────────────────────────────

  const goBack = () => {
    if (step === 'contract-list') {
      setStep('company-select');
      setSelectedCompany(null);
    } else if (step === 'field-edit-sign' || step === 'post-sign') {
      setStep('contract-list');
      setSelectedContract(null);
      setContractToken(null);
    }
  };

  const goToStart = () => {
    setStep('company-select');
    setSelectedCompany(null);
    setSelectedContract(null);
    setContractToken(null);
    setSearch('');
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageShell>
      {step !== 'company-select' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={goBack}
            style={{ fontSize: 16, height: 48, paddingLeft: 0 }}
          >
            Back
          </Button>
          {step === 'field-edit-sign' && fieldsLocked && (
            <Button
              icon={<EditOutlined />}
              onClick={() => setFieldsLocked(false)}
            >
              Edit Fields
            </Button>
          )}
        </div>
      )}

      {step === 'company-select' && (
        <CompanySelectStep
          companies={companiesQuery.data?.companies || []}
          loading={companiesQuery.isLoading}
          search={search}
          onSearchChange={setSearch}
          onSelect={handleCompanySelect}
        />
      )}

      {step === 'contract-list' && selectedCompany && (
        <ContractListStep
          company={selectedCompany}
          contracts={contractsQuery.data?.contracts || []}
          loading={contractsQuery.isLoading}
          search={search}
          onSearchChange={setSearch}
          onSelect={handleContractSelect}
          onRefresh={() => contractsQuery.refetch()}
        />
      )}

      {step === 'field-edit-sign' && contractToken && (
        <FieldEditSignStep
          token={contractToken}
          onSigned={() => setStep('post-sign')}
          fieldsLocked={fieldsLocked}
          setFieldsLocked={setFieldsLocked}
        />
      )}

      {step === 'post-sign' && contractToken && (
        <PostSignStep
          token={contractToken}
          contractTitle={selectedContract?.title || ''}
          companyName={selectedCompany?.name || ''}
          onDone={goToStart}
        />
      )}
    </PageShell>
  );
};

// ── Step 1: Company Select ────────────────────────────────────────────────────

const CompanySelectStep: React.FC<{
  companies: FieldSignCompany[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (c: FieldSignCompany) => void;
}> = ({ companies, loading, search, onSearchChange, onSelect }) => {
  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>Select Company</Title>
        <Text type="secondary">Choose a company to view contracts</Text>
      </div>

      <Input
        prefix={<SearchOutlined />}
        placeholder="Search companies..."
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        style={{ marginBottom: 16, height: 48, fontSize: 16, borderRadius: 8 }}
        allowClear
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      ) : filtered.length === 0 ? (
        <Empty description="No companies found" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(c => (
            <Card
              key={c.id}
              hoverable
              onClick={() => onSelect(c)}
              style={{
                borderRadius: 12,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
              bodyStyle={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div>
                <Text strong style={{ fontSize: 18 }}>{c.name}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 14 }}>
                  {c.template_count} template{c.template_count !== 1 ? 's' : ''}
                </Text>
              </div>
              <ArrowLeftOutlined style={{ transform: 'rotate(180deg)', fontSize: 18, color: '#8c8c8c' }} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

// ── Step 2: Contract List ─────────────────────────────────────────────────────

const ContractListStep: React.FC<{
  company: FieldSignCompany;
  contracts: ContractInstance[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (c: ContractInstance) => void;
  onRefresh: () => void;
}> = ({ company, contracts, loading, search, onSearchChange, onSelect, onRefresh }) => {
  const [showTemplates, setShowTemplates] = useState(false);
  const [creating, setCreating] = useState(false);

  // Template list query
  const templatesQuery = useQuery({
    queryKey: ['field-sign-templates', company.id],
    queryFn: () => fieldSigningService.getCompanyTemplates(company.id),
    enabled: showTemplates,
  });

  const handleCreateFromTemplate = async (template: ContractTemplate) => {
    setCreating(true);
    try {
      const result = await fieldSigningService.createContract({
        template_id: template.id,
        company_id: company.id,
      });
      message.success('Contract created');
      setShowTemplates(false);
      onRefresh();
      // Select the newly created contract
      if (result?.signing_token) {
        onSelect(result);
      }
    } catch {
      message.error('Failed to create contract');
    } finally {
      setCreating(false);
    }
  };

  const filtered = contracts.filter(c => {
    const q = search.toLowerCase();
    return (
      (c.title || '').toLowerCase().includes(q) ||
      (c.client_name || '').toLowerCase().includes(q) ||
      (c.template_name || '').toLowerCase().includes(q)
    );
  });

  const pending = filtered.filter(c => c.status !== 'signed');
  const signed = filtered.filter(c => c.status === 'signed');

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>{company.name}</Title>
        <Text type="secondary">Select a contract or create a new one</Text>
      </div>

      {/* New Contract Button */}
      <Button
        type="primary"
        icon={<PlusOutlined />}
        block
        onClick={() => setShowTemplates(!showTemplates)}
        style={{ height: 52, fontSize: 16, borderRadius: 8, marginBottom: 16 }}
      >
        New Contract
      </Button>

      {/* Template Selection */}
      {showTemplates && (
        <Card style={{ marginBottom: 20, borderRadius: 12, border: '2px solid #1677ff' }}>
          <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 12 }}>
            Select a Template
          </Text>
          {templatesQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          ) : !templatesQuery.data?.templates?.length ? (
            <Empty description="No templates available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templatesQuery.data.templates.map(t => (
                <Card
                  key={t.id}
                  hoverable
                  size="small"
                  onClick={() => !creating && handleCreateFromTemplate(t)}
                  style={{
                    borderRadius: 8,
                    cursor: creating ? 'wait' : 'pointer',
                    opacity: creating ? 0.6 : 1,
                  }}
                  bodyStyle={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div>
                    <Text strong>{t.name}</Text>
                    {t.document_type && (
                      <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>
                        {DOCUMENT_TYPE_LABELS[t.document_type] || t.document_type}
                      </Tag>
                    )}
                  </div>
                  <PlusOutlined style={{ color: '#1677ff' }} />
                </Card>
              ))}
            </div>
          )}
          {creating && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Spin size="small" /> <Text type="secondary">Creating contract...</Text>
            </div>
          )}
        </Card>
      )}

      <Input
        prefix={<SearchOutlined />}
        placeholder="Search contracts..."
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        style={{ marginBottom: 16, height: 48, fontSize: 16, borderRadius: 8 }}
        allowClear
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      ) : filtered.length === 0 && !showTemplates ? (
        <Empty description="No contracts found. Tap 'New Contract' to create one." />
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <Text strong style={{ fontSize: 14, color: '#8c8c8c', display: 'block', marginBottom: 8 }}>
                PENDING ({pending.length})
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {pending.map(c => (
                  <ContractCard key={c.id} contract={c} onClick={() => onSelect(c)} />
                ))}
              </div>
            </>
          )}
          {signed.length > 0 && (
            <>
              <Text strong style={{ fontSize: 14, color: '#8c8c8c', display: 'block', marginBottom: 8 }}>
                SIGNED ({signed.length})
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {signed.map(c => (
                  <ContractCard key={c.id} contract={c} onClick={() => onSelect(c)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

const ContractCard: React.FC<{ contract: ContractInstance; onClick: () => void }> = ({ contract, onClick }) => {
  // Extract address from prefill_data
  let address = '';
  if (contract.prefill_data) {
    try {
      const prefill = typeof contract.prefill_data === 'string'
        ? JSON.parse(contract.prefill_data)
        : contract.prefill_data;
      address =
        prefill?.client?.full_address ||
        prefill?.client?.address ||
        prefill?.wm_job?.property_address ||
        '';
    } catch { /* ignore */ }
  }

  return (
    <Card
      hoverable
      onClick={onClick}
      style={{ borderRadius: 12, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      bodyStyle={{ padding: '16px 20px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <FileTextOutlined style={{ color: '#1677ff', flexShrink: 0 }} />
            <Text strong style={{ fontSize: 16 }}>{contract.title || contract.template_name || 'Untitled'}</Text>
          </div>
          {contract.client_name && (
            <Text type="secondary" style={{ fontSize: 14, display: 'block' }}>Client: {contract.client_name}</Text>
          )}
          {address && (
            <Text style={{ fontSize: 13, color: '#999', display: 'block', marginTop: 2 }}>{address}</Text>
          )}
        </div>
        <Tag color={STATUS_COLORS[contract.status] || 'default'} style={{ fontSize: 13, margin: 0, flexShrink: 0 }}>
          {contract.status.toUpperCase()}
        </Tag>
      </div>
    </Card>
  );
};

// ── Step 3: Field Edit + PDF + Sign ───────────────────────────────────────────

const FieldEditSignStep: React.FC<{
  token: string;
  onSigned: () => void;
  fieldsLocked: boolean;
  setFieldsLocked: (v: boolean) => void;
}> = ({ token, onSigned, fieldsLocked, setFieldsLocked }) => {
  // Contract data
  const contractQuery = useQuery({
    queryKey: ['field-sign-view', token],
    queryFn: () => fieldSigningService.getContractView(token),
    retry: false,
  });
  const contract = contractQuery.data;

  // Field editing state
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [prefillSaving, setPrefillSaving] = useState(false);

  // Signature state
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [sigSuccess, setSigSuccess] = useState(false);
  const [capturedSignatures, setCapturedSignatures] = useState<Record<string, string>>({});
  const [lastSignatureImage, setLastSignatureImage] = useState<string | null>(null);
  const [lastInitialImage, setLastInitialImage] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  // PDF
  const { pages: renderedPages, loading: pdfLoading, render: renderPdf } = usePdfRenderer();
  const containerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [containerWidths, setContainerWidths] = useState<number[]>([]);

  // Initialize field values from prefill_data
  useEffect(() => {
    if (!contract) return;
    const vals: Record<string, string> = {};
    const prefill = contract.prefill_data || {};
    const mappings = contract.field_mappings || [];
    mappings.forEach(m => {
      const fk = m.fieldKey;
      if (fk.startsWith('signature.') || fk.startsWith('initial.') || fk.startsWith('date_signed.')) return;
      const [cat, key] = fk.split('.', 2);
      if (cat && key) {
        vals[fk] = prefill[cat]?.[key] || '';
      }
    });
    setFieldValues(vals);
  }, [contract]);

  // Deduplicate text fields
  const uniqueTextFields = React.useMemo(() => {
    if (!contract?.field_mappings) return [];
    const seen = new Set<string>();
    return contract.field_mappings.filter(m => {
      const fk = m.fieldKey;
      if (fk.startsWith('signature.') || fk.startsWith('initial.') || fk.startsWith('date_signed.')) return false;
      if (seen.has(fk)) return false;
      seen.add(fk);
      return true;
    });
  }, [contract?.field_mappings]);

  // Group by category
  const fieldGroups = React.useMemo(() => {
    const groups: Record<string, FieldMappingItem[]> = {};
    uniqueTextFields.forEach(f => {
      const cat = f.fieldKey.split('.')[0] || 'other';
      const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
      if (!groups[label]) groups[label] = [];
      groups[label].push(f);
    });
    return groups;
  }, [uniqueTextFields]);

  // Signature fields
  const sigFields: SignatureFieldPlacement[] = contract?.signature_fields || [];

  // Update field value
  const updateField = (key: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  };

  // Address auto-fill handler
  const formatShortAddress = (addr: any) =>
    [addr.streetAddress, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');

  const handleAddressSelect = (fieldKey: string, addr: any) => {
    const group = ADDRESS_FIELD_GROUPS[fieldKey];
    if (!group) {
      updateField(fieldKey, formatShortAddress(addr));
      return;
    }
    const mapped = group.map(addr);
    setFieldValues(prev => ({ ...prev, ...mapped }));
  };

  // Save prefill and lock fields
  const handleConfirmFields = async () => {
    setPrefillSaving(true);
    try {
      // Convert flat fieldValues to nested prefill structure
      const prefill: Record<string, Record<string, string | null>> = {};
      Object.entries(fieldValues).forEach(([key, val]) => {
        const [cat, field] = key.split('.', 2);
        if (!prefill[cat]) prefill[cat] = {};
        prefill[cat][field] = val || null;
      });
      await fieldSigningService.updatePrefill(token, prefill);
      setFieldsLocked(true);
      message.success('Fields saved. PDF updated.');
      // Reload contract data to get new filled PDF
      contractQuery.refetch();
    } catch {
      message.error('Failed to save fields.');
    } finally {
      setPrefillSaving(false);
    }
  };

  // Render PDF when contract data changes and fields are locked
  useEffect(() => {
    if (!contract || !fieldsLocked) return;
    const pdfUrl = contract.filled_pdf_url || contract.file_url;
    if (pdfUrl) renderPdf(pdfUrl);
  }, [contract, fieldsLocked, renderPdf]);

  // Measure container widths
  useEffect(() => {
    if (renderedPages.length === 0) return;
    const measure = () => {
      setContainerWidths(containerRefs.current.map(el => el?.clientWidth || 0));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [renderedPages]);

  // Signature handlers
  const handleFieldClick = (fieldId: string) => {
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
      setActiveFieldId(fieldId);
      setSigPadOpen(true);
      return;
    }
    const previousImage = field?.fieldType === 'initial' ? lastInitialImage : lastSignatureImage;
    if (previousImage) {
      setCapturedSignatures(prev => ({ ...prev, [fieldId]: previousImage }));
      return;
    }
    setActiveFieldId(fieldId);
    setSigPadOpen(true);
  };

  const handleSignatureSave = (imageData: string, signatureType?: 'drawn' | 'typed', typedName?: string) => {
    setSigPadOpen(false);
    if (activeFieldId) {
      const field = sigFields.find(f => f.id === activeFieldId);
      if (field?.fieldType === 'initial') {
        setLastInitialImage(imageData);
      } else {
        setLastSignatureImage(imageData);
      }
      setCapturedSignatures(prev => ({ ...prev, [activeFieldId]: imageData }));
      setActiveFieldId(null);
    }
  };

  // Sign mutation
  const signMutation = useMutation({
    mutationFn: (payload: {
      signatureImage: string;
      signatureType?: 'drawn' | 'typed';
      typedName?: string;
      signatureFields?: Record<string, string>;
    }) =>
      signingService.sign(token, {
        signer_name: signerName.trim(),
        signer_role: 'homeowner',
        signature_image: payload.signatureImage,
        signature_type: payload.signatureType || 'drawn',
        typed_name: payload.typedName,
        signature_fields: payload.signatureFields,
        consent_agreed: true,
        consent_text: 'I have reviewed the document and agree to sign it electronically.',
      }),
    onSuccess: () => {
      setSigSuccess(true);
      onSigned();
    },
  });

  const handleSubmitAll = () => {
    const requiredFields = sigFields.filter(f => f.fieldType === 'signature' || f.fieldType === 'initial');
    const missing = requiredFields.filter(f => !capturedSignatures[f.id]);
    if (missing.length > 0) {
      message.warning(`Please complete all ${missing.length} signature/initial field(s).`);
      return;
    }
    if (!signerName.trim()) {
      message.warning('Please enter your name.');
      return;
    }
    if (!consentChecked) {
      message.warning('Please agree to the electronic signature consent.');
      return;
    }
    const firstSig = requiredFields.find(f => f.fieldType === 'signature' && capturedSignatures[f.id]);
    const primaryImage = firstSig ? capturedSignatures[firstSig.id] : Object.values(capturedSignatures)[0] || '';
    signMutation.mutate({ signatureImage: primaryImage, signatureFields: capturedSignatures });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (contractQuery.isLoading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /><br /><Text type="secondary">Loading contract...</Text></div>;
  }

  if (contractQuery.error || !contract) {
    return <Result status="error" title="Failed to load contract" subTitle="Please try again." />;
  }

  const requiredSigFields = sigFields.filter(f => f.fieldType === 'signature' || f.fieldType === 'initial');
  const completedCount = requiredSigFields.filter(f => capturedSignatures[f.id]).length;

  return (
    <>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          {contract.title || contract.template_name || 'Contract'}
        </Title>
        {contract.document_type && (
          <Tag color="blue" style={{ marginTop: 8, fontSize: 13 }}>
            {DOCUMENT_TYPE_LABELS[contract.document_type] || contract.document_type}
          </Tag>
        )}
        {contract.client_name && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            Client: <strong>{contract.client_name}</strong>
          </Text>
        )}
      </div>

      {/* Field Edit Form */}
      {!fieldsLocked && uniqueTextFields.length > 0 && (
        <Card style={{ marginBottom: 24, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <Title level={5} style={{ marginTop: 0 }}>Fill in Contract Fields</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Complete the fields below, then tap "Confirm" to generate the contract.
          </Text>

          {Object.entries(fieldGroups).map(([groupLabel, fields]) => (
            <div key={groupLabel} style={{ marginBottom: 20 }}>
              <Text strong style={{ fontSize: 14, color: '#1677ff', display: 'block', marginBottom: 8 }}>
                {groupLabel === 'Wm job' ? 'WM Job' : groupLabel}
              </Text>
              {fields.map(f => (
                <div key={f.fieldKey} style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>{f.label}</Text>
                  {isAddressField(f.fieldKey) ? (
                    <AddressAutocomplete
                      value={fieldValues[f.fieldKey] || ''}
                      onChange={(val) => updateField(f.fieldKey, val)}
                      onSelect={(addr) => handleAddressSelect(f.fieldKey, addr)}
                      placeholder={`Enter ${f.label.toLowerCase()}`}
                      style={{ height: 44, fontSize: 16, borderRadius: 6 }}
                    />
                  ) : isDateField(f.fieldKey) ? (
                    <DatePicker
                      value={fieldValues[f.fieldKey] ? dayjs(fieldValues[f.fieldKey], 'MM/DD/YYYY') : null}
                      onChange={(d) => updateField(f.fieldKey, d ? d.format('MM/DD/YYYY') : '')}
                      format="MM/DD/YYYY"
                      style={{ width: '100%', height: 44, fontSize: 16 }}
                    />
                  ) : (
                    <Input
                      value={fieldValues[f.fieldKey] || ''}
                      onChange={e => updateField(f.fieldKey, e.target.value)}
                      placeholder={f.label}
                      style={{ height: 44, fontSize: 16, borderRadius: 6 }}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}

          <Button
            type="primary"
            size="large"
            block
            loading={prefillSaving}
            onClick={handleConfirmFields}
            style={{ height: 52, fontSize: 18, borderRadius: 8, marginTop: 8 }}
          >
            Confirm Fields & Generate PDF
          </Button>
        </Card>
      )}

      {/* PDF Loading */}
      {fieldsLocked && pdfLoading && (
        <Card style={{ marginBottom: 24, borderRadius: 12 }}>
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#595959' }}>Loading document...</div>
          </div>
        </Card>
      )}

      {/* PDF with Signature Overlays */}
      {fieldsLocked && !pdfLoading && renderedPages.length > 0 && (
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
                  width: '100%',
                  marginBottom: 16,
                  borderRadius: 8,
                  overflow: 'hidden',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
                }}
              >
                <img
                  src={page.dataUrl}
                  alt={`Page ${pageIdx + 1}`}
                  style={{ width: '100%', display: 'block' }}
                />
                {fieldsOnPage.map(f => (
                  <ContractSignatureOverlay
                    key={f.id}
                    field={f}
                    containerWidth={containerWidth}
                    containerHeight={containerHeight}
                    capturedImage={capturedSignatures[f.id]}
                    onClick={() => handleFieldClick(f.id)}
                    disabled={signMutation.isPending}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Signature Submission */}
      {fieldsLocked && !pdfLoading && renderedPages.length > 0 && sigFields.length > 0 && (
        <Card style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          {requiredSigFields.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text>
                Signatures: <strong>{completedCount}</strong> / {requiredSigFields.length} completed
              </Text>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Text style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>Your Full Name</Text>
            <Input
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="Enter your full legal name"
              style={{ height: 48, fontSize: 16, borderRadius: 6 }}
            />
          </div>

          <Checkbox
            checked={consentChecked}
            onChange={e => setConsentChecked(e.target.checked)}
            style={{ marginBottom: 16 }}
          >
            <Text style={{ fontSize: 14 }}>
              I agree to sign this document electronically. My electronic signature has the same legal effect as a handwritten signature.
            </Text>
          </Checkbox>

          <Button
            type="primary"
            size="large"
            block
            onClick={handleSubmitAll}
            loading={signMutation.isPending}
            disabled={completedCount < requiredSigFields.length || !signerName.trim() || !consentChecked}
            style={{ height: 52, fontSize: 18, borderRadius: 8 }}
          >
            Submit Signature
          </Button>

          {signMutation.isError && (
            <Alert
              type="error"
              message="Failed to submit signature. Please try again."
              style={{ marginTop: 12 }}
              showIcon
            />
          )}
        </Card>
      )}

      {/* Signature Pad Modal */}
      <WMSignaturePad
        open={sigPadOpen}
        onClose={() => { setSigPadOpen(false); setActiveFieldId(null); }}
        onSave={handleSignatureSave}
      />
    </>
  );
};

// ── Step 4: Post-Sign (Email Send) ────────────────────────────────────────────

const PostSignStep: React.FC<{
  token: string;
  contractTitle: string;
  companyName: string;
  onDone: () => void;
}> = ({ token, contractTitle, companyName, onDone }) => {
  const [email, setEmail] = useState('');
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
      await fieldSigningService.sendEmail(token, emails);
      message.success(`Signed contract sent to ${emails.join(', ')}`);
      setSent(true);
    } catch {
      message.error('Failed to send email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <CheckCircleFilled style={{ fontSize: 72, color: '#52c41a', marginBottom: 16 }} />
      <Title level={2} style={{ color: '#262626' }}>Document Signed</Title>
      <Paragraph type="secondary" style={{ fontSize: 16, maxWidth: 400, margin: '0 auto' }}>
        The contract has been signed successfully.
      </Paragraph>

      <Card
        style={{ marginTop: 32, borderRadius: 12, textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <MailOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <Text strong style={{ fontSize: 16 }}>Send Signed Contract</Text>
        </div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Enter the email address(es) to send the signed contract. The email will include the signed PDF as an attachment.
        </Text>

        {sent ? (
          <Alert type="success" message={`Signed contract sent to ${email}`} showIcon />
        ) : (
          <>
            <Input
              placeholder="Enter email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onPressEnter={handleSend}
              disabled={sending}
              style={{ height: 48, fontSize: 16, borderRadius: 6, marginBottom: 12 }}
            />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              Separate multiple emails with commas.
            </Text>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={sending}
              block
              style={{ height: 48, fontSize: 16, borderRadius: 8 }}
            >
              Send Email
            </Button>
          </>
        )}
      </Card>

      <Button
        type="default"
        size="large"
        onClick={onDone}
        style={{ marginTop: 24, height: 48, fontSize: 16, borderRadius: 8 }}
        block
      >
        {sent ? 'Done - Return to Home' : 'Skip - Return to Home'}
      </Button>
    </div>
  );
};

export default FieldContractSigning;
