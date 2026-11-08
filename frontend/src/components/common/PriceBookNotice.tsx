/**
 * Says when an estimate's prices are older than today's, and offers to
 * reprice its job at today's prices.
 *
 * An estimate keeps the prices it was first priced with (its price book),
 * so a company price change or a default update never moves a quote that
 * has gone out. Nothing shows while its prices are today's.
 */

import React from 'react';
import { Alert, Button, Popconfirm, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unitPriceService } from '../../services/unitPriceService';
import type { PriceBookSummary, PriceDomain } from '../../services/unitPriceService';

interface PriceBookNoticeProps {
  domain: PriceDomain;
  estimateId: string;
  priceBook?: PriceBookSummary | null;
  /** Query keys to refresh after repricing */
  refreshKeys: unknown[][];
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

const PriceBookNotice: React.FC<PriceBookNoticeProps> = ({ domain, estimateId, priceBook, refreshKeys }) => {
  const queryClient = useQueryClient();
  const reprice = useMutation({
    mutationFn: () => unitPriceService.useCurrentPrices(domain, estimateId),
    onSuccess: () => {
      refreshKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      message.success('현재 단가로 다시 계산했습니다');
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || '다시 계산하지 못했습니다'),
  });

  if (!priceBook || priceBook.is_current) return null;
  const since = fmtDate(priceBook.priced_at);

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      message={`${since ? `${since}부터 쓰던 ` : ''}단가로 계산된 견적입니다`}
      description="그 뒤로 회사 단가나 기본 단가가 바뀌었어요. 이 견적은 바뀐 단가를 따라가지 않습니다."
      action={(
        <Popconfirm
          title="현재 단가로 다시 계산할까요?"
          description="이 job의 계산된 견적(옵션 포함)이 모두 현재 단가로 다시 계산되고, 금액이 바뀔 수 있습니다."
          okText="다시 계산"
          cancelText="취소"
          onConfirm={() => reprice.mutate()}
        >
          <Button size="small" loading={reprice.isPending}>현재 단가로 다시 계산</Button>
        </Popconfirm>
      )}
    />
  );
};

export default PriceBookNotice;
