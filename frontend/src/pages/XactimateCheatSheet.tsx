import React, { useState, useMemo, useRef } from 'react';
import { Input, Tag, Typography, Anchor, Card, Table, Alert, Row, Col, Badge, Space } from 'antd';
import { SearchOutlined, PrinterOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

// ─── Data Definitions ───

interface RuleBox {
  type: 'info' | 'warning' | 'success' | 'purple';
  title: string;
  items: string[];
}

interface TableRow {
  key: string;
  [k: string]: string;
}

interface Section {
  id: string;
  title: string;
  tag: string;
  tagColor: string;
  navGroup: string;
  navDotColor: string;
  rules?: RuleBox[];
  tables?: { columns: { title: string; dataIndex: string; key: string; render?: (v: string) => React.ReactNode }[]; data: TableRow[] }[];
}

// ─── Helper renders ───
const codeRender = (v: string) => {
  if (!v) return null;
  // Split by code markers
  const parts = v.split(/(`[^`]+`)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <Tag key={i} color="default" style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
            {p.slice(1, -1)}
          </Tag>
        ) : p.includes('⚑') ? (
          <Tag key={i} color="gold" style={{ fontSize: 11 }}>{p}</Tag>
        ) : p.includes('✕') ? (
          <Tag key={i} color="red" style={{ fontSize: 11 }}>{p}</Tag>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
};

const priceRender = (v: string) => {
  if (!v || v === '—') return <Text type="secondary">—</Text>;
  return <Text style={{ fontFamily: 'monospace', color: '#389e0d', fontWeight: 500 }}>{v}</Text>;
};

const unitRender = (v: string) => (
  <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text>
);

const missRender = (v: string) => {
  if (!v) return null;
  if (v.includes('[miss]')) {
    const clean = v.replace('[miss]', '').trim();
    return <><Tag color="gold" style={{ fontSize: 10 }}>⚑ {clean || '자주 빠짐'}</Tag></>;
  }
  if (v.includes('[excl]')) {
    const clean = v.replace('[excl]', '').trim();
    return <Tag color="red" style={{ fontSize: 10 }}>✕ {clean}</Tag>;
  }
  if (v.includes('[warn]')) {
    const clean = v.replace('[warn]', '').trim();
    return <Text type="warning">{clean}</Text>;
  }
  return codeRender(v);
};

// ─── Section Data ───
const sections: Section[] = [
  // ─── BASIC CONCEPTS ───
  {
    id: 'rules', title: '기본 개념', tag: 'CORE', tagColor: '#1a1a1a',
    navGroup: '핵심 규칙', navDotColor: '#4f8ef7',
    rules: [
      {
        type: 'info', title: 'R&R vs D&R vs Remove',
        items: [
          '`R&R` = Remove + Replace (같은 아이템 교체)',
          '`D&R` = Detach & Reset (임시 분리 후 재설치, 재사용)',
          '`Remove (-)` = 제거만. 같은 코드 + Activity "-"',
          '별도 Remove 코드 없음 → 설치 코드를 Activity Remove 모드로',
        ],
      },
      {
        type: 'warning', title: 'Xactimate 수량 기준 (Sketch)',
        items: [
          '`WC` = Walls + Ceiling SF (페인트 기준)',
          '`W` = Walls only SF',
          '`C` = Ceiling only SF',
          '`F` = Floor SF',
          '`LF Ceil Perim` = 천장 둘레 (trim 기준)',
        ],
      },
      {
        type: 'success', title: '캐비닛 측정 단위',
        items: [
          '캐비닛 = **LF (앞면 너비)**',
          'Upper: 높이별 코드 다름 (24"/30"/36"/42")',
          '카운터탑 = LF (25" 폭 기준)',
          'Island = Oversized 코드 (30~40" 폭)',
        ],
      },
      {
        type: 'purple', title: 'Per Specs (Independent Analysis)',
        items: [
          '캐리어 independent analysis 있을 때 **NFCP** 코드 사용',
          '`FCC NFCP` = Carpet per specs',
          '`FCW NFCPSN` = Snaplock Laminate per specs',
          'Analysis 없으면 grade별 일반 코드 사용',
        ],
      },
    ],
  },

  // ─── WASTE ───
  {
    id: 'waste', title: 'Waste 규칙', tag: 'CRITICAL', tagColor: '#d46b08',
    navGroup: '핵심 규칙', navDotColor: '#f5a623',
    rules: [
      {
        type: 'warning', title: 'Waste 미포함 → 수동 추가 필수',
        items: [
          '**Carpet (FCC)** — 15% 기준, 방 형태·패턴에 따라 조정',
          '**Sheet Vinyl (FCV)** — 10~15%',
          '**Shingles (RFG)** — 별도 계산',
          '⚠ Remove 수량에는 Waste 추가 안 함!',
          'Waste = Replace(설치) 수량에만 적용',
        ],
      },
      {
        type: 'success', title: 'Waste 자동 포함 (별도 추가 불필요)',
        items: [
          'Tile (FCT, TIL) — per SF 가격에 포함',
          'Wood flooring (FCW) — 포함',
          'LVP / Vinyl plank (FCV PLK) — 포함',
          'Drywall (DRY) — 포함',
          'Paint (PNT) — 포함',
        ],
      },
      {
        type: 'info', title: 'Waste 계산 예시',
        items: [
          '방 200 SF, Carpet 15% waste',
          'Remove Carpet → 200 SF (waste 없음)',
          'Remove Carpet Pad → 200 SF',
          'Carpet → 230 SF (×1.15)',
          'Carpet Pad → 230 SF',
        ],
      },
    ],
  },

  // ─── SEAL/PRIME ───
  {
    id: 'paint-rules', title: 'Seal / Prime 규칙', tag: 'PAINT', tagColor: '#389e0d',
    navGroup: '핵심 규칙', navDotColor: '#38c5a4',
    rules: [
      {
        type: 'info', title: '언제 Seal 사용하나',
        items: [
          '새 drywall 설치 후 → **Seal/prime (1 coat) then paint**',
          '기존 벽 재도장만 → Paint (2 coats)만',
          '물 얼룩·담배 얼룩 → **Seal w/latex stain blocker** + Paint',
          '화재 피해 → **Seal stud wall (shellac)** + Paint',
        ],
      },
      {
        type: 'warning', title: '⚠ Seal+Paint 수량 주의',
        items: [
          'Seal SF + Paint SF 합계 ≤ WC SF',
          '"Seal & paint" 통합 + 별도 Seal/Paint 혼용 금지',
          '천장/벽 다른 색이면 W SF + C SF 따로',
          '둘 합계 = WC SF와 같아야 함',
        ],
      },
      {
        type: 'success', title: 'Protection / Masking',
        items: [
          'Hardwood 위 drywall 작업 → `Mask floor - plastic 10mil` SF',
          'Carpet/Vinyl 위 작업 → `Floor protect - self-adhesive film` SF',
          '페인트 작업 prep → `Mask and prep for paint - per LF`',
          '가구·물건 덮기 → `Mask or cover per SF`',
        ],
      },
    ],
  },

  // ─── CARPET ───
  {
    id: 'carpet', title: 'Carpet', tag: 'FCC', tagColor: '#7c3aed',
    navGroup: 'Flooring', navDotColor: '#9b7fcb',
    tables: [{
      columns: [
        { title: '상황', dataIndex: 'situation', key: 'situation' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격범위', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'c1', situation: '제거', item: '`FCC NFCP –` Remove Carpet per specs', unit: 'SF', price: '—', note: 'Waste 없음, demo SF 제외' },
        { key: 'c2', situation: '', item: '`FCC AV –` Remove Carpet (grade별)', unit: 'SF', price: '—', note: 'analysis 없을 때' },
        { key: 'c3', situation: '', item: '`FCC PAD –` Remove Carpet Pad', unit: 'SF', price: '—', note: 'Waste 없음' },
        { key: 'c4', situation: '설치', item: '`FCC NFCP` Carpet per specs', unit: 'SF', price: '$1.20', note: '[warn]+ 10~15% waste' },
        { key: 'c5', situation: '', item: '`FCC AV` Carpet (Economy~Premium)', unit: 'SF', price: '$2.51~$8.10', note: '+ waste' },
        { key: 'c6', situation: '', item: '`FCC PAD` Carpet Pad', unit: 'SF', price: '$0.60~$1.57', note: '+ waste' },
        { key: 'c7', situation: '계단', item: '`FCC STP` Step charge - waterfall', unit: 'EA', price: '$10.35', note: 'step 수 × EA' },
        { key: 'c8', situation: '', item: '`FCC STP` Step charge - tucked (high grade)', unit: 'EA', price: '$14.88', note: '' },
        { key: 'c9', situation: '전환부', item: '`FCC EDGE` Metal transition strip', unit: 'EA', price: '$4.28', note: '[miss]자주 빠짐' },
      ],
    }],
  },

  // ─── LVP ───
  {
    id: 'lvp', title: 'LVP / Laminate / Engineered Wood', tag: 'FCW / FCV', tagColor: '#389e0d',
    navGroup: 'Flooring', navDotColor: '#4caf82',
    tables: [{
      columns: [
        { title: '타입', dataIndex: 'type', key: 'type' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'l1', type: 'LVP 제거', item: '`FCV PLK –` Remove Vinyl plank', unit: 'SF', price: '—', note: 'demo SF 제외' },
        { key: 'l2', type: 'LVP 설치', item: '`FCV PLK` Vinyl plank (Standard~Premium)', unit: 'SF', price: '$5.90~$11.00', note: 'waste 포함됨' },
        { key: 'l3', type: '', item: '`FCV PREP` Floor preparation', unit: 'SF', price: '$0.60~$0.86', note: '[miss]자주 빠짐' },
        { key: 'l4', type: 'Underlayment', item: '`FCW UC1` 1/8" cork underlayment', unit: 'SF', price: '$2.73', note: '' },
        { key: 'l5', type: '', item: '`FCW BARRV` Visqueen vapor barrier 6mil', unit: 'SF', price: '$0.41', note: '' },
        { key: 'l6', type: 'Laminate', item: '`FCW LAM` Snaplock Laminate (Std/High)', unit: 'SF', price: '$6.09~$9.10', note: '' },
        { key: 'l7', type: '', item: '`FCW NFCPSN` Laminate per specs', unit: 'SF', price: '$4.34', note: '' },
        { key: 'l8', type: 'Eng. Wood', item: '`FCW LAMTF` Engineered floating (Std~Premium)', unit: 'SF', price: '$9.43~$17.69', note: '' },
        { key: 'l9', type: 'Trim (필수)', item: '`FCW LAMB` Baseboard for wood flooring', unit: 'LF', price: '$7.99', note: '[miss]보험 견적 누락 多' },
        { key: 'l10', type: '', item: '`FCW LAMQ` Quarter round', unit: 'LF', price: '$3.89', note: '[miss]보험 견적 누락 多' },
        { key: 'l11', type: '', item: '`FCW LAMR` Reducer strip', unit: 'LF', price: '$7.90', note: '방 전환부 있으면' },
        { key: 'l12', type: '계단', item: '`FCW LAMST` Laminate step charge (tread+riser)', unit: 'EA', price: '$24.67', note: '' },
      ],
    }],
  },

  // ─── HARDWOOD ───
  {
    id: 'wood', title: 'Hardwood Floor', tag: 'FCW', tagColor: '#cf1322',
    navGroup: 'Flooring', navDotColor: '#e85c5c',
    tables: [{
      columns: [
        { title: '모드', dataIndex: 'mode', key: 'mode' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'w1', mode: 'Refinish only', item: '`FCW FIN` Sand, stain & finish wood floor', unit: 'SF', price: '$4.57', note: 'remove/install 없음' },
        { key: 'w2', mode: '', item: '`FCW FINDS` Add for dustless floor sanding', unit: 'SF', price: '$1.00', note: '[miss]자주 빠짐' },
        { key: 'w3', mode: '', item: '`FCW FINADD` Additional coat of finish', unit: 'SF', price: '$1.04', note: '' },
        { key: 'w4', mode: 'Full R&R', item: '`FCW AV –` Remove Hardwood', unit: 'SF', price: '—', note: '' },
        { key: 'w5', mode: '', item: '`FCW AV` Oak #1 common (no finish)', unit: 'SF', price: '$12.49', note: '' },
        { key: 'w6', mode: '', item: '`FCW BARR` Vapor barrier 15# felt', unit: 'SF', price: '$0.29', note: '' },
        { key: 'w7', mode: '', item: '+ Sand, stain, finish (위 항목 동일)', unit: 'SF', price: '', note: '' },
        { key: 'w8', mode: 'Pre-finished', item: '`FCW AVPF` Pre-finished solid wood (High)', unit: 'SF', price: '$14.52', note: '' },
        { key: 'w9', mode: 'Trim (필수)', item: '`FCW LAMB` Baseboard (paint grade)', unit: 'LF', price: '$7.99', note: 'wood floor R&R시 필수' },
        { key: 'w10', mode: '', item: '`FCW LAMQ` Quarter round (paint grade)', unit: 'LF', price: '$3.89', note: 'R&R 단일 코드' },
        { key: 'w11', mode: '', item: 'Stain grade → `FCW AV` Baseboard + `FCW` QR hardwood', unit: 'LF', price: '—', note: '' },
        { key: 'w12', mode: '계단', item: '`FCW FINSTP` Sand, stain, finish steps', unit: 'EA', price: '$16.18', note: '' },
      ],
    }],
  },

  // ─── TILE FLOOR ───
  {
    id: 'tile-floor', title: 'Tile Floor', tag: 'FCT', tagColor: '#d46b08',
    navGroup: 'Flooring', navDotColor: '#f5a623',
    tables: [{
      columns: [
        { title: '순서', dataIndex: 'step', key: 'step' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 't1', step: '1. 제거', item: '`FCT AV –` Remove Tile floor covering', unit: 'SF', price: '—', note: '' },
        { key: 't2', step: '', item: '`FCT CNCRM` Add\'l labor - concrete slab removal', unit: 'SF', price: '$1.84', note: '콘크리트 슬래브면' },
        { key: 't3', step: '2. 바닥준비', item: '`FCT LEVCEM` Floor leveling cement (Light/Avg/Heavy)', unit: 'SF', price: '$2.60~$3.96', note: '필요시' },
        { key: 't4', step: '', item: '`FCT BCEM1` 1/2" Cement board (backer)', unit: 'SF', price: '$6.23', note: '[miss]자주 빠짐' },
        { key: 't5', step: '3. 설치', item: '`FCT AV` Tile floor (Economy~Premium)', unit: 'SF', price: '$12.62~$24.06', note: 'waste 포함됨' },
        { key: 't6', step: '', item: '`FCT NCFP` Tile floor per specs', unit: 'SF', price: '$11.18', note: '' },
        { key: 't7', step: '4. 마감', item: '`FCT SEALG` Grout sealer', unit: 'SF', price: '$1.60', note: '[miss]자주 빠짐' },
        { key: 't8', step: '선택', item: '`FCT DIAGADD` Add for diagonal installation', unit: 'SF', price: '$1.76', note: '' },
      ],
    }],
  },

  // ─── DRYWALL ───
  {
    id: 'drywall', title: 'Drywall', tag: 'DRY', tagColor: '#1a1a1a',
    navGroup: 'Structure', navDotColor: '#4f8ef7',
    tables: [{
      columns: [
        { title: '타입', dataIndex: 'type', key: 'type' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격/SF', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '용도', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'd1', type: 'Wall - LF방식', item: '`DRY LF` 1/2" drywall per LF - up to 2\' tall', unit: 'LF', price: '$15.22', note: '하단 water damage 일반' },
        { key: 'd2', type: '', item: '`DRY LF5` 5/8" drywall per LF - up to 2\' tall', unit: 'LF', price: '$15.64', note: '' },
        { key: 'd3', type: '', item: '`DRY LF` 1/2" drywall per LF - up to 4\' tall', unit: 'LF', price: '$21.69', note: '' },
        { key: 'd4', type: 'Wall - SF방식', item: '`DRY1` 1/2" floated, ready for paint', unit: 'SF', price: '$3.63', note: '일반 벽 교체' },
        { key: 'd5', type: '', item: '`DRY1` 1/2" ready for texture', unit: 'SF', price: '$3.24', note: '천장/텍스처 적용 벽' },
        { key: 'd6', type: '', item: '`DRY5` 5/8" floated, ready for paint', unit: 'SF', price: '$3.76', note: '지하/방화' },
        { key: 'd7', type: '', item: '`DRY1 MR` 1/2" mold resistant floated', unit: 'SF', price: '$3.79', note: '욕실 인접 벽' },
        { key: 'd8', type: '', item: '`DRY1 WR` 1/2" water rock (greenboard)', unit: 'SF', price: '$3.72', note: '습기 많은 공간' },
        { key: 'd9', type: 'Add-ons', item: '`DRY GLU` Additional cost for gluing', unit: 'SF', price: '$0.75', note: '[miss]자주 빠짐' },
        { key: 'd10', type: '', item: '`DRY PATCHJ` Tape joint - new to existing - per LF', unit: 'LF', price: '$11.29', note: '부분 교체시 경계선' },
        { key: 'd11', type: '', item: '`DRY ADD` High wall/ceiling (11\'~14\')', unit: 'SF', price: '$0.85', note: '높은 천장 추가' },
        { key: 'd12', type: 'Repair', item: '`DRY PATCH` Drywall patch/small repair (≤4 SF)', unit: 'EA', price: '$102.01', note: '' },
        { key: 'd13', type: '', item: '`DRY PATCHLF` Tape joint/repair per LF', unit: 'LF', price: '$10.48', note: '' },
      ],
    }],
  },

  // ─── TEXTURE ───
  {
    id: 'texture', title: 'Texture', tag: 'DRY TEX', tagColor: '#389e0d',
    navGroup: 'Structure', navDotColor: '#38c5a4',
    tables: [{
      columns: [
        { title: '텍스처 타입', dataIndex: 'type', key: 'type' },
        { title: '코드', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'tx1', type: 'Machine - Orange peel', item: '`DRY TEX`', unit: 'SF', price: '$0.85', note: '기계 분사' },
        { key: 'tx2', type: 'Machine - Knockdown', item: '`DRY TEXMK`', unit: 'SF', price: '$1.20', note: '' },
        { key: 'tx3', type: 'Light hand texture', item: '`DRY TEX` light', unit: 'SF', price: '$1.25', note: 'Second floor hallway 多' },
        { key: 'tx4', type: 'Heavy hand texture (knockdown)', item: '`DRY TEX` heavy', unit: 'SF', price: '$1.70', note: 'State Farm 주로' },
        { key: 'tx5', type: 'Smooth/skim coat', item: '`DRY TEX` smooth', unit: 'SF', price: '$1.86', note: '' },
        { key: 'tx6', type: 'Popcorn (acoustic ceiling)', item: '`DRY AC`', unit: 'SF', price: '$1.60~$2.12', note: '' },
        { key: 'tx7', type: 'Remove popcorn', item: '`DRY ACR`', unit: 'SF', price: '$0.95', note: '' },
        { key: 'tx8', type: 'Scrape & prep (existing texture)', item: '`TIL/DRY` Scrape ceiling', unit: 'SF', price: '—', note: '기존 텍스처 제거 후 재도장' },
      ],
    }],
  },

  // ─── PAINT ───
  {
    id: 'paint', title: 'Paint', tag: 'PNT', tagColor: '#389e0d',
    navGroup: 'Structure', navDotColor: '#4caf82',
    tables: [{
      columns: [
        { title: '항목', dataIndex: 'item_name', key: 'item_name' },
        { title: '코드', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '사용 조건', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'p1', item_name: 'Seal/prime + paint (1+1)', item: '`PNT SP`', unit: 'SF', price: '—', note: '새 drywall 후 기본' },
        { key: 'p2', item_name: 'Seal stain blocker (≤ floor perim)', item: '`PNT S+`', unit: 'SF', price: '—', note: '부분 얼룩' },
        { key: 'p3', item_name: 'Seal stain blocker (> floor perim)', item: '`PNT S++`', unit: 'SF', price: '—', note: '광범위 얼룩, 천장' },
        { key: 'p4', item_name: 'Paint walls - 1 coat', item: '`PNT P`', unit: 'SF', price: '—', note: '기존 벽 부분 재도장' },
        { key: 'p5', item_name: 'Paint walls - 2 coats', item: '`PNT P2`', unit: 'SF', price: '—', note: '' },
        { key: 'p6', item_name: 'Paint walls & ceiling - 2 coats', item: '`PNT` walls+ceiling 2coats', unit: 'SF', price: '$1.26~$1.28', note: 'WC SF 사용' },
        { key: 'p7', item_name: 'Baseboard - 1 coat', item: '`PNT B`', unit: 'LF', price: '$1.39', note: '' },
        { key: 'p8', item_name: 'Seal + paint baseboard', item: '`PNT B1SP`', unit: 'LF', price: '$1.70', note: '새 baseboard 설치 후' },
        { key: 'p9', item_name: 'Paint baseboard - 2 coats', item: '`PNT B2`', unit: 'LF', price: '$1.64', note: '' },
        { key: 'p10', item_name: 'Stain & finish baseboard', item: '`PNT BS`', unit: 'LF', price: '$1.79', note: 'stain grade' },
        { key: 'p11', item_name: 'Door/window trim & jamb - 2 coats', item: '`PNT DORT`', unit: 'EA/side', price: '$35.92', note: 'per side' },
        { key: 'p12', item_name: 'Door slab only - 2 coats', item: '`PNT DOR1`', unit: 'EA/side', price: '$28.45×2', note: '[miss]자주 빠짐' },
        { key: 'p13', item_name: 'Crown molding - 2 coats', item: '`PNT CWN2`', unit: 'LF', price: '$1.72', note: '' },
        { key: 'p14', item_name: 'Seal & paint base shoe/QR', item: '`PNT` base shoe seal+paint', unit: 'LF', price: '$1.06', note: '' },
        { key: 'p15', item_name: 'Stain & finish QR', item: '`PNT` base shoe stain', unit: 'LF', price: '—', note: '' },
      ],
    }],
  },

  // ─── TRIM ───
  {
    id: 'trim', title: 'Trim (Baseboard, QR, Crown, Casing)', tag: 'FNC / FCW', tagColor: '#7c3aed',
    navGroup: 'Structure', navDotColor: '#9b7fcb',
    rules: [
      {
        type: 'info', title: 'Wood Floor R&R → Trim 규칙',
        items: [
          'LVP / Engineered / Hardwood 교체시 **Baseboard + QR 필수**',
          'Remove Baseboard + 새 Baseboard + paint/stain',
          'R&R Quarter round (단일 코드, remove+install 포함)',
          '보험 견적서에 자주 빠짐 → supplement 필수',
        ],
      },
      {
        type: 'warning', title: 'Carpet → Trim 규칙',
        items: [
          '카펫 교체 시 Baseboard R&R **불필요**',
          '단, baseboard 일부 demo됐으면:',
          '→ 손상 구간만 Baseboard (partial) + 전체 LF paint',
        ],
      },
    ],
    tables: [{
      columns: [
        { title: '아이템', dataIndex: 'item_name', key: 'item_name' },
        { title: '코드', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'tr1', item_name: 'Baseboard 3-1/4"', item: '`FNC B` Baseboard 3-1/4"', unit: 'LF', price: '~$4.51', note: '' },
        { key: 'tr2', item_name: 'Baseboard for wood flooring', item: '`FCW LAMB`', unit: 'LF', price: '$7.99', note: 'wood floor용' },
        { key: 'tr3', item_name: 'Quarter round (wood floor)', item: '`FCW LAMQ` Quarter round', unit: 'LF', price: '$3.89', note: 'paint grade R&R' },
        { key: 'tr4', item_name: 'QR hardwood (stain grade)', item: '`FCW` R&R Quarter round 3/4" hardwood', unit: 'LF', price: '—', note: '' },
        { key: 'tr5', item_name: 'Base shoe (paint)', item: '`FNC SHOE` Base shoe', unit: 'LF', price: '$1.83', note: '' },
        { key: 'tr6', item_name: 'Crown molding', item: '`FNC CM` Crown molding', unit: 'LF', price: '—', note: 'paint grade' },
        { key: 'tr7', item_name: 'Casing', item: '`FNC C` Casing', unit: 'LF', price: '—', note: '' },
        { key: 'tr8', item_name: 'Reducer strip', item: '`FCW LAMR` Reducer strip', unit: 'LF', price: '$7.90', note: '방 전환부' },
        { key: 'tr9', item_name: 'Seal & paint QR/base shoe', item: '`PNT` Seal & paint base shoe', unit: 'LF', price: '$1.06', note: '' },
      ],
    }],
  },

  // ─── ROOM GENERAL ───
  {
    id: 'room-general', title: 'Room General (방 공통)', tag: 'GENERAL', tagColor: '#d46b08',
    navGroup: 'Rooms', navDotColor: '#f5a623',
    tables: [{
      columns: [
        { title: '항목', dataIndex: 'category', key: 'category' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'rg1', category: 'Contents', item: 'Contents - move out then reset - Small (≤200SF)', unit: 'EA', note: 'SF에 따라 자동 선택' },
        { key: 'rg2', category: '', item: 'Contents - move out then reset - Medium (≤400SF)', unit: 'EA', note: '' },
        { key: 'rg3', category: '', item: 'Contents - move out then reset - Large (≤750SF)', unit: 'EA', note: '' },
        { key: 'rg4', category: '', item: 'Contents - move out then reset - Extra large (>750SF)', unit: 'EA', note: '' },
        { key: 'rg5', category: '', item: 'Content Manipulation charge - per hour', unit: 'HR', note: '부분 이동시 대안' },
        { key: 'rg6', category: 'Floor Protection', item: 'Mask the floor - plastic and tape (10 mil)', unit: 'SF', note: '[miss]drywall 작업시 필수' },
        { key: 'rg7', category: '', item: 'Floor protection - self-adhesive plastic film', unit: 'SF', note: 'carpet/vinyl위' },
        { key: 'rg8', category: '', item: 'Mask wall - plastic, paper, tape', unit: 'LF', note: '벽 masking' },
        { key: 'rg9', category: 'Cleaning', item: 'Final cleaning - construction - Residential', unit: 'SF', note: '모든 방에 포함' },
        { key: 'rg10', category: 'D&R', item: 'Ceiling fan D&R', unit: 'EA', note: '[miss]자주 빠짐' },
        { key: 'rg11', category: '', item: 'Light fixture D&R', unit: 'EA', note: '[miss]자주 빠짐' },
        { key: 'rg12', category: '', item: 'HVAC register D&R', unit: 'EA', note: '[miss]자주 빠짐' },
        { key: 'rg13', category: '', item: 'Smoke detector D&R', unit: 'EA', note: '' },
        { key: 'rg14', category: '', item: 'Closet shelf and rod package', unit: 'EA', note: '[miss]자주 빠짐' },
      ],
    }],
  },

  // ─── BATHROOM ───
  {
    id: 'bathroom', title: 'Bathroom', tag: 'PLM / TIL / MSD', tagColor: '#cf1322',
    navGroup: 'Rooms', navDotColor: '#e85c5c',
    rules: [
      {
        type: 'warning', title: '작업 순서',
        items: ['D&R Fixtures → Tile Demo → Substrate → Tile Install → Shower Pan → Fixtures R&R → Drywall → Paint → Accessories'],
      },
      {
        type: 'info', title: 'Tile 수량 기준',
        items: [
          'Tub 3-wall surround: **≈60 SF**',
          'Shower: (W+D+W+D) × Height / 144 SF',
          'Cement board = Tile SF와 동일',
        ],
      },
    ],
    tables: [{
      columns: [
        { title: '단계', dataIndex: 'step', key: 'step' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'b1', step: 'Tile Demo', item: '`TIL AV –` Remove wall tile', unit: 'SF', price: '—', note: '' },
        { key: 'b2', step: '', item: '`FCT AV –` Remove floor tile', unit: 'SF', price: '—', note: '' },
        { key: 'b3', step: '', item: '`FCT CNCRM` Add\'l labor concrete slab', unit: 'SF', price: '$1.84', note: '콘크리트 슬래브면' },
        { key: 'b4', step: 'Substrate', item: '`TIL BCEM1` 1/2" Cement board (wall)', unit: 'SF', price: '$7.22', note: '[miss]자주 빠짐' },
        { key: 'b5', step: '', item: '`TIL BFB1` 1/2" Foam backer board (tub/shower)', unit: 'SF', price: '$8~$9.30', note: '' },
        { key: 'b6', step: 'Shower Pan', item: '`TIL SWRPM` Waterproof membrane', unit: 'SF', price: '$7.90', note: '[miss]shower 필수!' },
        { key: 'b7', step: '', item: '`TIL SWRPMD` Shower drain', unit: 'EA', price: '$220.01', note: '[miss]자주 빠짐' },
        { key: 'b8', step: '', item: '`TIL SWRCC` Tile concrete shower curb / LF', unit: 'LF', price: '$150.19', note: '' },
        { key: 'b9', step: 'Tub Surround', item: '`TIL TUB` Tile tub surround - up to 60 SF', unit: 'EA', price: '$1,735~$2,070', note: '패키지' },
        { key: 'b10', step: '', item: '`TIL TUB` Tile tub surround - 60-75 SF', unit: 'EA', price: '$1,735~$2,382', note: '' },
        { key: 'b11', step: 'Shower', item: '`TIL SWR` Tile shower - up to 60 SF', unit: 'EA', price: '$2,012~$3,297', note: '패키지 (drain 제외)' },
        { key: 'b12', step: '', item: '`TIL SWR` Tile shower - 61~100 SF', unit: 'EA', price: '$2,809~$3,297', note: '' },
        { key: 'b13', step: 'Tile Wall', item: '`TIL AV` Ceramic/porcelain (Std~Premium)', unit: 'SF', price: '$15~$26.54', note: '' },
        { key: 'b14', step: '', item: '`TIL AVB` Bullnose tile (edge trim)', unit: 'LF', price: '$11.95~$18.56', note: '' },
        { key: 'b15', step: '', item: '`TIL NICHE` Wall niche add-on', unit: 'EA', price: '$252.06', note: '샴푸 니치' },
        { key: 'b16', step: '', item: '`TIL BENCH` Bench seat add-on', unit: 'EA', price: '$187.79', note: '' },
        { key: 'b17', step: '', item: '`TIL SEALG` Seal grout on tile wall', unit: 'SF', price: '$1.74', note: '[miss]자주 빠짐' },
        { key: 'b18', step: 'Shower Door', item: '`MSD SDOR` Shower door (Std/High/Premium)', unit: 'EA', price: '$483~$1,281', note: '' },
        { key: 'b19', step: '', item: '`MSD SDORC` Shower door - corner unit', unit: 'EA', price: '$1,016~$1,797', note: '' },
        { key: 'b20', step: '', item: '`MSD TUBDR` Bathtub enclosure - sliding doors', unit: 'EA', price: '$438~$778', note: '' },
        { key: 'b21', step: 'Bathtub', item: 'Bathtub R&R (acrylic/fiberglass)', unit: 'EA', price: '—', note: '' },
        { key: 'b22', step: '', item: 'Waste & overflow drain R&R', unit: 'EA', price: '—', note: '[miss]거의 항상 빠짐!' },
        { key: 'b23', step: '', item: 'Tub/shower faucet R&R', unit: 'EA', price: '—', note: '' },
        { key: 'b24', step: '', item: 'Plumbing supply line (hot+cold)', unit: 'EA×2', price: '—', note: '[miss]자주 빠짐' },
        { key: 'b25', step: 'Toilet', item: 'Toilet R&R', unit: 'EA', price: '—', note: '' },
        { key: 'b26', step: '', item: 'Toilet seat', unit: 'EA', price: '—', note: '[miss]가장 많이 빠짐!' },
        { key: 'b27', step: 'Vanity', item: 'Vanity R&R', unit: 'LF', price: '—', note: '' },
        { key: 'b28', step: '', item: 'Vanity top - cultured marble', unit: 'LF', price: '$112~$167', note: '' },
        { key: 'b29', step: '', item: 'Sink faucet - bathroom R&R', unit: 'EA', price: '$223~$523', note: '' },
        { key: 'b30', step: '', item: 'P-trap assembly', unit: 'EA', price: '—', note: '[miss]자주 빠짐' },
        { key: 'b31', step: 'Accessories', item: 'Bath accessories (towel bar, TP holder)', unit: 'EA', price: '—', note: 'Xactimate 직접 검색' },
        { key: 'b32', step: '', item: 'Mirror D&R', unit: 'SF', price: '$6.17/SF', note: '' },
        { key: 'b33', step: '', item: 'Light bar D&R', unit: 'EA', price: '—', note: '' },
        { key: 'b34', step: '', item: 'GFI outlet D&R', unit: 'EA', price: '—', note: '[miss]자주 빠짐' },
        { key: 'b35', step: '', item: 'Bathroom exhaust fan D&R', unit: 'EA', price: '—', note: '[miss]자주 빠짐' },
      ],
    }],
  },

  // ─── KITCHEN ───
  {
    id: 'kitchen', title: 'Kitchen', tag: 'CAB / APP / PLM', tagColor: '#389e0d',
    navGroup: 'Rooms', navDotColor: '#38c5a4',
    rules: [
      {
        type: 'warning', title: 'D&R vs R&R 판단',
        items: [
          '경미한 손상, 건조 가능 → **D&R**',
          'MDF 팽창, 곰팡이 → **R&R 필수**',
          'Granite/Quartz 재사용 어려움 → supplement 준비',
          'D&R: `CAB LOWRS` $68.87/LF (카운터탑 별도)',
        ],
      },
      {
        type: 'info', title: '캐비닛 등급별 가격/LF',
        items: [
          'Lower Standard: **$192**',
          'Lower High: **$246**',
          'Lower Premium: **$486**',
          'Lower Deluxe: **$734**',
          'Upper 30" High: **$293** / Premium: **$460**',
        ],
      },
    ],
    tables: [
      {
        columns: [
          { title: '카운터탑 타입', dataIndex: 'type', key: 'type' },
          { title: '코드', dataIndex: 'item', key: 'item', render: codeRender },
          { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
          { title: '가격/LF', dataIndex: 'price', key: 'price', render: priceRender },
          { title: '주의', dataIndex: 'note', key: 'note', render: missRender },
        ],
        data: [
          { key: 'k1', type: 'Post formed laminate', item: '`CAB CTPF`', unit: 'LF', price: '$43~$75', note: '' },
          { key: 'k2', type: 'Flat laid laminate', item: '`CAB CTFL`', unit: 'LF', price: '$47~$64', note: '' },
          { key: 'k3', type: 'Laminate - Oversized (island)', item: '`CAB CTFL` Oversized', unit: 'LF', price: '$60~$67', note: '30~40" 폭' },
          { key: 'k4', type: 'Solid surface', item: '`CAB CTSS`', unit: 'LF', price: '$59~$96', note: '[excl]sink 별도' },
          { key: 'k5', type: 'Granite or Marble', item: '`CAB CTGM`', unit: 'LF', price: '$58~$128', note: '[excl]언더마운트 sink 제외' },
          { key: 'k6', type: 'Granite per ind. source', item: '`CAB NCPCTGM`', unit: 'LF', price: '$41.78', note: '' },
          { key: 'k7', type: 'Quartz/Engineered stone', item: '`CAB CTQ`', unit: 'LF', price: '$82~$116', note: '[excl]언더마운트 sink 제외' },
          { key: 'k8', type: 'Quartz per ind. source', item: '`CAB NCPCTQ`', unit: 'LF', price: '$42.09', note: '' },
          { key: 'k9', type: 'Butcher block', item: '`CAB CTBB`', unit: 'LF', price: '$70.34', note: '' },
          { key: 'k10', type: 'Concrete', item: '`CAB CTCON`', unit: 'LF', price: '$115~$131', note: '' },
          { key: 'k11', type: 'Stainless steel', item: '`CAB CTST`', unit: 'LF', price: '$270.72', note: '' },
        ],
      },
      {
        columns: [
          { title: '항목', dataIndex: 'category', key: 'category' },
          { title: '코드', dataIndex: 'item', key: 'item', render: codeRender },
          { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
          { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
          { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
        ],
        data: [
          { key: 'ka1', category: 'CT Add-ons', item: '`CAB CTMITER` Mitered corner', unit: 'EA', price: '$93.82', note: '[miss]코너 이음새 자주 빠짐' },
          { key: 'ka2', category: '', item: '`CAB CTWF` Waterfall countertop add-on', unit: 'LF', price: '$84.03', note: '폭포형 사이드' },
          { key: 'ka3', category: '', item: '`MBL SNKN` Undermount sink cutout (natural marble)', unit: 'EA', price: '$533.56', note: '[miss]Granite/Marble 시 필수' },
          { key: 'ka4', category: 'Backsplash', item: 'Plastic laminate 4"', unit: 'LF', price: '$11.11', note: '' },
          { key: 'ka5', category: '', item: 'Solid surface - coved (seamless)', unit: 'LF', price: '$64.32', note: '' },
          { key: 'ka6', category: '', item: '`TIL AV` Tile backsplash (ceramic)', unit: 'SF', price: '$15~$27', note: 'cement board 별도' },
          { key: 'ka7', category: 'Hardware', item: '`CAB KNPL` Cabinet knobs or pulls', unit: 'EA', price: '$8~$31', note: '[miss]캐비닛에 미포함!' },
          { key: 'ka8', category: '', item: '`CAB HINGC` Cabinet hinge - concealed', unit: 'EA', price: '$12.45', note: '[miss]자주 빠짐' },
          { key: 'ka9', category: 'Trim', item: '`CAB CROWN` Prefinished crown molding', unit: 'LF', price: '$10.58~$42.69', note: '' },
          { key: 'ka10', category: '', item: '`CAB FILLSCP` Filler/scribe board', unit: 'LF', price: '$7.24~$9.03', note: '[miss]벽과 캐비닛 사이' },
          { key: 'ka11', category: '', item: '`CAB PLYTK` Re-skin toe kick', unit: 'LF', price: '$10.52', note: '' },
          { key: 'ka12', category: 'Appliances', item: 'Refrigerator D&R', unit: 'EA', price: '$45.83', note: '' },
          { key: 'ka13', category: '', item: 'Range - electric D&R', unit: 'EA', price: '$34.38', note: '' },
          { key: 'ka14', category: '', item: 'Range - gas D&R', unit: 'EA', price: '$235.67', note: '' },
          { key: 'ka15', category: '', item: 'Dishwasher D&R', unit: 'EA', price: '$343.78', note: '' },
          { key: 'ka16', category: '', item: 'Garbage disposal D&R', unit: 'EA', price: '$235.67', note: '[miss]자주 빠짐' },
          { key: 'ka17', category: '', item: 'Range hood D&R', unit: 'EA', price: '$123.83', note: '' },
          { key: 'ka18', category: '', item: 'Microwave (over range) D&R', unit: 'EA', price: '$167.05', note: '' },
          { key: 'ka19', category: 'Plumbing', item: 'Kitchen sink D&R or R&R', unit: 'EA', price: '—', note: '' },
          { key: 'ka20', category: '', item: 'Sink faucet - kitchen D&R', unit: 'EA', price: '$191.40', note: '' },
          { key: 'ka21', category: '', item: '`PLM DW` Dishwasher connection', unit: 'EA', price: '$197.23', note: '[miss]자주 빠짐' },
          { key: 'ka22', category: '', item: 'P-trap assembly', unit: 'EA', price: '—', note: '[miss]자주 빠짐' },
          { key: 'ka23', category: '', item: 'Plumbing supply line (x2)', unit: 'EA', price: '—', note: '[miss]자주 빠짐' },
        ],
      },
    ],
  },

  // ─── STAIRS ───
  {
    id: 'stairs', title: 'Stairs (계단)', tag: 'STR / FCW / FCC', tagColor: '#1a1a1a',
    navGroup: 'Rooms', navDotColor: '#4f8ef7',
    tables: [{
      columns: [
        { title: '항목', dataIndex: 'category', key: 'category' },
        { title: 'Line Item', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 's1', category: 'Carpet', item: '`FCC STP` Step charge - waterfall', unit: 'EA', price: '$10.35', note: 'step (rise) 수' },
        { key: 's2', category: '', item: '`FCC STP` Step charge - tucked high grade', unit: 'EA', price: '$14.88', note: '' },
        { key: 's3', category: 'Wood/Laminate', item: '`FCW FINSTP` Sand, stain, finish steps', unit: 'EA', price: '$16.18', note: '' },
        { key: 's4', category: '', item: '`FCW LAMST` Laminate step charge (tread+riser)', unit: 'EA', price: '$24.67', note: '' },
        { key: 's5', category: 'Paint', item: 'Paint stair stringer - one side', unit: 'LF', price: '—', note: 'Stair room 전용' },
        { key: 's6', category: 'Handrail', item: 'Detach & Reset Handrail - wall mounted', unit: 'LF', price: '—', note: 'Stair room 전용' },
        { key: 's7', category: 'Structure', item: '`STR3` Stairway - 3\' wide (8\' rise)', unit: 'EA', price: '$895.28', note: '' },
      ],
    }],
  },

  // ─── ELECTRICAL ───
  {
    id: 'electrical', title: 'Electrical (Water Damage)', tag: 'ELE', tagColor: '#1a1a1a',
    navGroup: 'Reference', navDotColor: '#b45309',
    rules: [
      {
        type: 'warning', title: 'Megohmmeter 테스트 (ELE MEG) — 언제 필요한가',
        items: [
          '**침수 (Flooding)** — 전기 콘센트·스위치 수위 이상 물에 잠김',
          '**Category 2 / 3 Water** — 오염수, 하수 접촉 시',
          '**대규모 누수** — 배관 파열로 벽 내부 배선까지 물이 침투',
          '**낙뢰 피해** — 서지로 인한 절연 손상 확인',
          '**화재 피해** — 열로 인한 절연 손상 확인',
          '보험사 adjuster가 테스트 요청하는 경우',
        ],
      },
      {
        type: 'info', title: 'Megohmmeter — 무엇을 검사하나',
        items: [
          '배선 피복(insulation)의 절연저항을 고전압(500~1000V DC)으로 측정',
          '물·오염·열 → 피복 손상 → 절연저항 감소 → 누전 위험',
          '합격 기준: 일반적으로 **1 MΩ 이상** (residential)',
          '불합격 → 해당 circuit 배선 교체 필요',
          '수치 변동이 심하면 → 수분 잔류 신호',
        ],
      },
      {
        type: 'success', title: 'Megohmmeter — 필요 없는 경우',
        items: [
          'Cat 1 clean water, 표면만 접촉, 즉시 건조',
          '물 피해 수위가 전기 콘센트·배선 높이 **이하**',
          '천장 누수 — 배선이 물에 직접 잠기지 않은 경우',
          '가전제품 물 튀김 수준의 경미한 접촉',
        ],
      },
    ],
    tables: [{
      columns: [
        { title: '항목', dataIndex: 'category', key: 'category' },
        { title: '코드', dataIndex: 'item', key: 'item', render: codeRender },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '가격', dataIndex: 'price', key: 'price', render: priceRender },
        { title: '비고', dataIndex: 'note', key: 'note', render: missRender },
      ],
      data: [
        { key: 'e1', category: 'Megohmmeter', item: '`ELE MEG` Megohmmeter check - single circuit', unit: 'EA', price: '$150.76', note: 'circuit 수만큼 EA' },
        { key: 'e2', category: '110V 배선', item: '`ELE 110` 110V copper wiring, box and outlet', unit: 'EA', price: '$107~$117', note: 'outlet 1개 = 1 EA' },
        { key: 'e3', category: '', item: '`ELE 110S` 110V wiring, box and switch', unit: 'EA', price: '$114.72', note: '' },
        { key: 'e4', category: '', item: '`ELE 110G` 110V wiring, box and GFI outlet', unit: 'EA', price: '$132.37', note: '욕실·주방 필수' },
        { key: 'e5', category: '', item: '`ELE GFITR` GFI outlet - tamper resistant', unit: 'EA', price: '$63.82', note: '교체 시 업그레이드' },
        { key: 'e6', category: '', item: '`ELE 110BOX` 110V wiring and box - rough-in only', unit: 'EA', price: '$90.30', note: '[excl]outlet·switch 미포함' },
        { key: 'e7', category: '', item: '`ELE 220` 220V wiring, box and receptacle', unit: 'EA', price: '$255.17', note: '건조기·에어컨 등' },
        { key: 'e8', category: '', item: '`ELE BRKAFCI` Arc-fault circuit-interrupter breaker', unit: 'EA', price: '$116.04', note: 'code upgrade supplement' },
        { key: 'e9', category: 'Breaker Panel', item: '`ELE BPNL100` Breaker panel - 100 amp', unit: 'EA', price: '$1,368', note: '[excl]main disconnect 별도' },
        { key: 'e10', category: '', item: '`ELE BPNL200` Breaker panel - 200 amp', unit: 'EA', price: '$2,220', note: '' },
        { key: 'e11', category: '', item: '`ELE BPA100` Breaker panel - 100 amp w/arc fault', unit: 'EA', price: '$1,900', note: '' },
        { key: 'e12', category: 'Safety', item: 'Smoke detector R&R', unit: 'EA', price: '—', note: '[miss]천장 작업시 자주 빠짐' },
        { key: 'e13', category: '', item: '`ELE CO` Carbon monoxide detector - High grade', unit: 'EA', price: '$123.90', note: '' },
        { key: 'e14', category: '', item: '`ELE CORS` CO detector - D&R', unit: 'EA', price: '$76.09', note: '' },
        { key: 'e15', category: '', item: '`ELE COSM` Combo CO/Smoke - Premium', unit: 'EA', price: '$257.75', note: '' },
        { key: 'e16', category: '욕실/주방', item: '`ELE BFANV` Bathroom ventilation fan - Premium', unit: 'EA', price: '$370.28', note: '[excl]ductwork 별도' },
        { key: 'e17', category: '', item: '`ELE BFANL` Bath fan with light - Premium', unit: 'EA', price: '$441.07', note: '' },
        { key: 'e18', category: '', item: '`ELE BFANVRS` Bathroom ventilation fan - D&R', unit: 'EA', price: '$85.43', note: 'tile 작업시' },
        { key: 'e19', category: '', item: 'GFI outlet - D&R', unit: 'EA', price: '—', note: '[miss]욕실·주방 tile 작업시 필수' },
      ],
    }],
  },

  // ─── SUPPLEMENT CHECKLIST ───
  {
    id: 'supplement', title: 'Supplement 체크리스트', tag: 'SUPPLEMENT', tagColor: '#d46b08',
    navGroup: 'Reference', navDotColor: '#b45309',
    rules: [
      {
        type: 'warning', title: 'Flooring',
        items: [
          'Carpet waste (10~15%) — Remove qty 아님',
          'LVP floor preparation',
          'Baseboard R&R (wood floor 교체시)',
          'Quarter round R&R (wood floor 교체시)',
          'Reducer strip (방 전환부)',
          'Tile cement board backer',
          'Grout sealer (tile, shower)',
          'Dustless floor sanding (hardwood)',
        ],
      },
      {
        type: 'warning', title: 'Bathroom',
        items: [
          'Toilet seat (toilet에 미포함)',
          'Waste & overflow drain (tub 교체시)',
          'Plumbing supply lines (x2)',
          'P-trap assembly',
          'Waterproof membrane (shower 필수)',
          'Shower drain',
          'Cement board backer (tile wall)',
          'GFI outlet D&R',
          'Exhaust fan D&R',
          'Tub enclosure door D&R (tub 작업시)',
        ],
      },
      {
        type: 'warning', title: 'Kitchen',
        items: [
          'Cabinet knobs/pulls (미포함)',
          'Cabinet hinges',
          'Dishwasher connection',
          'Garbage disposal',
          'P-trap assembly',
          'Supply lines (hot+cold)',
          'Sink cutout (granite/quartz)',
          'Countertop mitered corner',
          'Filler/scribe boards',
          'Backsplash (countertop 미포함)',
          'Toe kick re-skin',
        ],
      },
      {
        type: 'warning', title: 'Room / Drywall',
        items: [
          'Drywall gluing add-on',
          'Tape joint - new to existing drywall',
          'Texture (drywall 교체 후 기존 match)',
          'Seal stain blocker (얼룩 있을 때)',
          'Floor protection (hardwood 위 drywall 작업)',
          'Ceiling fan D&R',
          'Light fixture D&R',
          'HVAC register D&R',
          'Closet shelf and rod package',
          'Door slab paint (trim과 별도)',
        ],
      },
      {
        type: 'info', title: 'General Reminders',
        items: [
          'Contents - move out then reset (size 확인)',
          'Final cleaning - Residential',
          'Mask floor (drywall 작업시)',
          'Waste tool 실행 (carpet/vinyl)',
          'GCO&P 포함 확인',
          'Remove 수량 ≠ Install 수량 (waste 차이)',
          'Seal+Paint 합계 ≤ WC SF',
          'Cabinet D&R은 countertop 제외 → 별도 D&R',
        ],
      },
    ],
  },

  // ─── QTY CALCULATION ───
  {
    id: 'qty', title: 'Line Item 수량 계산', tag: 'QTY CALC', tagColor: '#1a1a1a',
    navGroup: 'Reference', navDotColor: '#1a1a1a',
    rules: [
      {
        type: 'success', title: 'Sketch 수량 우선순위 요약',
        items: [
          '페인트 전체 → **WC SF**',
          '벽만 페인트 → **W SF**',
          '천장만 페인트 → **C SF**',
          'Baseboard / QR / Crown → **LF Ceil Perim**',
          '바닥재 → **F SF** (carpet은 +waste)',
          'Drywall LF방식 → 실측 LF',
          '캐비닛 → 실측 LF (sketch 없음)',
        ],
      },
      {
        type: 'warning', title: '자주 틀리는 수량 실수',
        items: [
          'Remove 수량에 carpet waste 추가 → 오류!',
          'Seal + Paint 합산 > WC → 오류!',
          'Tape joint LF를 drywall SF로 입력 → 단위 오류',
          'Door trim EA를 한쪽만 계산 → 양면(×2) 확인',
          'Tub surround SF 계산 없이 tile SF 직접 입력 → 패키지 vs 개별 혼용',
          'Cabinet countertop을 SF로 입력 → LF로 변경',
        ],
      },
      {
        type: 'purple', title: '부분 작업 시 Qty 계산법',
        items: [
          '벽 1면만 교체: 실측 SF만 입력',
          'Tape joint: 교체 구간 4면 둘레 합계 LF',
          'Paint: 교체+인접 구간 SF (match 필요면 전체)',
          'Baseboard 일부만: 실제 교체 LF + 전체 LF paint',
          '카펫 일부: 실제 면적 SF + waste % (전체 방이면 F SF)',
        ],
      },
    ],
    tables: [{
      columns: [
        { title: 'Line Item', dataIndex: 'item_name', key: 'item_name' },
        { title: '수량 기준', dataIndex: 'unit', key: 'unit', render: unitRender },
        { title: '계산 방법', dataIndex: 'method', key: 'method' },
        { title: '예시', dataIndex: 'example', key: 'example' },
      ],
      data: [
        { key: 'q1', item_name: 'Paint walls + ceiling (같은 색)', unit: 'SF', method: 'qty = WC SF (Sketch 자동)', example: 'WC = 650 SF → 650 입력' },
        { key: 'q2', item_name: 'Baseboard paint / R&R', unit: 'LF', method: 'qty = LF Ceil Perimeter (문 개구부 제외 가능)', example: 'Ceil Perim 48 LF, 문 3ft × 2 = 42 LF' },
        { key: 'q3', item_name: 'Carpet — Remove', unit: 'SF', method: '실제 제거 면적 (= F SF, demo 제외). Waste 추가 안 함!', example: '200 SF 방, 50 SF demo → 150 SF' },
        { key: 'q4', item_name: 'Carpet — Install', unit: 'SF', method: '전체 F SF + Waste (10~15%)', example: '200 SF × 1.15 = 230 SF' },
        { key: 'q5', item_name: 'LVP / Laminate — Install', unit: 'SF', method: 'F SF (waste 가격에 포함. 별도 추가 불필요)', example: '' },
        { key: 'q6', item_name: 'Drywall per LF (하단 2\')', unit: 'LF', method: '손상된 벽의 선형 길이', example: '15ft 벽 → 15 LF' },
        { key: 'q7', item_name: 'Drywall SF (전체 벽)', unit: 'SF', method: '손상 벽 너비 × 높이', example: '10ft × 8ft = 80 SF' },
        { key: 'q8', item_name: 'Paint door trim & jamb', unit: 'EA/side', method: '문 1개 = 2 EA (양쪽)', example: '문 3개 → 6 EA' },
        { key: 'q9', item_name: 'Tub surround tile', unit: 'SF/EA', method: '3-wall: (32+60+32) × 72 / 144 ≈ 62 SF', example: '표준 5ft tub ≈ 60 SF' },
        { key: 'q10', item_name: 'Lower base cabinets', unit: 'LF', method: '캐비닛 앞면 총 너비 LF. 실측', example: '12" + 24" + 36" = 6 LF' },
        { key: 'q11', item_name: 'Countertop', unit: 'LF', method: '카운터 앞면 총 길이 LF (25" 폭 기준)', example: 'L자 코너 포함 전체 LF' },
        { key: 'q12', item_name: 'Cabinet knobs/pulls', unit: 'EA', method: '도어 수 + 서랍 수 = 총 EA', example: '도어 10 + 서랍 6 = 16 EA' },
        { key: 'q13', item_name: 'Megohmmeter test', unit: 'EA', method: 'circuit 수만큼 EA', example: '침실 2~3, 주방 4~6, 욕실 2~3 EA' },
      ],
    }],
  },
];

// ─── Group sections by navGroup for sidebar ───
const navGroups = sections.reduce<Record<string, { id: string; title: string; dotColor: string }[]>>((acc, s) => {
  if (!acc[s.navGroup]) acc[s.navGroup] = [];
  acc[s.navGroup].push({ id: s.id, title: s.title, dotColor: s.navDotColor });
  return acc;
}, {});

// ─── Render helpers ───
const ruleTypeToAlertType = (t: string): 'info' | 'warning' | 'success' | 'error' => {
  if (t === 'warning') return 'warning';
  if (t === 'success') return 'success';
  if (t === 'purple') return 'info';
  return 'info';
};

const ruleTypeToColor = (t: string): string => {
  if (t === 'warning') return '#fff7e6';
  if (t === 'success') return '#f6ffed';
  if (t === 'purple') return '#f9f0ff';
  return '#e6f4ff';
};

const ruleTypeToBorderColor = (t: string): string => {
  if (t === 'warning') return '#faad14';
  if (t === 'success') return '#52c41a';
  if (t === 'purple') return '#722ed1';
  return '#1677ff';
};

const formatText = (text: string): React.ReactNode => {
  // Handle bold markers **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={i} strong>{part.slice(2, -2)}</Text>;
    }
    // Handle code markers `text`
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith('`') && cp.endsWith('`')) {
        return <Tag key={`${i}-${j}`} color="default" style={{ fontFamily: 'monospace', fontSize: 11 }}>{cp.slice(1, -1)}</Tag>;
      }
      return <span key={`${i}-${j}`}>{cp}</span>;
    });
  });
};

// ─── Main Component ───
const XactimateCheatSheet: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const mainRef = useRef<HTMLDivElement>(null);

  const filteredSections = useMemo(() => {
    if (!searchText.trim()) return sections;
    const q = searchText.toLowerCase();
    return sections.filter(section => {
      // Check section title/tag
      if (section.title.toLowerCase().includes(q)) return true;
      if (section.tag.toLowerCase().includes(q)) return true;
      // Check rules
      if (section.rules?.some(r =>
        r.title.toLowerCase().includes(q) ||
        r.items.some(item => item.toLowerCase().includes(q))
      )) return true;
      // Check tables
      if (section.tables?.some(t =>
        t.data.some(row =>
          Object.values(row).some(v => v && v.toLowerCase().includes(q))
        )
      )) return true;
      return false;
    });
  }, [searchText]);

  // Count filtered table rows for search feedback
  const matchCount = useMemo(() => {
    if (!searchText.trim()) return 0;
    const q = searchText.toLowerCase();
    let count = 0;
    sections.forEach(s => {
      s.tables?.forEach(t => {
        t.data.forEach(row => {
          if (Object.values(row).some(v => v && v.toLowerCase().includes(q))) count++;
        });
      });
      s.rules?.forEach(r => {
        if (r.title.toLowerCase().includes(q) || r.items.some(i => i.toLowerCase().includes(q))) count++;
      });
    });
    return count;
  }, [searchText]);

  // Filter table data within sections when searching
  const getFilteredTableData = (data: TableRow[]) => {
    if (!searchText.trim()) return data;
    const q = searchText.toLowerCase();
    return data.filter(row =>
      Object.values(row).some(v => v && v.toLowerCase().includes(q))
    );
  };

  const shouldShowRule = (rule: RuleBox) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return rule.title.toLowerCase().includes(q) ||
      rule.items.some(item => item.toLowerCase().includes(q));
  };

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {/* Sidebar Anchor Navigation */}
      <div style={{
        width: 220,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        maxHeight: 'calc(100vh - 140px)',
        overflowY: 'auto',
        borderRight: '1px solid #f0f0f0',
        paddingRight: 12,
      }}>
        <div style={{ padding: '8px 0 16px', borderBottom: '1px solid #f0f0f0', marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0, fontFamily: 'monospace', letterSpacing: 1 }}>XACTIMATE</Title>
          <Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Estimator Cheat Sheet</Text>
        </div>
        <Anchor
          affix={false}
          offsetTop={80}
          items={Object.entries(navGroups).map(([group, items]) => ({
            key: group,
            href: `#${items[0].id}`,
            title: <Text type="secondary" style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{group}</Text>,
            children: items.map(item => ({
              key: item.id,
              href: `#${item.id}`,
              title: (
                <Space size={6}>
                  <Badge color={item.dotColor} />
                  <span style={{ fontSize: 12 }}>{item.title}</span>
                </Space>
              ),
            })),
          }))}
        />
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <a onClick={() => window.print()} style={{ fontSize: 12, cursor: 'pointer', color: '#666' }}>
            <PrinterOutlined /> Print / PDF
          </a>
        </div>
      </div>

      {/* Main Content */}
      <div ref={mainRef} style={{ flex: 1, minWidth: 0 }}>
        {/* Search Bar */}
        <div style={{ marginBottom: 24, position: 'sticky', top: 0, zIndex: 10, background: '#fff', paddingBottom: 8 }}>
          <Input
            size="large"
            placeholder="Search items, codes, descriptions..."
            prefix={<SearchOutlined style={{ color: '#aaa' }} />}
            suffix={searchText && <Text type="secondary" style={{ fontSize: 12 }}>{matchCount} items</Text>}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            allowClear
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>

        {filteredSections.length === 0 && (
          <Alert message="No matching items found" type="info" showIcon style={{ marginBottom: 24 }} />
        )}

        {/* Sections */}
        {filteredSections.map(section => (
          <div key={section.id} id={section.id} style={{ marginBottom: 40, scrollMarginTop: 60 }}>
            {/* Section Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
              paddingBottom: 10,
              borderBottom: '2px solid #1a1a1a',
            }}>
              <Title level={4} style={{ margin: 0, fontFamily: 'monospace' }}>{section.title}</Title>
              <Tag color={section.tagColor} style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11 }}>
                {section.tag}
              </Tag>
            </div>

            {/* Rules */}
            {section.rules && (
              <Row gutter={[12, 12]} style={{ marginBottom: section.tables ? 16 : 0 }}>
                {section.rules.filter(shouldShowRule).map((rule, i) => (
                  <Col key={i} xs={24} md={section.rules!.length > 2 ? 12 : section.rules!.length === 1 ? 24 : 12} lg={section.rules!.length > 2 ? (section.rules!.length > 4 ? 8 : 12) : section.rules!.length === 1 ? 24 : 12}>
                    <Card
                      size="small"
                      style={{
                        height: '100%',
                        background: ruleTypeToColor(rule.type),
                        borderLeft: `3px solid ${ruleTypeToBorderColor(rule.type)}`,
                        borderColor: '#f0f0f0',
                      }}
                    >
                      <Text strong style={{
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: ruleTypeToBorderColor(rule.type),
                        display: 'block',
                        marginBottom: 8,
                      }}>
                        {rule.title}
                      </Text>
                      <ul style={{ paddingLeft: 16, margin: 0 }}>
                        {rule.items.map((item, j) => (
                          <li key={j} style={{ fontSize: 12, color: '#555', lineHeight: 1.8 }}>
                            {formatText(item)}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}

            {/* Tables */}
            {section.tables?.map((table, ti) => {
              const filteredData = getFilteredTableData(table.data);
              if (searchText && filteredData.length === 0) return null;
              return (
                <div key={ti} style={{ marginTop: ti > 0 ? 12 : 0 }}>
                  <Table
                    columns={table.columns}
                    dataSource={filteredData}
                    pagination={false}
                    size="small"
                    bordered
                    scroll={{ x: 'max-content' }}
                    style={{ fontSize: 12 }}
                    rowClassName={(_, index) => index % 2 === 0 ? '' : 'ant-table-row-stripe'}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default XactimateCheatSheet;
