/**
 * Xactimate Helper Tool - API Service
 */

import api from './api';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  CorrectionCreateRequest,
  CorrectionFeedback,
  DescriptionCreateRequest,
  DescriptionUpdateRequest,
  EmbeddingSyncRequest,
  EmbeddingSyncResponse,
  RecommendedItem,
  XactAssembly,
  XactAssemblyCreateRequest,
  XactItemDescription,
  XactLineItem,
  XactLineItemSearchResult,
  XactRoom,
  XactRoomCreateRequest,
  XactRoomUpdateRequest,
} from '../types/xactimateHelper';

const PREFIX = '/api/xactimate';

// ─── Room CRUD ───────────────────────────────────────────────────────────────

export const createRoom = async (data: XactRoomCreateRequest): Promise<XactRoom> => {
  const res = await api.post(`${PREFIX}/rooms`, data);
  return res.data;
};

export const getRoom = async (roomId: string): Promise<XactRoom> => {
  const res = await api.get(`${PREFIX}/rooms/${roomId}`);
  return res.data;
};

export const updateRoom = async (roomId: string, data: XactRoomUpdateRequest): Promise<XactRoom> => {
  const res = await api.patch(`${PREFIX}/rooms/${roomId}`, data);
  return res.data;
};

// ─── AI Analysis ─────────────────────────────────────────────────────────────

export const analyzeRoom = async (roomId: string, data: AnalyzeRequest): Promise<AnalyzeResponse> => {
  const res = await api.post(`${PREFIX}/rooms/${roomId}/analyze`, data);
  return res.data;
};

export const getRecommendations = async (roomId: string) => {
  const res = await api.get(`${PREFIX}/rooms/${roomId}/recommendations`);
  return res.data;
};

// ─── Corrections ─────────────────────────────────────────────────────────────

export const saveCorrection = async (
  roomId: string,
  data: CorrectionCreateRequest
): Promise<CorrectionFeedback> => {
  const res = await api.post(`${PREFIX}/rooms/${roomId}/corrections`, data);
  return res.data;
};

export const getCorrections = async (roomId: string): Promise<CorrectionFeedback[]> => {
  const res = await api.get(`${PREFIX}/rooms/${roomId}/corrections`);
  return res.data;
};

// ─── Confirmed Line Items ────────────────────────────────────────────────────

export const getRoomLineItems = async (roomId: string): Promise<RecommendedItem[]> => {
  const res = await api.get(`${PREFIX}/rooms/${roomId}/line-items`);
  return res.data;
};

// ─── Descriptions ────────────────────────────────────────────────────────────

export const getItemDescriptions = async (
  itemCode: string,
  descriptionType?: string,
  approvedOnly?: boolean
): Promise<XactItemDescription[]> => {
  const params: Record<string, any> = {};
  if (descriptionType) params.description_type = descriptionType;
  if (approvedOnly) params.approved_only = true;
  const res = await api.get(`${PREFIX}/helper/line-items/${itemCode}/descriptions`, { params });
  return res.data;
};

export const createDescription = async (data: DescriptionCreateRequest): Promise<XactItemDescription> => {
  const res = await api.post(`${PREFIX}/descriptions`, data);
  return res.data;
};

export const updateDescription = async (
  descId: string,
  data: DescriptionUpdateRequest
): Promise<XactItemDescription> => {
  const res = await api.patch(`${PREFIX}/descriptions/${descId}`, data);
  return res.data;
};

export const approveDescription = async (descId: string): Promise<XactItemDescription> => {
  const res = await api.patch(`${PREFIX}/descriptions/${descId}/approve`);
  return res.data;
};

export const recordDescriptionCopy = async (descId: string) => {
  const res = await api.post(`${PREFIX}/descriptions/${descId}/copy`);
  return res.data;
};

export const generateDescriptions = async (
  itemCode: string,
  damageType: string = 'general',
  roomType: string = 'any'
) => {
  const res = await api.post(
    `${PREFIX}/helper/line-items/${itemCode}/generate-descriptions`,
    null,
    { params: { damage_type: damageType, room_type: roomType } }
  );
  return res.data;
};

// ─── Assemblies ──────────────────────────────────────────────────────────────

export const getAssemblies = async (
  damageType?: string,
  roomType?: string
): Promise<XactAssembly[]> => {
  const params: Record<string, any> = {};
  if (damageType) params.damage_type = damageType;
  if (roomType) params.room_type = roomType;
  const res = await api.get(`${PREFIX}/helper/assemblies`, { params });
  return res.data;
};

export const createAssembly = async (data: XactAssemblyCreateRequest): Promise<XactAssembly> => {
  const res = await api.post(`${PREFIX}/helper/assemblies`, data);
  return res.data;
};

export const getAssembly = async (assemblyId: string): Promise<XactAssembly> => {
  const res = await api.get(`${PREFIX}/helper/assemblies/${assemblyId}`);
  return res.data;
};

// ─── Helper Line Items ────────────────────────────────────��──────────────────

export const searchHelperLineItems = async (
  query?: string,
  category?: string,
  isActive?: boolean,
  limit: number = 20,
  offset: number = 0
): Promise<XactLineItemSearchResult> => {
  const params: Record<string, any> = { limit, offset };
  if (query) params.query = query;
  if (category) params.category = category;
  if (isActive !== undefined) params.is_active = isActive;
  const res = await api.get(`${PREFIX}/helper/line-items`, { params });
  return res.data;
};

export const getHelperCategories = async (): Promise<string[]> => {
  const res = await api.get(`${PREFIX}/helper/line-items/categories`);
  return res.data;
};

export const getHelperLineItem = async (itemCode: string): Promise<XactLineItem> => {
  const res = await api.get(`${PREFIX}/helper/line-items/${itemCode}`);
  return res.data;
};

// ─── Embedding Sync (Admin) ──────────────────────────────────────────────────

export const syncEmbeddings = async (data: EmbeddingSyncRequest): Promise<EmbeddingSyncResponse> => {
  const res = await api.post(`${PREFIX}/embed/sync`, data);
  return res.data;
};
