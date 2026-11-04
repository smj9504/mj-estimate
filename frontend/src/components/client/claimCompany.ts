/**
 * The company a document started from a claim goes under, by the kind of
 * work: a pack-out under the claim's moving company, a kitchen under whoever
 * writes the rebuild. Failing that, the claim's only company.
 */
import type { Claim } from '../../types/client';

const onlyCompanyId = (claim: Claim): string | undefined => {
  const companies = claim.companies ?? [];
  if (companies.length === 1) return companies[0].id;
  return companies.length === 0 ? claim.company_id : undefined;
};

export const packingCompanyId = (claim: Claim): string | undefined =>
  claim.companies?.find(c => c.role === 'moving')?.id ?? onlyCompanyId(claim);

export const rebuildCompanyId = (claim: Claim): string | undefined =>
  claim.rebuild_estimate_company_id
  ?? claim.companies?.find(c => c.role === 'reconstruction')?.id
  ?? onlyCompanyId(claim);
