/**
 * Company prices for the bathroom and kitchen cabinet estimates.
 *
 * The defaults live in the backend's pricing.py and are updated there
 * monthly or quarterly. A company may set its own material and/or labor
 * for any price; a side left empty follows the default.
 */

import api from './api';

import type {
  PriceDomain,
  UnitPriceChange,
  UnitPriceHistoryEntry,
  UnitPriceList,
} from '../types/unitPrices';

export type {
  PriceBookSummary,
  PriceDomain,
  PriceKind,
  UnitPriceChange,
  UnitPriceHistoryEntry,
  UnitPriceItem,
  UnitPriceList,
} from '../types/unitPrices';

const BASE_URL = '/api/unit-prices';

export const unitPriceService = {
  async listCompanies(): Promise<{ id: string; name: string }[]> {
    const { data } = await api.get(`${BASE_URL}/companies`);
    return data;
  },

  async list(domain: PriceDomain, companyId: string): Promise<UnitPriceList> {
    const { data } = await api.get(`${BASE_URL}/${domain}`, { params: { company_id: companyId } });
    return data;
  },

  async save(
    domain: PriceDomain, companyId: string, prices: Record<string, UnitPriceChange>,
  ): Promise<UnitPriceList> {
    const { data } = await api.put(`${BASE_URL}/${domain}`, { prices }, { params: { company_id: companyId } });
    return data;
  },

  async history(domain: PriceDomain, companyId: string): Promise<UnitPriceHistoryEntry[]> {
    const { data } = await api.get(`${BASE_URL}/${domain}/history`, { params: { company_id: companyId } });
    return data;
  },

  /** Reprice an estimate's whole job at today's prices. */
  async useCurrentPrices(domain: PriceDomain, estimateId: string) {
    const path = `${domain}-estimates`;
    const { data } = await api.post(`/api/${path}/${estimateId}/use-current-prices`);
    return data;
  },
};
