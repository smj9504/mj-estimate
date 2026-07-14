/**
 * Available fields for contract template field mapping.
 * Organized by category for the properties panel dropdown.
 */

import type { AvailableField } from '../../types/contract';

export const AVAILABLE_FIELDS: AvailableField[] = [
  // Client
  { key: 'client.display_name', label: 'Client Name (Primary Owner)', category: 'Client' },
  { key: 'client.address', label: 'Address', category: 'Client' },
  { key: 'client.city', label: 'City', category: 'Client' },
  { key: 'client.state', label: 'State', category: 'Client' },
  { key: 'client.zipcode', label: 'Zip Code', category: 'Client' },
  { key: 'client.phone', label: 'Phone', category: 'Client' },
  { key: 'client.email', label: 'Email', category: 'Client' },
  { key: 'client.full_address', label: 'Full Address', category: 'Client' },
  // Claim
  { key: 'claim.claim_number', label: 'Claim Number', category: 'Claim' },
  { key: 'claim.insurance_company', label: 'Insurance Company', category: 'Claim' },
  { key: 'claim.insurance_policy_number', label: 'Policy Number', category: 'Claim' },
  { key: 'claim.date_of_loss', label: 'Date of Loss', category: 'Claim' },
  { key: 'claim.loss_description', label: 'Loss Description', category: 'Claim' },
  { key: 'claim.adjuster_name', label: 'Adjuster Name', category: 'Claim' },
  { key: 'claim.adjuster_phone', label: 'Adjuster Phone', category: 'Claim' },
  { key: 'claim.adjuster_email', label: 'Adjuster Email', category: 'Claim' },
  { key: 'claim.deductible', label: 'Deductible', category: 'Claim' },
  // Company
  { key: 'company.name', label: 'Company Name', category: 'Company' },
  { key: 'company.address', label: 'Company Address', category: 'Company' },
  { key: 'company.phone', label: 'Company Phone', category: 'Company' },
  { key: 'company.email', label: 'Company Email', category: 'Company' },
  { key: 'company.license_number', label: 'License Number', category: 'Company' },
  // WM Job
  { key: 'wm_job.property_address', label: 'Property Address (Full)', category: 'WM Job' },
  { key: 'wm_job.property_street', label: 'Property Street', category: 'WM Job' },
  { key: 'wm_job.property_city', label: 'Property City', category: 'WM Job' },
  { key: 'wm_job.property_state', label: 'Property State', category: 'WM Job' },
  { key: 'wm_job.property_zipcode', label: 'Property Zip Code', category: 'WM Job' },
  { key: 'wm_job.homeowner_name', label: 'Homeowner Name', category: 'WM Job' },
  { key: 'wm_job.homeowner_phone', label: 'Homeowner Phone', category: 'WM Job' },
  { key: 'wm_job.homeowner_email', label: 'Homeowner Email', category: 'WM Job' },
  { key: 'wm_job.insurance_company', label: 'Insurance Company (WM)', category: 'WM Job' },
  { key: 'wm_job.insurance_policy_number', label: 'Policy Number (WM)', category: 'WM Job' },
  { key: 'wm_job.claim_number', label: 'Claim Number (WM)', category: 'WM Job' },
  { key: 'wm_job.date_of_loss', label: 'Date of Loss', category: 'WM Job' },
  { key: 'wm_job.date_of_loss_plus_1', label: 'Date of Loss + 1 Day', category: 'WM Job' },
  { key: 'wm_job.mitigation_start_date', label: 'Mitigation Start Date', category: 'WM Job' },
  { key: 'wm_job.mitigation_end_date', label: 'Mitigation End Date', category: 'WM Job' },
  { key: 'wm_job.mitigation_period', label: 'Mitigation Period', category: 'WM Job' },
  { key: 'wm_job.adjuster_name', label: 'Adjuster Name (WM)', category: 'WM Job' },
  { key: 'wm_job.adjuster_phone', label: 'Adjuster Phone (WM)', category: 'WM Job' },
  { key: 'wm_job.adjuster_email', label: 'Adjuster Email (WM)', category: 'WM Job' },
  { key: 'wm_job.today', label: 'Today (Contract Date)', category: 'WM Job' },
  // Meta
  { key: 'meta.current_date', label: 'Current Date', category: 'Meta' },
  { key: 'meta.contract_number', label: 'Contract Number', category: 'Meta' },
  // Signature Fields
  { key: 'signature.homeowner', label: 'Homeowner Signature', category: 'Signature' },
  { key: 'signature.company_rep', label: 'Company Rep Signature', category: 'Signature' },
  { key: 'signature.witness', label: 'Witness Signature', category: 'Signature' },
  { key: 'initial.homeowner', label: 'Homeowner Initials', category: 'Signature' },
  { key: 'initial.company_rep', label: 'Company Rep Initials', category: 'Signature' },
  { key: 'date_signed.homeowner', label: 'Date Signed (Homeowner)', category: 'Signature' },
  { key: 'date_signed.company_rep', label: 'Date Signed (Company)', category: 'Signature' },
];

/** Color options for field mapping labels */
export const FIELD_COLORS = [
  { label: 'Client', color: '#1890ff' },
  { label: 'Claim', color: '#52c41a' },
  { label: 'Company', color: '#722ed1' },
  { label: 'WM Job', color: '#13c2c2' },
  { label: 'Meta', color: '#fa8c16' },
  { label: 'Signature', color: '#f5222d' },
];

/** Determine fieldType and signerRole from a fieldKey like 'signature.homeowner' */
export const parseSignatureFieldKey = (fieldKey: string): { fieldType: 'signature' | 'initial' | 'date_signed'; signerRole: string } | null => {
  const parts = fieldKey.split('.');
  if (parts.length !== 2) return null;
  const [type, role] = parts;
  if (type === 'signature' || type === 'initial' || type === 'date_signed') {
    return { fieldType: type, signerRole: role };
  }
  return null;
};

export const isSignatureField = (fieldKey: string): boolean => {
  return fieldKey.startsWith('signature.') || fieldKey.startsWith('initial.') || fieldKey.startsWith('date_signed.');
};

export const getCategoryColor = (category: string): string => {
  const found = FIELD_COLORS.find(c => c.label === category);
  return found?.color || '#1890ff';
};
