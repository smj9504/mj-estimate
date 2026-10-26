/**
 * ProductLibrary
 *
 * The company's products from retailers — cabinets, hardware, faucets,
 * sinks, countertops, tile, vanities… — that kitchen and bathroom remodel
 * options are built from. Products come in through ProductImport (the
 * bookmarklet, a screenshot, a link, or by hand) and are checked and saved
 * in ProductEditor.
 *
 * Opened as /product-library?import=1 by the bookmarklet: tells the page
 * that opened it it's ready, takes the product page it sends, reads it and
 * opens the editor.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Grid, Input, Segmented, Select, Space, Spin, Typography, message } from 'antd';
import { LinkOutlined, PictureOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import ProductEditor from '../components/product-library/ProductEditor';
import ProductImport, { IMPORT_PAGE, IMPORT_READY } from '../components/product-library/ProductImport';
import { fileService } from '../services/fileService';
import { productLibraryService } from '../services/productLibraryService';
import type { Product, ProductDraft, ProductMeta } from '../types/productLibrary';

const { Title, Text } = Typography;
type Trade = 'all' | 'kitchen' | 'bathroom';
const PAGE_SIZE = 48;
const UNIT_SHORT: Record<string, string> = { each: 'ea', sf: 'sq ft', box: 'box', lf: 'lin ft' };

const inches = (v?: number | null) => (v ? `${Number(v.toFixed(2))}"` : null);

function sizeLine(p: Product): string | null {
  const dims = [inches(p.width_in), inches(p.depth_in), inches(p.height_in)].filter(Boolean);
  if (dims.length >= 2) return `${dims.join(' × ')}`;
  if (p.tile_width_in && p.tile_length_in) return `${inches(p.tile_width_in)} × ${inches(p.tile_length_in)} piece`;
  return dims[0] ?? null;
}

function priceLine(p: Product): string | null {
  if (p.price == null || p.price === '') return null;
  const n = Number(p.price);
  const base = `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const unit = UNIT_SHORT[p.price_unit] ?? p.price_unit;
  return `${base} / ${unit}${p.price_unit === 'box' && p.box_sf ? ` (${p.box_sf} sq ft)` : ''}`;
}

/** The bookmarklet's end: say ready to the page that opened this one, take what it sends, read it. */
function useBookmarkletImport(onDraft: (draft: ProductDraft) => void) {
  const [params, setParams] = useSearchParams();
  const importing = params.get('import') === '1';
  const [waiting, setWaiting] = useState(importing);
  const done = useRef(false);

  useEffect(() => {
    if (!importing || done.current) return;
    const opener = window.opener as Window | null;
    if (!opener) {
      setWaiting(false);
      message.info('Open a product page and click the + MJ Product bookmark there.');
      return;
    }
    const onMessage = async (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: unknown; html?: unknown };
      if (e.source !== opener || data?.type !== IMPORT_PAGE || typeof data.url !== 'string' || typeof data.html !== 'string') return;
      done.current = true;
      window.removeEventListener('message', onMessage);
      try {
        onDraft(await productLibraryService.readHtml(data.url, data.html));
      } catch (err: any) {
        message.error(err?.response?.data?.detail ?? 'The product page could not be read');
      } finally {
        setWaiting(false);
        setParams({}, { replace: true });
      }
    };
    window.addEventListener('message', onMessage);
    // Said a few times, in case the page that opened this one is slow to listen.
    const tell = () => opener.postMessage(IMPORT_READY, '*');
    tell();
    const timer = window.setInterval(tell, 700);
    const giveUp = window.setTimeout(() => {
      if (!done.current) {
        setWaiting(false);
        message.warning('The product page did not answer. Click the bookmark on it again.');
      }
    }, 15000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
    };
  }, [importing, onDraft, setParams]);

  return waiting;
}

const ProductCard: React.FC<{ product: Product; meta?: ProductMeta; onOpen: () => void }> = ({ product, meta, onOpen }) => {
  const category = meta?.categories.find((c) => c.key === product.category)?.label ?? product.category;
  const retailer = meta?.retailers.find((r) => r.key === product.retailer)?.label;
  const image = product.image_file_ids[0];
  const size = sizeLine(product);
  const price = priceLine(product);
  return (
    <Card
      hoverable
      size="small"
      onClick={onOpen}
      styles={{ body: { padding: 10 } }}
      cover={
        <div style={{ aspectRatio: '4 / 3', background: '#fafaf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {image ? (
            <img
              src={fileService.getPreviewUrl(image)}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
            />
          ) : (
            <PictureOutlined style={{ fontSize: 28, color: '#c9c7c2' }} />
          )}
        </div>
      }
    >
      <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {category}
      </Text>
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          lineHeight: 1.35,
          margin: '2px 0 4px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 35,
        }}
      >
        {product.title}
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block' }} ellipsis>
        {[product.brand, product.finish].filter(Boolean).join(' · ') || ' '}
      </Text>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 6 }}>
        <Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {price ?? <Text type="secondary">No price</Text>}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {size}
        </Text>
      </div>
      {product.source_url && (
        <a
          href={product.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}
        >
          <LinkOutlined /> {retailer ?? 'Listing'}
        </a>
      )}
    </Card>
  );
};

const ProductLibrary: React.FC = () => {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState<Trade>('all');
  const [category, setCategory] = useState<string | undefined>();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<{ product?: Product | null; draft?: ProductDraft | null } | null>(null);

  // Search as typing settles.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data: meta } = useQuery({ queryKey: ['product-meta'], queryFn: productLibraryService.getMeta, staleTime: Infinity });
  const { data, isLoading } = useQuery({
    queryKey: ['products', query, trade, category, limit],
    queryFn: () =>
      productLibraryService.list({ q: query || undefined, trade: trade === 'all' ? undefined : trade, category, limit }),
  });

  const openDraft = React.useCallback((draft: ProductDraft) => {
    setImportOpen(false);
    setEditing({ draft });
  }, []);
  const waitingForPage = useBookmarkletImport(openDraft);

  const categoryOptions = useMemo(
    () =>
      (meta?.categories ?? [])
        .filter((c) => trade === 'all' || c.trade === trade || c.trade === 'both')
        .map((c) => ({ value: c.key, label: c.label })),
    [meta, trade]
  );

  const items = data?.items ?? [];
  return (
    <div style={{ padding: isMobile ? 0 : 24 }}>
      <Card
        title={<Title level={4} style={{ margin: 0 }}>Product Library</Title>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
            {isMobile ? 'Add' : 'Add product'}
          </Button>
        }
        styles={{ header: isMobile ? { padding: '0 12px' } : undefined, body: isMobile ? { padding: 12 } : undefined }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Products from retailers that remodel options are built from, shared by kitchen and bathroom estimates. An estimate
          keeps a copy of each product it uses, so editing one here doesn't change an estimate already sent.
        </Text>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search name, brand, model, finish"
            prefix={<SearchOutlined />}
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 280 }}
          />
          <Segmented<Trade>
            value={trade}
            onChange={(v) => {
              setTrade(v);
              setCategory(undefined);
            }}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Kitchen', value: 'kitchen' },
              { label: 'Bathroom', value: 'bathroom' },
            ]}
          />
          <Select
            allowClear
            placeholder="Any category"
            value={category}
            onChange={setCategory}
            options={categoryOptions}
            style={{ width: 220 }}
          />
          {data && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data.total} product{data.total === 1 ? '' : 's'}
            </Text>
          )}
        </Space>

        {waitingForPage ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
            <div style={{ marginTop: 12, color: '#5f5e5b' }}>Reading the product page…</div>
          </div>
        ) : isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty
            style={{ padding: 32 }}
            description={
              query || category || trade !== 'all'
                ? 'No products match'
                : 'No products yet. Add one from a retailer page, a screenshot, a link or by hand.'
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
              Add product
            </Button>
          </Empty>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 190}px, 1fr))`,
                gap: 12,
              }}
            >
              {items.map((p) => (
                <ProductCard key={p.id} product={p} meta={meta} onOpen={() => setEditing({ product: p })} />
              ))}
            </div>
            {data && data.total > items.length && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <ProductImport open={importOpen} onClose={() => setImportOpen(false)} onDraft={openDraft} />
      <ProductEditor
        open={!!editing}
        meta={meta}
        product={editing?.product}
        draft={editing?.draft}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          message.success(`Saved ${saved.title}`);
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
        onArchived={(gone) => {
          setEditing(null);
          message.success(`Removed ${gone.title}`);
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
      />
    </div>
  );
};

export default ProductLibrary;
