import { create } from 'zustand';
import { Company, Document, DocumentFilter, WorkOrder, Trade, Credit } from '../types';

interface AppState {
  // Company state
  companies: Company[];
  selectedCompany: Company | null;
  setCompanies: (companies: Company[]) => void;
  setSelectedCompany: (company: Company | null) => void;
  
  // Document state
  documents: Document[];
  documentFilter: DocumentFilter;
  setDocuments: (documents: Document[]) => void;
  setDocumentFilter: (filter: DocumentFilter) => void;
  
  // Work Order state
  workOrders: WorkOrder[];
  currentWorkOrder: WorkOrder | null;
  availableTrades: Trade[];
  availableCredits: Credit[];
  setWorkOrders: (workOrders: WorkOrder[]) => void;
  setCurrentWorkOrder: (workOrder: WorkOrder | null) => void;
  setAvailableTrades: (trades: Trade[]) => void;
  setAvailableCredits: (credits: Credit[]) => void;
  
  // UI state
  loading: boolean;
  error: string | null;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Current document being edited
  currentDocument: Document | null;
  setCurrentDocument: (document: Document | null) => void;
}

export const useStore = create<AppState>((set) => ({
  // Company state
  companies: [],
  selectedCompany: null,
  setCompanies: (companies) => set({ companies }),
  setSelectedCompany: (company) => set({ selectedCompany: company }),
  
  // Document state
  documents: [],
  documentFilter: {},
  setDocuments: (documents) => set({ documents }),
  setDocumentFilter: (filter) => set({ documentFilter: filter }),
  
  // Work Order state
  workOrders: [],
  currentWorkOrder: null,
  availableTrades: [],
  availableCredits: [],
  setWorkOrders: (workOrders) => set({ workOrders }),
  setCurrentWorkOrder: (workOrder) => set({ currentWorkOrder: workOrder }),
  setAvailableTrades: (trades) => set({ availableTrades: trades }),
  setAvailableCredits: (credits) => set({ availableCredits: credits }),
  
  // UI state
  loading: false,
  error: null,
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  
  // Current document
  currentDocument: null,
  setCurrentDocument: (document) => set({ currentDocument: document }),
}));