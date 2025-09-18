import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Form,
  Input,
  Button,
  DatePicker,
  InputNumber,
  Select,
  Card,
  Row,
  Col,
  Space,
  Modal,
  message,
  Divider,
  Typography,
  Tooltip,
  Popconfirm,
  Collapse,
  Tag,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  EditOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import DraggableTable from '../components/common/DraggableTable';
import SortableSection from '../components/common/SortableSection';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import RichTextEditor from '../components/editor/RichTextEditor';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { estimateService, EstimateLineItem, InsuranceEstimate, EstimateSection } from '../services/EstimateService';
import { companyService } from '../services/companyService';
import { Company } from '../types';
import UnitSelect from '../components/common/UnitSelect';
import { DEFAULT_UNIT } from '../constants/units';

const { Title } = Typography;

const EstimateCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(false);
  
  // Section-based state
  const [sections, setSections] = useState<EstimateSection[]>([]);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  
  // Other states
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // Section drag and drop states
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<EstimateLineItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [useCustomCompany, setUseCustomCompany] = useState(false);

  // Multi-select state
  const [selectedItemKeys, setSelectedItemKeys] = useState<{[sectionIndex: number]: string[]}>({});
  
  // O&P and calculations
  const [opPercent, setOpPercent] = useState(0);
  const [sectionModalVisible, setSectionModalVisible] = useState(false);
  const [editingSectionName, setEditingSectionName] = useState<string>('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

  // Rich text editor states
  const [currentItemDescription, setCurrentItemDescription] = useState('');
  const [currentItemNote, setCurrentItemNote] = useState('');


  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
  ];

  const loadCompanies = useCallback(async () => {
    try {
      const data = await companyService.getCompanies();
      setCompanies(data);
      // Don't auto-select any company - let user choose explicitly
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  }, [isEditMode]);

  const loadEstimate = useCallback(async () => {
    if (!id) return;
    
    setLoading(true);
    try {
      const estimate = await estimateService.getEstimate(id);
      
      // Set form values
      form.setFieldsValue({
        estimate_number: estimate.estimate_number,
        client_name: estimate.client_name,
        client_address: estimate.client_address,
        client_phone: estimate.client_phone,
        client_email: estimate.client_email,
        estimate_date: estimate.estimate_date ? dayjs(estimate.estimate_date) : dayjs(),
        claim_number: estimate.claim_number,
        policy_number: estimate.policy_number,
        deductible: estimate.deductible,
        notes: estimate.notes,
        terms: estimate.terms,
        status: estimate.status || 'draft',
      });
      
      // Convert items to sections or use existing sections
      if (estimate.sections && estimate.sections.length > 0) {
        setSections(estimate.sections);
      } else {
        const sectionsFromItems = convertItemsToSections(estimate.items || []);
        setSections(sectionsFromItems);
      }
      
      // Set O&P percent
      if (estimate.op_percent) {
        setOpPercent(estimate.op_percent);
      }
      
      // Set company
      if (estimate.company_id) {
        const company = companies.find(c => c.id === estimate.company_id);
        if (company) {
          setSelectedCompany(company);
          setUseCustomCompany(false);
          form.setFieldValue('company_selection', company.id);
        }
      }
      
    } catch (error) {
      console.error('Failed to load estimate:', error);
      message.error('Failed to load estimate');
    } finally {
      setLoading(false);
    }
  }, [id, form, companies]);

  const convertItemsToSections = (items: EstimateLineItem[]): EstimateSection[] => {
    const groupedItems: { [key: string]: EstimateLineItem[] } = {};
    
    items.forEach(item => {
      const groupKey = item.primary_group || 'Default Section';
      if (!groupedItems[groupKey]) {
        groupedItems[groupKey] = [];
      }
      groupedItems[groupKey].push(item);
    });
    
    return Object.entries(groupedItems).map(([title, groupItems], index) => ({
      id: `section-${index}`,
      title,
      items: groupItems,
      showSubtotal: true,
      subtotal: groupItems.reduce((sum, item) => sum + (item.total || 0), 0),
    }));
  };

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    if (companies.length > 0 && id) {
      loadEstimate();
    }
  }, [companies, id, loadEstimate]);

  // Section management functions
  const addSection = () => {
    if (!newSectionTitle.trim()) {
      message.warning('Please enter a section title');
      return;
    }
    
    const newSection: EstimateSection = {
      id: `section-${Date.now()}`,
      title: newSectionTitle.trim(),
      items: [],
      showSubtotal: true,
      subtotal: 0,
    };
    
    setSections([...sections, newSection]);
    setNewSectionTitle('');
    message.success('Section added successfully');
  };

  const deleteSection = (sectionIndex: number) => {
    const newSections = sections.filter((_, index) => index !== sectionIndex);
    setSections(newSections);
    message.success('Section deleted successfully');
  };

  // Section drag and drop handlers
  const sectionSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSectionDragStart = (event: DragStartEvent) => {
    setActiveSectionId(event.active.id as string);
  };

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveSectionId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sections.findIndex(section => section.id === active.id);
    const newIndex = sections.findIndex(section => section.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const newSections = arrayMove(sections, oldIndex, newIndex);
      setSections(newSections);
    }
  };

  const updateSectionTitle = (sectionIndex: number, newTitle: string) => {
    const newSections = [...sections];
    newSections[sectionIndex].title = newTitle;
    setSections(newSections);
  };

  // Item management functions
  const addItemToSection = (sectionIndex: number) => {
    setEditingSectionIndex(sectionIndex);
    setEditingItem(null);
    setEditingIndex(null);
    setCurrentItemDescription('');
    setCurrentItemNote('');
    itemForm.resetFields();
    itemForm.setFieldsValue({
      quantity: 1,
      unit: DEFAULT_UNIT,
      unit_price: 0,
    });
    setItemModalVisible(true);
  };

  const editItemInSection = (sectionIndex: number, itemIndex: number) => {
    const item = sections[sectionIndex].items[itemIndex];
    setEditingSectionIndex(sectionIndex);
    setEditingItem(item);
    setEditingIndex(itemIndex);
    setCurrentItemDescription(item.description || '');
    setCurrentItemNote(item.note || '');
    itemForm.setFieldsValue({
      item: item.item,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
    });
    setItemModalVisible(true);
  };


  // Drag and drop reorder handler
  const handleItemReorder = (sectionIndex: number, newItems: EstimateLineItem[]) => {
    const newSections = [...sections];
    newSections[sectionIndex].items = newItems;
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(newItems);
    setSections(newSections);
  };

  // Multi-select handlers
  const handleRowSelection = (sectionIndex: number, selectedRowKeys: string[]) => {
    setSelectedItemKeys(prev => ({
      ...prev,
      [sectionIndex]: selectedRowKeys
    }));
  };

  // Delete selected items with keyboard
  const handleKeyDown = (event: React.KeyboardEvent, sectionIndex: number) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const selectedKeys = selectedItemKeys[sectionIndex] || [];
      if (selectedKeys.length > 0) {
        event.preventDefault();
        deleteSelectedItems(sectionIndex, selectedKeys);
      }
    }
  };

  // Delete multiple selected items
  const deleteSelectedItems = (sectionIndex: number, selectedKeys: string[]) => {
    const newSections = [...sections];
    const currentItems = newSections[sectionIndex].items;

    // Filter out selected items (selectedKeys are indices as strings)
    const filteredItems = currentItems.filter((_, index) => !selectedKeys.includes(String(index)));

    newSections[sectionIndex].items = filteredItems;
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(filteredItems);
    setSections(newSections);

    // Clear selection
    setSelectedItemKeys(prev => ({
      ...prev,
      [sectionIndex]: []
    }));

    message.success(`${selectedKeys.length} item(s) deleted successfully`);
  };

  const calculateSectionSubtotal = (items: EstimateLineItem[]): number => {
    return items.reduce((sum, item) => sum + (item.total || 0), 0);
  };

  const calculateGrandTotal = useMemo((): { subtotal: number; opAmount: number; total: number } => {
    const subtotal = sections.reduce((sum, section) => sum + section.subtotal, 0);
    const opAmount = subtotal * (opPercent / 100);
    const total = subtotal + opAmount;
    
    return { subtotal, opAmount, total };
  }, [sections, opPercent]);

  const handleItemSave = () => {
    itemForm.validateFields().then((values) => {
      // Validate values
      if (!values.item || values.item.trim() === '') {
        message.error('Please enter item name');
        return;
      }
      if (!values.quantity || values.quantity <= 0) {
        message.error('Please enter valid quantity');
        return;
      }
      if (!values.unit) {
        message.error('Please select unit');
        return;
      }
      if (!values.unit_price || values.unit_price <= 0) {
        message.error('Please enter valid unit price');
        return;
      }

      const newItem: EstimateLineItem = {
        ...values,
        item: values.item.trim(),
        description: currentItemDescription,
        note: currentItemNote,
        total: values.quantity * values.unit_price,
        primary_group: sections[editingSectionIndex!]?.title,
      };

      const newSections = [...sections];
      
      if (editingIndex !== null) {
        // Edit existing item
        newSections[editingSectionIndex!].items[editingIndex] = newItem;
      } else {
        // Add new item
        newSections[editingSectionIndex!].items.push(newItem);
      }
      
      // Recalculate section subtotal
      newSections[editingSectionIndex!].subtotal = calculateSectionSubtotal(newSections[editingSectionIndex!].items);
      
      setSections(newSections);
      setItemModalVisible(false);
      setEditingItem(null);
      setEditingIndex(null);
      setEditingSectionIndex(null);
      setCurrentItemDescription('');
      setCurrentItemNote('');
      message.success(editingIndex !== null ? 'Item updated successfully' : 'Item added successfully');
    });
  };

  const handleCompanyChange = async (value: string) => {
    if (value === 'custom') {
      setUseCustomCompany(true);
      setSelectedCompany(null);
      // Set form value to indicate custom company is selected
      form.setFieldValue('company_selection', 'custom');
    } else {
      setUseCustomCompany(false);
      const company = companies.find(c => c.id === value);
      setSelectedCompany(company || null);
      // Set form value to the selected company ID
      form.setFieldValue('company_selection', value);

      // Generate new estimate number based on selected company (only in create mode)
      if (!isEditMode && company) {
        try {
          const newEstimateNumber = await estimateService.generateEstimateNumber(
            company.id,
            'standard'
          );
          form.setFieldsValue({ estimate_number: newEstimateNumber });
          console.log('Generated new estimate number:', newEstimateNumber);
        } catch (error) {
          console.error('Failed to generate estimate number:', error);
          // Fallback to default number if API fails
          const fallbackNumber = `EST-STD-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
          form.setFieldsValue({ estimate_number: fallbackNumber });
        }
      }
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      
      // Validate company information
      if (!selectedCompany && !useCustomCompany) {
        message.error('Please select a company or choose to enter custom company information');
        setLoading(false);
        return;
      }
      
      // Convert sections back to flat items array
      const allItems: EstimateLineItem[] = [];
      sections.forEach(section => {
        section.items.forEach(item => {
          allItems.push({
            ...item,
            primary_group: section.title,
          });
        });
      });
      
      const estimateData: InsuranceEstimate = {
        ...values,
        estimate_type: 'standard',  // Mark as standard estimate
        company_id: useCustomCompany ? undefined : selectedCompany?.id,
        estimate_date: values.estimate_date?.format('YYYY-MM-DD'),
        items: allItems,
        sections: sections,
        op_percent: opPercent,
        op_amount: calculateGrandTotal.opAmount,
        subtotal: calculateGrandTotal.subtotal,
        total_amount: calculateGrandTotal.total,
        // Add O&P info to notes if needed
        notes: values.notes ? `${values.notes}\n\nO&P: ${opPercent}%` : `O&P: ${opPercent}%`,
      };

      if (isEditMode) {
        await estimateService.updateEstimate(id!, estimateData);
        message.success('Estimate updated successfully');
      } else {
        const created = await estimateService.createEstimate(estimateData);
        message.success('Estimate created successfully');
        navigate(`/estimates/${created.id}/edit`);
      }
    } catch (error) {
      console.error('Failed to save estimate:', error);
      message.error('Failed to save estimate');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewPDF = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      
      // Validate company information
      if (!selectedCompany && !useCustomCompany) {
        message.error('Please select a company or choose to enter custom company information');
        setLoading(false);
        return;
      }
      
      // Convert sections to flat items for PDF
      const allItems: EstimateLineItem[] = [];
      sections.forEach(section => {
        section.items.forEach(item => {
          allItems.push({
            ...item,
            primary_group: section.title,
          });
        });
      });
      
      const pdfData = {
        ...values,
        company_id: useCustomCompany ? undefined : selectedCompany?.id,
        estimate_date: values.estimate_date?.format('YYYY-MM-DD'),
        items: allItems,
        sections: sections,
        // Add company fields that EstimateService expects
        company_name: selectedCompany?.name || '',
        company_address: selectedCompany?.address || '',
        company_city: selectedCompany?.city || '',
        company_state: selectedCompany?.state || '',
        company_zipcode: selectedCompany?.zipcode || '',
        company_phone: selectedCompany?.phone || '',
        company_email: selectedCompany?.email || '',
        op_percent: opPercent,
        op_amount: calculateGrandTotal.opAmount,
        subtotal: calculateGrandTotal.subtotal,
        total_amount: calculateGrandTotal.total,
      };
      
      const htmlContent = await estimateService.previewHTML(pdfData);
      
      // Create a new window/tab with the HTML content
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(htmlContent);
        newWindow.document.close();
        newWindow.document.title = `Estimate Preview - ${pdfData.estimate_number || 'Draft'}`;
      } else {
        message.error('Popup blocked. Please allow popups for this site to view the preview.');
      }
      
    } catch (error: any) {
      console.error('Failed to generate PDF preview:', error);
      
      // Show more detailed error message
      const errorMessage = error?.message || 'Failed to generate PDF preview';
      message.error(errorMessage);
      
      // If it's a network error, suggest checking connection
      if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('Network')) {
        message.error('Network error. Please check your internet connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const companySelectOptions = [
    ...companies.map(company => ({
      key: company.id,
      value: company.id,
      label: company.name
    })),
    {
      value: 'custom',
      label: (
        <>
          <Divider style={{ margin: '4px 0' }} />
          <Space>
            <EditOutlined />
            <span>Enter Custom Company</span>
          </Space>
        </>
      )
    }
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={2}>
          {isEditMode ? 'Edit Estimate' : 'Create New Estimate'}
        </Title>
        <Space>
          <Button onClick={() => navigate('/documents/estimate')}>Cancel</Button>
          <Button type="primary" icon={<EyeOutlined />} onClick={handlePreviewPDF}>
            Preview PDF
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>
            {isEditMode ? 'Update' : 'Save'} Estimate
          </Button>
        </Space>
      </div>

      <Form form={form} layout="vertical" initialValues={{ estimate_date: dayjs(), status: 'draft' }}>
        <Row gutter={[24, 24]}>
          {/* Estimate Details */}
          <Col xs={24}>
            <Card title="Estimate Details" style={{ marginBottom: 24 }}>
              <Form.Item 
                label="Select Company" 
                style={{ marginBottom: 16 }}
                name="company_selection"
                rules={[{ required: true, message: 'Please select a company or choose custom company' }]}
              >
                <Select
                  value={useCustomCompany ? 'custom' : selectedCompany?.id || undefined}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  options={companySelectOptions}
                />
              </Form.Item>
              
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="estimate_number"
                    label="Estimate Number"
                    rules={[{ required: true, message: 'Please enter estimate number' }]}
                  >
                    <Input
                      prefix="#"
                      placeholder={isEditMode ? "Estimate number" : "Select company to generate number"}
                      disabled={!isEditMode && !selectedCompany}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="estimate_date"
                    label="Estimate Date"
                    rules={[{ required: true, message: 'Please select estimate date' }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="status" label="Status">
                    <Select options={statusOptions} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Client Information */}
          <Col xs={24}>
            <Card title="Client Information" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="client_name"
                    label="Client Name"
                    rules={[{ required: true, message: 'Please enter client name' }]}
                  >
                    <Input placeholder="Enter client name" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_phone" label="Client Phone">
                    <Input placeholder="Enter phone number" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_email" label="Client Email">
                    <Input placeholder="Enter email address" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_address" label="Client Address">
                    <Input placeholder="Enter address" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Insurance Information */}
          <Col xs={24}>
            <Card title="Insurance Information (Optional)" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="claim_number" label="Claim Number">
                    <Input placeholder="Enter claim number" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="policy_number" label="Policy Number">
                    <Input placeholder="Enter policy number" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="deductible" label="Deductible">
                    <InputNumber
                      style={{ width: '100%' }}
                      placeholder="Enter deductible amount"
                      min={0}
                      step={100}
                      formatter={(value?: string | number) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={(value?: string) => parseFloat(value?.replace(/\$\s?|(,*)/g, '') || '0') || 0}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Section Management */}
          <Col xs={24}>
            <Card title="Estimate Sections" style={{ marginBottom: 24 }}>
              {/* Add New Section */}
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col flex="auto">
                  <Input
                    placeholder="Enter section name (e.g., Kitchen, Living Room, Bathroom)"
                    value={newSectionTitle}
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    onPressEnter={addSection}
                  />
                </Col>
                <Col>
                  <Button type="primary" icon={<PlusOutlined />} onClick={addSection}>
                    Add Section
                  </Button>
                </Col>
              </Row>

              {/* Sections List */}
              {sections.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  <Title level={4} type="secondary">No sections added yet</Title>
                  <p>Add sections to organize your estimate items by room or category</p>
                </div>
              ) : (
                <DndContext
                  sensors={sectionSensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleSectionDragStart}
                  onDragEnd={handleSectionDragEnd}
                  modifiers={[restrictToVerticalAxis]}
                >
                  <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <Collapse>
                      {sections.map((section, sectionIndex) => (
                        <SortableSection
                          key={section.id}
                          section={section}
                          sectionIndex={sectionIndex}
                          onAddItem={addItemToSection}
                          onEditSection={(sectionId, title) => {
                            setEditingSectionName(title);
                            setEditingSectionId(sectionId);
                            setSectionModalVisible(true);
                          }}
                          onDeleteSection={deleteSection}
                        >
                          {/* Section Items */}
                          {section.items.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                              <p>No items in this section yet</p>
                              <Button type="dashed" icon={<PlusOutlined />} onClick={() => addItemToSection(sectionIndex)}>
                                Add First Item
                              </Button>
                            </div>
                          ) : (
                            <>
                              <div
                                tabIndex={0}
                                onKeyDown={(e) => handleKeyDown(e, sectionIndex)}
                                style={{ outline: 'none' }}
                              >
                                <DraggableTable
                                  dataSource={section.items.map((item, index) => ({ ...item, key: index }))}
                                  onReorder={(newItems) => handleItemReorder(sectionIndex, newItems)}
                                  pagination={false}
                                  size="small"
                                  showDragHandle={true}
                                  dragHandlePosition="start"
                                  dragColumnWidth={30}
                                  getRowId={(record, index) => String(index)}
                                  rowSelection={{
                                    selectedRowKeys: selectedItemKeys[sectionIndex] || [],
                                    onChange: (selectedRowKeys) => handleRowSelection(sectionIndex, selectedRowKeys as string[]),
                                    type: 'checkbox',
                                  }}
                                  onRow={(record, index) => ({
                                    onDoubleClick: () => editItemInSection(sectionIndex, index!),
                                    style: {
                                      cursor: 'pointer',
                                    }
                                  })}
                                  columns={[
                                    {
                                      title: 'Item',
                                      dataIndex: 'item',
                                      key: 'item',
                                      width: 120,
                                    },
                                    {
                                      title: 'Description',
                                      dataIndex: 'description',
                                      key: 'description',
                                      ellipsis: true,
                                      render: (value) => value ? (
                                        <div dangerouslySetInnerHTML={{ __html: value }} />
                                      ) : null,
                                    },
                                    {
                                      title: 'Qty',
                                      dataIndex: 'quantity',
                                      key: 'quantity',
                                      width: 80,
                                    },
                                    {
                                      title: 'Unit',
                                      dataIndex: 'unit',
                                      key: 'unit',
                                      width: 80,
                                    },
                                    {
                                      title: 'Rate',
                                      dataIndex: 'unit_price',
                                      key: 'unit_price',
                                      width: 100,
                                      render: (value) => `$${value?.toFixed(2) || '0.00'}`,
                                    },
                                    {
                                      title: 'Total',
                                      dataIndex: 'total',
                                      key: 'total',
                                      width: 100,
                                      render: (value) => `$${value?.toFixed(2) || '0.00'}`,
                                    },
                                  ]}
                                />
                              </div>
                            </>
                          )}
                        </SortableSection>
                      ))}
                    </Collapse>
                  </SortableContext>

                  <DragOverlay>
                    {activeSectionId ? (
                      <div
                        style={{
                          backgroundColor: 'white',
                          border: '1px solid #d9d9d9',
                          borderRadius: '6px',
                          padding: '12px 16px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                          fontSize: '14px',
                          minWidth: '300px',
                          opacity: 0.9,
                        }}
                      >
                        <HolderOutlined style={{ marginRight: 8, color: '#999' }} />
                        <strong>
                          {sections.find(s => s.id === activeSectionId)?.title || 'Section'}
                        </strong>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </Card>
          </Col>

          {/* O&P and Totals */}
          <Col xs={24}>
            <Card title="Overhead & Profit (O&P)" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <label>O&P Percentage:</label>
                  <InputNumber
                    style={{ width: '100%', marginTop: 8 }}
                    min={0}
                    max={100}
                    step={0.1}
                    value={opPercent}
                    onChange={(value) => setOpPercent(value || 0)}
                    formatter={(value?: string | number) => `${value}%`}
                    parser={(value?: string) => parseFloat(value?.replace('%', '') || '0') || 0}
                  />
                </Col>
                <Col xs={24} md={16}>
                  <div style={{ textAlign: 'right', fontSize: '16px' }}>
                    <div>Subtotal: <strong>${calculateGrandTotal.subtotal.toFixed(2)}</strong></div>
                    <div>O&P ({opPercent}%): <strong>${calculateGrandTotal.opAmount.toFixed(2)}</strong></div>
                    <Divider style={{ margin: '8px 0' }} />
                    <div style={{ fontSize: '20px', color: '#1890ff' }}>
                      <strong>Total: ${calculateGrandTotal.total.toFixed(2)}</strong>
                    </div>
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Notes and Terms */}
          <Col xs={24}>
            <Card title="Notes & Terms" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="notes" label="Notes">
                    <RichTextEditor
                      placeholder="Additional notes for the estimate"
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="terms" label="Terms & Conditions">
                    <RichTextEditor
                      placeholder="Terms and conditions"
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Form>

      {/* Item Modal */}
      <Modal
        title={editingItem ? 'Edit Item' : 'Add New Item'}
        open={itemModalVisible}
        onOk={handleItemSave}
        onCancel={() => {
          setItemModalVisible(false);
          setEditingItem(null);
          setEditingIndex(null);
          setEditingSectionIndex(null);
          setCurrentItemDescription('');
          setCurrentItemNote('');
        }}
        width={800}
        style={{ maxHeight: '80vh' }}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        <Form form={itemForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item
                name="item"
                label="Item Name"
                rules={[{ required: true, message: 'Please enter item name' }]}
              >
                <Input placeholder="Enter item name" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Description">
                <RichTextEditor
                  value={currentItemDescription}
                  onChange={setCurrentItemDescription}
                  placeholder="Enter item description with formatting..."
                  minHeight={150}
                  maxHeight={300}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Additional Notes">
                <RichTextEditor
                  value={currentItemNote}
                  onChange={setCurrentItemNote}
                  placeholder="Additional notes or specifications..."
                  minHeight={100}
                  maxHeight={200}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[{ required: true, message: 'Please enter quantity' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  placeholder="0"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="unit"
                label="Unit"
                rules={[{ required: true, message: 'Please select or enter unit' }]}
              >
                <UnitSelect
                  componentVariant="autocomplete"
                  placeholder="Select or enter unit"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="unit_price"
                label="Unit Price"
                rules={[{ required: true, message: 'Please enter unit price' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  formatter={(value?: string | number) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value?: string) => parseFloat(value?.replace(/\$\s?|(,*)/g, '') || '0') || 0}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Section Name Edit Modal */}
      <Modal
        title="Edit Section Name"
        open={sectionModalVisible}
        onOk={() => {
          if (editingSectionName.trim() && editingSectionId) {
            const sectionIndex = sections.findIndex(s => s.id === editingSectionId);
            if (sectionIndex !== -1) {
              updateSectionTitle(sectionIndex, editingSectionName.trim());
              setSectionModalVisible(false);
              setEditingSectionName('');
              setEditingSectionId(null);
              message.success('Section name updated');
            }
          }
        }}
        onCancel={() => {
          setSectionModalVisible(false);
          setEditingSectionName('');
          setEditingSectionId(null);
        }}
      >
        <Input
          value={editingSectionName}
          onChange={(e) => setEditingSectionName(e.target.value)}
          placeholder="Enter section name"
          onPressEnter={() => {
            if (editingSectionName.trim() && editingSectionId) {
              const sectionIndex = sections.findIndex(s => s.id === editingSectionId);
              if (sectionIndex !== -1) {
                updateSectionTitle(sectionIndex, editingSectionName.trim());
                setSectionModalVisible(false);
                setEditingSectionName('');
                setEditingSectionId(null);
                message.success('Section name updated');
              }
            }
          }}
        />
      </Modal>
    </div>
  );
};

export default EstimateCreation;