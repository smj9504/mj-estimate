/**
 * Signed contracts of a client's that aren't on a claim yet, usually signed on
 * site. The office checks which claim each belongs to and puts it there, which
 * also finishes the todo asking for that. Shows nothing when there are none.
 */

import React, { useState } from 'react';
import { Button, Select, message } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import ClaimSection from '../client/ClaimSection';
import { Pill } from '../common/ui';
import { CompanyName } from '../packing-estimate/packingUi';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { unassignedContractService } from '../../services/contractService';
import { CLIENT_TODOS_KEY, TODO_BOARD_KEY } from '../../services/todoService';
import type { Claim } from '../../types/client';
import type { ContractInstance } from '../../types/contract';
import CompanySignSheet from './CompanySignSheet';
import { canSignForCompany } from './signatureLines';
import './UnassignedContracts.css';

const claimLabel = (claim: Claim) => {
  const name = claim.claim_number || (claim.claim_type === 'cash' ? 'Cash job' : 'Claim');
  const insurer = claim.claim_type === 'cash' ? null : claim.insurance_company;
  return [name, insurer].filter(Boolean).join(' · ');
};

const ContractRow: React.FC<{
  contract: ContractInstance;
  claims: Claim[];
  onAssign: (contractId: string, claimId: string) => void;
  assigning: boolean;
  onSign: (contract: ContractInstance) => void;
  canSign: boolean;
}> = ({ contract, claims, onAssign, assigning, onSign, canSign }) => {
  const [claimId, setClaimId] = useState<string | undefined>(claims.length === 1 ? claims[0].id : undefined);
  const signer = contract.signatures?.[0]?.signer_name;
  const meta = [
    contract.signed_at ? `Signed ${dayjs(contract.signed_at).format('MMM D, YYYY')}` : null,
    signer ? `by ${signer}` : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="uc-row">
      <div className="uc-row-main">
        <a
          className="ui-ink-link uc-row-title"
          href={`${api.defaults.baseURL || ''}/api/contracts/contracts/${contract.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FilePdfOutlined aria-hidden="true" /> {contract.title || contract.template_name || 'Contract'}
        </a>
        <div className="uc-row-meta">
          <CompanyName id={contract.company_id} name={contract.company_name} />
          {meta && <span>{meta}</span>}
          {!!contract.open_company_lines?.length && <Pill tone="orange">Needs company signature</Pill>}
          {!!contract.open_company_lines?.length && canSign && (
            <Button size="small" onClick={() => onSign(contract)}>Sign for company</Button>
          )}
        </div>
      </div>
      {claims.length > 0 && (
        <div className="uc-row-assign">
          <Select
            aria-label="Claim"
            placeholder="Choose a claim"
            value={claimId}
            onChange={setClaimId}
            options={claims.map(claim => ({ value: claim.id, label: claimLabel(claim) }))}
            className="uc-row-select"
          />
          <Button
            disabled={!claimId}
            loading={assigning}
            onClick={() => claimId && onAssign(contract.id, claimId)}
          >
            Assign
          </Button>
        </div>
      )}
    </div>
  );
};

const UnassignedContracts: React.FC<{ clientId: string; claims: Claim[] }> = ({ clientId, claims }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [signing, setSigning] = useState<ContractInstance | null>(null);
  const { data } = useQuery({
    queryKey: ['contracts-unassigned', clientId],
    queryFn: () => unassignedContractService.list(clientId),
  });

  const assign = useMutation({
    mutationFn: ({ contractId, claimId }: { contractId: string; claimId: string }) =>
      unassignedContractService.assign(contractId, claimId),
    onSuccess: (_, { claimId }) => {
      message.success('Contract assigned to the claim');
      queryClient.invalidateQueries({ queryKey: ['contracts-unassigned', clientId] });
      queryClient.invalidateQueries({ queryKey: ['contract-dashboard', claimId] });
      queryClient.invalidateQueries({ queryKey: TODO_BOARD_KEY });
      queryClient.invalidateQueries({ queryKey: [CLIENT_TODOS_KEY] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.detail || "Couldn't assign the contract");
    },
  });

  const contracts = data?.contracts ?? [];
  if (contracts.length === 0) return null;

  return (
    <ClaimSection title="Signed contracts to assign" count={contracts.length} size="page" className="uc-section">
      {claims.length === 0 && (
        <p className="uc-note">This client has no claim yet. Add one below, then assign the contract to it.</p>
      )}
      {contracts.map(contract => (
        <ContractRow
          key={contract.id}
          contract={contract}
          claims={claims}
          assigning={assign.isPending && assign.variables?.contractId === contract.id}
          onAssign={(contractId, claimId) => assign.mutate({ contractId, claimId })}
          onSign={setSigning}
          canSign={canSignForCompany(user, contract.company_id)}
        />
      ))}
      {signing && <CompanySignSheet contract={signing} onClose={() => setSigning(null)} />}
    </ClaimSection>
  );
};

export default UnassignedContracts;
