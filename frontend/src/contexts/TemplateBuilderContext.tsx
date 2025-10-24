/**
 * Template Builder Context
 * Global state management for building and managing line item templates
 * Supports multiple workflows: section-based, item selection, and template editing
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { message } from 'antd';
import lineItemService from '../services/lineItemService';
import { LineItemTemplate } from '../types/lineItem';

interface TemplateBuilderItem {
  // Source information
  line_item_id?: string;  // Line item library reference
  source_item_id?: string; // Invoice/Estimate item ID

  // Display information
  name: string;
  description?: string;
  unit: string;
  rate: number;

  // Template information
  quantity_multiplier: number;
  order_index: number;

  // Selection state
  selected?: boolean;
  source_section?: string;

  // Allow any additional properties from source items
  [key: string]: any;
}

interface TemplateBuilderState {
  // Builder mode
  isBuilderOpen: boolean;

  // Items being worked on
  builderItems: TemplateBuilderItem[];

  // Selected items (for selection mode)
  selectedItemIds: Set<string>;

  // Current template being edited (if editing existing)
  editingTemplate?: LineItemTemplate;

  // Template metadata
  templateName: string;
  templateDescription: string;
  templateCategory: string;
  companyId?: string;
}

interface TemplateBuilderContextType extends TemplateBuilderState {
  // Builder actions
  openBuilder: (mode: 'new' | 'edit', template?: LineItemTemplate) => void;
  closeBuilder: () => void;

  // Item selection (Method 1: Select items)
  toggleItemSelection: (itemId: string) => void;
  selectMultipleItems: (itemIds: string[]) => void;
  clearSelection: () => void;
  addSelectedItemsToBuilder: (items: TemplateBuilderItem[]) => void;

  // Section operations (Method 2: Quick section save)
  addSectionToBuilder: (sectionTitle: string, items: TemplateBuilderItem[]) => void;
  saveSectionAsNewTemplate: (sectionTitle: string, items: TemplateBuilderItem[], companyId?: string) => Promise<LineItemTemplate | null>;

  // Template operations (Method 3: Template management)
  loadTemplate: (template: LineItemTemplate) => void;
  addItemsToTemplate: (items: TemplateBuilderItem[]) => void;
  removeItemFromBuilder: (index: number) => void;
  reorderBuilderItems: (oldIndex: number, newIndex: number) => void;
  updateBuilderItem: (index: number, updates: Partial<TemplateBuilderItem>) => void;

  // Save operations
  saveTemplate: (companyId?: string) => Promise<LineItemTemplate | null>;
  updateTemplate: (templateId: string) => Promise<LineItemTemplate | null>;

  // Metadata
  setTemplateName: (name: string) => void;
  setTemplateDescription: (description: string) => void;
  setTemplateCategory: (category: string) => void;
  setCompanyId: (companyId: string) => void;
}

const TemplateBuilderContext = createContext<TemplateBuilderContextType | undefined>(undefined);

export const TemplateBuilderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<TemplateBuilderState>({
    isBuilderOpen: false,
    builderItems: [],
    selectedItemIds: new Set(),
    templateName: '',
    templateDescription: '',
    templateCategory: '',
  });

  // Builder lifecycle
  const openBuilder = useCallback((mode: 'new' | 'edit', template?: LineItemTemplate) => {
    if (mode === 'edit' && template) {
      setState(prev => ({
        ...prev,
        isBuilderOpen: true,
        editingTemplate: template,
        builderItems: template.template_items?.map((ti, idx) => {
          // Handle embedded items vs library references
          if (ti.embedded_data) {
            return {
              line_item_id: undefined,
              name: ti.embedded_data.item_code,
              description: ti.embedded_data.description,
              unit: ti.embedded_data.unit,
              rate: Number(ti.embedded_data.rate) || 0,
              quantity_multiplier: Number(ti.quantity_multiplier) || 1,
              order_index: idx,
            };
          } else {
            // Library reference item
            return {
              line_item_id: ti.line_item_id,
              name: ti.line_item?.name || '',
              description: ti.line_item?.description || '',
              unit: ti.line_item?.unit || 'EA',
              rate: Number(ti.line_item?.untaxed_unit_price) || 0,
              quantity_multiplier: Number(ti.quantity_multiplier) || 1,
              order_index: idx,
            };
          }
        }) || [],
        templateName: template.name,
        templateDescription: template.description || '',
        templateCategory: template.category || '',
      }));
    } else {
      setState(prev => ({
        ...prev,
        isBuilderOpen: true,
        editingTemplate: undefined,
      }));
    }
  }, []);

  const closeBuilder = useCallback(() => {
    setState(prev => ({
      ...prev,
      isBuilderOpen: false,
      builderItems: [],
      editingTemplate: undefined,
      templateName: '',
      templateDescription: '',
      templateCategory: '',
    }));
  }, []);

  // Item selection (Method 1)
  const toggleItemSelection = useCallback((itemId: string) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedItemIds);
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
      return { ...prev, selectedItemIds: newSelected };
    });
  }, []);

  const selectMultipleItems = useCallback((itemIds: string[]) => {
    setState(prev => ({
      ...prev,
      selectedItemIds: new Set(itemIds),
    }));
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedItemIds: new Set(),
    }));
  }, []);

  const addSelectedItemsToBuilder = useCallback((items: TemplateBuilderItem[]) => {
    setState(prev => {
      const currentMaxOrder = Math.max(...prev.builderItems.map(i => i.order_index), -1);
      const newItems = items.map((item, idx) => ({
        ...item,
        order_index: currentMaxOrder + idx + 1,
      }));

      return {
        ...prev,
        builderItems: [...prev.builderItems, ...newItems],
        isBuilderOpen: true,
      };
    });
    message.success(`${items.length} item(s) added to template builder`);
  }, []);

  // Section operations (Method 2)
  const addSectionToBuilder = useCallback((sectionTitle: string, items: TemplateBuilderItem[]) => {
    setState(prev => {
      const currentMaxOrder = Math.max(...prev.builderItems.map(i => i.order_index), -1);
      const newItems = items.map((item, idx) => ({
        ...item,
        source_section: sectionTitle,
        order_index: currentMaxOrder + idx + 1,
      }));

      return {
        ...prev,
        builderItems: [...prev.builderItems, ...newItems],
        isBuilderOpen: true,
        templateName: prev.templateName || sectionTitle,
      };
    });
    message.success(`Section "${sectionTitle}" added to template builder`);
  }, []);

  const saveSectionAsNewTemplate = useCallback(async (
    sectionTitle: string,
    items: TemplateBuilderItem[],
    companyId?: string
  ): Promise<LineItemTemplate | null> => {
    try {
      if (items.length === 0) {
        message.warning('No items to save as template.');
        return null;
      }

      const templateData = {
        name: sectionTitle,
        description: `Auto-created from section: ${sectionTitle}`,
        category: '',
        company_id: companyId,
        line_item_ids: items.map((item, index) => {
          // If item has line_item_id, use reference mode
          if (item.line_item_id || (item as any).line_item_id) {
            return {
              line_item_id: item.line_item_id || (item as any).line_item_id,
              quantity_multiplier: item.quantity_multiplier || 1,
              order_index: index,
            };
          }

          // Otherwise, use embedded mode
          const itemRate = item.rate || 0;
          if (itemRate <= 0) {
            console.warn(`Item "${item.name}" has invalid rate: ${itemRate}. Using 1.0 as default.`);
          }

          return {
            quantity_multiplier: item.quantity_multiplier || 1,
            order_index: index,
            embedded_data: {
              item_code: item.name || 'Unknown',
              description: item.description || item.name || '',
              unit: item.unit || 'EA',
              rate: itemRate > 0 ? itemRate : 1.0,  // Ensure rate > 0
            }
          };
        }),
      };

      console.log('=== TEMPLATE DATA TO BE SENT ===');
      console.log(JSON.stringify(templateData, null, 2));

      const newTemplate = await lineItemService.createTemplate(templateData);
      message.success(`Template "${newTemplate.name}" created successfully`);
      return newTemplate;
    } catch (error: any) {
      console.error('Failed to create template:', error);
      message.error(error.message || 'Failed to create template');
      return null;
    }
  }, []);

  // Template operations (Method 3)
  const loadTemplate = useCallback((template: LineItemTemplate) => {
    setState(prev => ({
      ...prev,
      editingTemplate: template,
      builderItems: template.template_items?.map((ti, idx) => {
        // Handle embedded items vs library references
        if (ti.embedded_data) {
          return {
            line_item_id: undefined,
            name: ti.embedded_data.item_code,
            description: ti.embedded_data.description,
            unit: ti.embedded_data.unit,
            rate: Number(ti.embedded_data.rate) || 0,
            quantity_multiplier: Number(ti.quantity_multiplier) || 1,
            order_index: idx,
          };
        } else {
          // Library reference item
          return {
            line_item_id: ti.line_item_id,
            name: ti.line_item?.name || '',
            description: ti.line_item?.description || '',
            unit: ti.line_item?.unit || 'EA',
            rate: Number(ti.line_item?.untaxed_unit_price) || 0,
            quantity_multiplier: Number(ti.quantity_multiplier) || 1,
            order_index: idx,
          };
        }
      }) || [],
      templateName: template.name,
      templateDescription: template.description || '',
      templateCategory: template.category || '',
      isBuilderOpen: true,
    }));
  }, []);

  const addItemsToTemplate = useCallback((items: TemplateBuilderItem[]) => {
    setState(prev => {
      const currentMaxOrder = Math.max(...prev.builderItems.map(i => i.order_index), -1);
      const newItems = items.map((item, idx) => ({
        ...item,
        order_index: currentMaxOrder + idx + 1,
      }));

      return {
        ...prev,
        builderItems: [...prev.builderItems, ...newItems],
      };
    });
  }, []);

  const removeItemFromBuilder = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      builderItems: prev.builderItems.filter((_, idx) => idx !== index),
    }));
  }, []);

  const reorderBuilderItems = useCallback((oldIndex: number, newIndex: number) => {
    setState(prev => {
      const items = [...prev.builderItems];
      const [removed] = items.splice(oldIndex, 1);
      items.splice(newIndex, 0, removed);

      // Update order indices
      const reorderedItems = items.map((item, idx) => ({
        ...item,
        order_index: idx,
      }));

      return {
        ...prev,
        builderItems: reorderedItems,
      };
    });
  }, []);

  const updateBuilderItem = useCallback((index: number, updates: Partial<TemplateBuilderItem>) => {
    setState(prev => ({
      ...prev,
      builderItems: prev.builderItems.map((item, idx) => {
        if (idx === index) {
          // Ensure rate is properly converted to number
          const updatedItem = { ...item, ...updates };
          if (updates.rate !== undefined) {
            updatedItem.rate = Number(updates.rate) || 0;
          }
          return updatedItem;
        }
        return item;
      }),
    }));
  }, []);

  // Save operations
  const saveTemplate = useCallback(async (companyId?: string): Promise<LineItemTemplate | null> => {
    try {
      if (state.builderItems.length === 0) {
        message.error('No items to save');
        return null;
      }

      if (!state.templateName.trim()) {
        message.error('Please enter a template name');
        return null;
      }

      const templateData = {
        name: state.templateName,
        description: state.templateDescription,
        category: state.templateCategory,
        company_id: companyId || state.companyId,
        line_item_ids: state.builderItems.map(item => {
          // If item has line_item_id, use reference mode
          if (item.line_item_id) {
            return {
              line_item_id: item.line_item_id,
              quantity_multiplier: item.quantity_multiplier,
              order_index: item.order_index,
            };
          }

          // Otherwise, use embedded mode
          const itemRate = item.rate || 0;
          if (itemRate <= 0) {
            console.warn(`Item "${item.name}" has invalid rate: ${itemRate}. Using 1.0 as default.`);
          }

          return {
            quantity_multiplier: item.quantity_multiplier,
            order_index: item.order_index,
            embedded_data: {
              item_code: item.name || 'Unknown',
              description: item.description || item.name || '',
              unit: item.unit || 'EA',
              rate: itemRate > 0 ? itemRate : 1.0,  // Ensure rate > 0
            }
          };
        }),
      };

      console.log('=== SAVE TEMPLATE DATA ===');
      console.log(JSON.stringify(templateData, null, 2));

      const newTemplate = await lineItemService.createTemplate(templateData);
      message.success(`Template "${newTemplate.name}" saved successfully`);
      closeBuilder();
      return newTemplate;
    } catch (error: any) {
      message.error(error.message || 'Failed to save template');
      return null;
    }
  }, [state, closeBuilder]);

  const updateTemplate = useCallback(async (templateId: string): Promise<LineItemTemplate | null> => {
    try {
      if (state.builderItems.length === 0) {
        message.error('No items to save');
        return null;
      }

      const updates = {
        name: state.templateName,
        description: state.templateDescription,
        category: state.templateCategory,
        line_item_ids: state.builderItems.map(item => {
          // If item has line_item_id, use reference mode
          if (item.line_item_id) {
            return {
              line_item_id: item.line_item_id,
              quantity_multiplier: item.quantity_multiplier,
              order_index: item.order_index,
            };
          }

          // Otherwise, use embedded mode
          const itemRate = item.rate || 0;
          if (itemRate <= 0) {
            console.warn(`Item "${item.name}" has invalid rate: ${itemRate}. Using 1.0 as default.`);
          }

          return {
            quantity_multiplier: item.quantity_multiplier,
            order_index: item.order_index,
            embedded_data: {
              item_code: item.name || 'Unknown',
              description: item.description || item.name || '',
              unit: item.unit || 'EA',
              rate: itemRate > 0 ? itemRate : 1.0,  // Ensure rate > 0
            }
          };
        }),
      };

      console.log('=== UPDATE TEMPLATE DATA ===');
      console.log(JSON.stringify(updates, null, 2));

      const updatedTemplate = await lineItemService.updateTemplate(templateId, updates);
      message.success(`Template "${updatedTemplate.name}" updated successfully`);
      closeBuilder();
      return updatedTemplate;
    } catch (error: any) {
      message.error(error.message || 'Failed to update template');
      return null;
    }
  }, [state, closeBuilder]);

  // Metadata setters
  const setTemplateName = useCallback((name: string) => {
    setState(prev => ({ ...prev, templateName: name }));
  }, []);

  const setTemplateDescription = useCallback((description: string) => {
    setState(prev => ({ ...prev, templateDescription: description }));
  }, []);

  const setTemplateCategory = useCallback((category: string) => {
    setState(prev => ({ ...prev, templateCategory: category }));
  }, []);

  const setCompanyId = useCallback((companyId: string) => {
    setState(prev => ({ ...prev, companyId }));
  }, []);

  const value: TemplateBuilderContextType = {
    ...state,
    openBuilder,
    closeBuilder,
    toggleItemSelection,
    selectMultipleItems,
    clearSelection,
    addSelectedItemsToBuilder,
    addSectionToBuilder,
    saveSectionAsNewTemplate,
    loadTemplate,
    addItemsToTemplate,
    removeItemFromBuilder,
    reorderBuilderItems,
    updateBuilderItem,
    saveTemplate,
    updateTemplate,
    setTemplateName,
    setTemplateDescription,
    setTemplateCategory,
    setCompanyId,
  };

  return (
    <TemplateBuilderContext.Provider value={value}>
      {children}
    </TemplateBuilderContext.Provider>
  );
};

export const useTemplateBuilder = () => {
  const context = useContext(TemplateBuilderContext);
  if (!context) {
    throw new Error('useTemplateBuilder must be used within TemplateBuilderProvider');
  }
  return context;
};
