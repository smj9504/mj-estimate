/**
 * Cheat Sheet - API Service
 */

import api from './api';

const PREFIX = '/api/cheatsheet';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CSRow {
  id: string;
  table_id: string;
  row_key: string;
  data: Record<string, string | undefined>;
  note: string | null;
  sort_order: number;
}

export interface CSTable {
  id: string;
  section_id: string;
  columns: Array<{ title: string; dataIndex: string; key: string; render?: string }>;
  sort_order: number;
  rows: CSRow[];
}

export interface CSRule {
  id: string;
  section_id: string;
  rule_type: string;
  title: string;
  items: string[];
  sort_order: number;
}

export interface CSSection {
  id: string;
  section_key: string;
  title: string;
  tag: string;
  tag_color: string;
  nav_group: string;
  nav_dot_color: string;
  sort_order: number;
  is_active: boolean;
  rules: CSRule[];
  tables: CSTable[];
}

// ─── Sections ───────────────────────────────────────────────────────────────

export const getSections = async (activeOnly = true): Promise<CSSection[]> => {
  const { data } = await api.get(`${PREFIX}/sections`, { params: { active_only: activeOnly } });
  return data;
};

export const createSection = async (body: {
  section_key: string; title: string; tag: string; tag_color?: string;
  nav_group: string; nav_dot_color?: string; sort_order?: number;
}): Promise<CSSection> => {
  const { data } = await api.post(`${PREFIX}/sections`, body);
  return data;
};

export const updateSection = async (id: string, body: Partial<{
  title: string; tag: string; tag_color: string;
  nav_group: string; nav_dot_color: string; sort_order: number; is_active: boolean;
}>): Promise<CSSection> => {
  const { data } = await api.put(`${PREFIX}/sections/${id}`, body);
  return data;
};

export const deleteSection = async (id: string): Promise<void> => {
  await api.delete(`${PREFIX}/sections/${id}`);
};

// ─── Rules ──────────────────────────────────────────────────────────────────

export const createRule = async (body: {
  section_id: string; rule_type?: string; title: string; items?: string[]; sort_order?: number;
}): Promise<CSRule> => {
  const { data } = await api.post(`${PREFIX}/rules`, body);
  return data;
};

export const updateRule = async (id: string, body: Partial<{
  rule_type: string; title: string; items: string[]; sort_order: number;
}>): Promise<CSRule> => {
  const { data } = await api.put(`${PREFIX}/rules/${id}`, body);
  return data;
};

export const deleteRule = async (id: string): Promise<void> => {
  await api.delete(`${PREFIX}/rules/${id}`);
};

// ─── Tables ─────────────────────────────────────────────────────────────────

export const createTable = async (body: {
  section_id: string; columns: CSTable['columns']; sort_order?: number;
}): Promise<CSTable> => {
  const { data } = await api.post(`${PREFIX}/tables`, body);
  return data;
};

export const updateTable = async (id: string, body: Partial<{
  columns: CSTable['columns']; sort_order: number;
}>): Promise<CSTable> => {
  const { data } = await api.put(`${PREFIX}/tables/${id}`, body);
  return data;
};

export const deleteTable = async (id: string): Promise<void> => {
  await api.delete(`${PREFIX}/tables/${id}`);
};

// ─── Rows ───────────────────────────────────────────────────────────────────

export const createRow = async (body: {
  table_id: string; row_key: string; data: Record<string, any>; note?: string; sort_order?: number;
}): Promise<CSRow> => {
  const { data } = await api.post(`${PREFIX}/rows`, body);
  return data;
};

export const updateRow = async (id: string, body: Partial<{
  data: Record<string, any>; note: string | null; sort_order: number;
}>): Promise<CSRow> => {
  const { data } = await api.put(`${PREFIX}/rows/${id}`, body);
  return data;
};

export const updateRowNote = async (id: string, note: string | null): Promise<CSRow> => {
  const { data } = await api.patch(`${PREFIX}/rows/${id}/note`, { note });
  return data;
};

export const deleteRow = async (id: string): Promise<void> => {
  await api.delete(`${PREFIX}/rows/${id}`);
};
