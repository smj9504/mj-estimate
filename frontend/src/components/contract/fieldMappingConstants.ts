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
  // Meta
  { key: 'meta.current_date', label: 'Current Date', category: 'Meta' },
  { key: 'meta.contract_number', label: 'Contract Number', category: 'Meta' },
];

/** Color options for field mapping labels */
export const FIELD_COLORS = [
  { label: 'Client', color: '#1890ff' },
  { label: 'Claim', color: '#52c41a' },
  { label: 'Company', color: '#722ed1' },
  { label: 'Meta', color: '#fa8c16' },
];

export const getCategoryColor = (category: string): string => {
  const found = FIELD_COLORS.find(c => c.label === category);
  return found?.color || '#1890ff';
};
