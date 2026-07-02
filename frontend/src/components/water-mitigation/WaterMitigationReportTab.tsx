/**
 * Water Mitigation Report Tab
 * Main tab for creating and managing photo reports
 * Features sidebar navigation and modal-based photo selection with category filtering
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Space,
  message,
  Spin,
  Typography,
  Input,
  Row,
  Col,
  Select,
  Form,
  Image,
  Empty,
  Checkbox,
  Tag,
  Tooltip,
  Divider,
  Menu,
  Modal,
  DatePicker,
  Dropdown,
  Grid
} from 'antd';
import {
  PlusOutlined,
  SaveOutlined,
  FileTextOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileImageOutlined,
  CloseCircleOutlined,
  AppstoreAddOutlined,
  ThunderboltOutlined,
  LayoutOutlined,
  DownOutlined,
  SwapOutlined
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import waterMitigationService, { AI_CATEGORY_LABELS, AI_CATEGORY_COLORS } from '../../services/waterMitigationService';
import { useWaterMitigationPhotos } from '../../hooks/useWaterMitigationPhotos';
import PhotoSelectorModal from './PhotoSelectorModal';
import type {
  ReportConfig,
  ReportSection,
  PhotoMetadata,
  ReportTemplate
} from '../../types/waterMitigation';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

interface WaterMitigationReportTabProps {
  jobId: string;
  jobAddress: string;
  dateOfLoss?: string | null;
  mitigationStartDate?: string | null;
  mitigationEndDate?: string | null;
  isActive?: boolean;
}

interface Photo {
  id: string;
  file_path: string;
  caption?: string;
  category?: string;
  taken_date?: string;
  description?: string;
  thumbnail_url?: string;  // CompanyCam CDN thumbnail URL (fast)
  preview_url?: string;    // Preview URL from API
}

// Helper function to format date for display
const formatDateDisplay = (dateStr?: string | null): string | null => {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const WaterMitigationReportTab: React.FC<WaterMitigationReportTabProps> = ({
  jobId,
  jobAddress,
  dateOfLoss,
  mitigationStartDate,
  mitigationEndDate,
  isActive,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  // Use React Query for automatic caching - config query
  const {
    data: config,
    isLoading: loadingConfig,
    refetch: refetchConfig
  } = useQuery({
    queryKey: ['wm-report-config', jobId],
    queryFn: () => waterMitigationService.report.getConfig(jobId),
    retry: false,
    enabled: !!jobId
  });

  // Background refresh when tab becomes active
  const prevActiveRef = React.useRef(isActive);
  React.useEffect(() => {
    if (isActive && !prevActiveRef.current) {
      refetchConfig();
    }
    prevActiveRef.current = isActive;
  }, [isActive, refetchConfig]);

  // Use React Query for photos (shared cache with other components)
  const { data: availablePhotos = [], isLoading: loadingPhotos } = useWaterMitigationPhotos(jobId);

  // Fetch templates
  const { data: templatesData } = useQuery({
    queryKey: ['wm-templates'],
    queryFn: waterMitigationService.templates.list
  });

  const loading = loadingConfig || loadingPhotos;

  const [saving, setSaving] = useState(false);
  const [coverTitle, setCoverTitle] = useState('Water Mitigation Photos');
  const [coverDescription, setCoverDescription] = useState('');
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>('cover');
  const [editingSectionTitle, setEditingSectionTitle] = useState(false);
  const [tempSectionTitle, setTempSectionTitle] = useState('');
  const [photoSelectorVisible, setPhotoSelectorVisible] = useState(false);
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfTemplateVariant, setPdfTemplateVariant] = useState<string>('a');
  const [templateSelectorVisible, setTemplateSelectorVisible] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoUpdatePhotoDates, setAutoUpdatePhotoDates] = useState(true);
  // Default report date: mitigation end date + 1, fallback to today
  const [reportDate, setReportDate] = useState<dayjs.Dayjs | null>(
    mitigationEndDate ? dayjs(mitigationEndDate).add(1, 'day') : dayjs()
  );

  // Generate default filename: Water Mitigation Photo - {address}
  const getDefaultFilename = () => {
    const addressPart = jobAddress ? jobAddress.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-') : '';
    return addressPart ? `Water-Mitigation-Photo-${addressPart}` : 'Water-Mitigation-Photo-Report';
  };

  // React Query client for cache invalidation
  const queryClient = useQueryClient();

  /**
   * Replace placeholders in template text with actual dates
   */
  const replacePlaceholders = (text: string): string => {
    if (!text) return '';

    let result = text;

    // Replace {{start_date}} with mitigation start date
    if (mitigationStartDate) {
      const formattedStartDate = formatDateDisplay(mitigationStartDate);
      result = result.replace(/\{\{start_date\}\}/g, formattedStartDate || mitigationStartDate);
    }

    // Replace {{end_date}} with mitigation end date
    if (mitigationEndDate) {
      const formattedEndDate = formatDateDisplay(mitigationEndDate);
      result = result.replace(/\{\{end_date\}\}/g, formattedEndDate || mitigationEndDate);
    }

    // Replace {{start_date_plus_one}} with start date + 1 day
    if (mitigationStartDate) {
      try {
        const startDate = new Date(mitigationStartDate);
        const plusOneDate = new Date(startDate);
        plusOneDate.setDate(plusOneDate.getDate() + 1);
        const formattedPlusOne = formatDateDisplay(plusOneDate.toISOString());
        result = result.replace(/\{\{start_date_plus_one\}\}/g, formattedPlusOne || plusOneDate.toLocaleDateString());
      } catch (e) {
        console.warn('Failed to calculate start_date_plus_one:', e);
      }
    }

    return result;
  };

  // Initialize form data when config loads
  useEffect(() => {
    if (config) {
      setCoverTitle(config.cover_title || 'Water Mitigation Photos');
      setCoverDescription(config.cover_description || '');
      // Ensure all sections have required fields with defaults
      // Also replace placeholders in summaries when loading config
      const normalizedSections = (config.sections || []).map((section: any) => ({
        ...section,
        layout: section.layout || 'two', // Default layout if missing
        photos: section.photos || [],
        summary: replacePlaceholders(section.summary || '')  // Replace placeholders on load
      }));
      setSections(normalizedSections);
    } else {
      // Initialize default config if no config found
      initializeDefaultConfig();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, jobAddress, dateOfLoss, mitigationStartDate, mitigationEndDate]);

  const initializeDefaultConfig = () => {
    setCoverTitle('Water Mitigation Photos');
    // Description is intentionally empty - property info is shown elsewhere in the cover page
    setCoverDescription('');
    setSections([]);
  };

  const handleSaveConfig = async () => {
    try {
      setSaving(true);

      if (config?.id) {
        const updateData = {
          cover_title: coverTitle,
          cover_description: coverDescription,
          sections: sections.map((section, index) => ({
            ...section,
            display_order: index
          }))
        };
        await waterMitigationService.report.updateConfig(jobId, updateData);
        message.success('Report configuration updated');
      } else {
        const createData = {
          job_id: jobId,
          cover_title: coverTitle,
          cover_description: coverDescription,
          sections: sections.map((section, index) => ({
            ...section,
            display_order: index
          }))
        };
        await waterMitigationService.report.saveConfig(jobId, createData);
        message.success('Report configuration saved');
      }

      await refetchConfig();

      // Auto-update photo dates after save
      if (autoUpdatePhotoDates && mitigationStartDate && mitigationEndDate && availablePhotos.length > 0) {
        try {
          const formatDateForApi = (dateStr: string) => {
            const d = new Date(dateStr);
            return d.toISOString().split('T')[0];
          };
          const result = await waterMitigationService.photos.bulkUpdateDatesByCategory(
            jobId,
            formatDateForApi(mitigationStartDate),
            formatDateForApi(mitigationEndDate)
          );
          if (result.success) {
            message.success(result.message);
            queryClient.invalidateQueries({ queryKey: ['water-mitigation-photos', jobId] });
          }
        } catch (error) {
          console.error('Failed to auto-update photo dates:', error);
          message.warning('Config saved, but failed to update photo dates');
        }
      }
    } catch (error) {
      console.error('Failed to save report config:', error);
      message.error('Failed to save report configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePDF = async () => {
    try {
      // Check if configuration is saved
      if (!config?.id) {
        Modal.warning({
          title: 'Configuration Not Saved',
          content: 'Please save the report configuration before generating PDF. Click the "Save Configuration" button first.',
          okText: 'OK'
        });
        return;
      }

      // Check if there are sections with photos
      if (sections.length === 0 || sections.every(s => s.photos.length === 0)) {
        Modal.warning({
          title: 'No Photos Selected',
          content: 'Please add at least one section with photos before generating the report.',
          okText: 'OK'
        });
        return;
      }

      message.loading('Generating PDF report...', 0);

      const requestData = {
        config_id: config.id,
        report_date: reportDate ? reportDate.format('YYYY-MM-DD') : undefined,
        template_variant: pdfTemplateVariant,
      };

      const blob = await waterMitigationService.report.generateReport(jobId, requestData);

      // Debug: Check blob
      console.log('PDF Blob received:', blob);
      console.log('Blob size:', blob.size);
      console.log('Blob type:', blob.type);

      // Create blob URL for preview
      const url = window.URL.createObjectURL(blob);
      console.log('Blob URL created:', url);
      setPdfBlobUrl(url);
      setPdfPreviewVisible(true);

      message.destroy();
      message.success('PDF report generated successfully');
    } catch (error) {
      message.destroy();
      console.error('Failed to generate PDF:', error);
      message.error('Failed to generate PDF report');
    }
  };

  const handleAddSection = () => {
    const newSection: ReportSection = {
      id: Date.now().toString(),
      title: `Section ${sections.length + 1}`,
      summary: '',
      photos: [],
      layout: 'two',
      display_order: sections.length
    };
    setSections([...sections, newSection]);
    setSelectedSectionId(newSection.id);
  };

  const handleDeleteSection = (sectionId: string) => {
    setSections(sections.filter(s => s.id !== sectionId));
    if (selectedSectionId === sectionId) {
      setSelectedSectionId('cover');
    }
    message.success('Section deleted');
  };

  const handleUpdateSection = (sectionId: string, updates: Partial<ReportSection>) => {
    setSections(sections.map(s =>
      s.id === sectionId ? { ...s, ...updates } : s
    ));
  };

  const handleApplyLayoutToAll = (layout: 'single' | 'two' | 'three' | 'four' | 'six') => {
    if (sections.length === 0) {
      message.warning('No sections to apply layout to');
      return;
    }
    setSections(sections.map(s => ({ ...s, layout })));
    message.success(`Layout "${layout === 'single' ? '1 photo' : layout === 'two' ? '2 photos' : layout === 'three' ? '3 photos' : layout === 'four' ? '4 photos' : '6 photos'} per page" applied to all ${sections.length} sections`);
  };

  const handleOpenPhotoSelector = () => {
    setPhotoSelectorVisible(true);
  };

  const handlePhotoSelectorOk = (selectedPhotos: PhotoMetadata[]) => {
    const currentSection = sections.find(s => s.id === selectedSectionId);
    if (!currentSection) return;

    handleUpdateSection(currentSection.id, { photos: selectedPhotos });
    setPhotoSelectorVisible(false);
    message.success(`${selectedPhotos.length} photos selected`);
  };

  const handlePhotoSelectorCancel = () => {
    setPhotoSelectorVisible(false);
  };

  const handleRemovePhoto = (photoId: string) => {
    const currentSection = sections.find(s => s.id === selectedSectionId);
    if (!currentSection) return;

    const photo = photoMap.get(photoId);
    const photoLabel = photo?.caption || 'Photo';

    Modal.confirm({
      title: 'Move to Trash',
      content: `"${photoLabel}" will be removed from this section and moved to trash. You can restore it later from the Photos tab.`,
      okText: 'Move to Trash',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          // 1. Remove from section
          const updatedPhotos = currentSection.photos.filter(p => p.photo_id !== photoId);
          handleUpdateSection(currentSection.id, { photos: updatedPhotos });

          // 2. Move to trash via API
          await waterMitigationService.photos.trash(photoId);

          // 3. Invalidate photo cache so trashed photo disappears
          queryClient.invalidateQueries({ queryKey: ['water-mitigation-photos', jobId] });

          message.success('Photo moved to trash');
        } catch (error) {
          console.error('Failed to trash photo:', error);
          message.error('Failed to move photo to trash');
        }
      },
    });
  };

  /**
   * Change photo category and move it to the matching section
   * 1. Update category via API
   * 2. Remove from current section
   * 3. Add to best matching section (or keep if no match)
   */
  const handlePhotoCategoryChange = async (photoId: string, newCategory: string) => {
    const sourceSection = sections.find(s => s.id === selectedSectionId);
    if (!sourceSection) return;

    try {
      // 1. Update category via API
      await waterMitigationService.photos.updateCategory(photoId, newCategory);

      // 2. Invalidate photo cache so other components see the change
      queryClient.invalidateQueries({ queryKey: ['water-mitigation-photos', jobId] });

      // 3. Find the best matching target section for the new category
      let bestSection: ReportSection | null = null;
      let bestScore = 0;

      for (const section of sections) {
        const score = calculateMatchScore(section.title, newCategory);
        if (score > bestScore) {
          bestScore = score;
          bestSection = section;
        }
      }

      // Get the photo metadata from current section
      const photoMeta = sourceSection.photos.find(p => p.photo_id === photoId);
      if (!photoMeta) return;

      // If best match is the same section or no match found, just update without moving
      if (!bestSection || bestScore === 0 || bestSection.id === sourceSection.id) {
        message.success(`Category changed to "${AI_CATEGORY_LABELS[newCategory] || newCategory}"`);
        return;
      }

      // 4. Move photo: remove from source, add to target
      const newSections = sections.map(s => {
        if (s.id === sourceSection.id) {
          return { ...s, photos: s.photos.filter(p => p.photo_id !== photoId) };
        }
        if (s.id === bestSection!.id) {
          return { ...s, photos: [...s.photos, photoMeta] };
        }
        return s;
      });

      setSections(newSections);
      message.success(
        `Category → "${AI_CATEGORY_LABELS[newCategory] || newCategory}", moved to "${bestSection.title}"`
      );
    } catch (error) {
      console.error('Failed to update photo category:', error);
      message.error('Failed to update photo category');
    }
  };

  const handleDownloadPdf = async (compress: boolean = false) => {
    if (!config?.id) return;

    try {
      message.loading(compress ? 'Generating compressed PDF...' : 'Generating original PDF...', 0);

      const requestData = {
        config_id: config.id,
        report_date: reportDate ? reportDate.format('YYYY-MM-DD') : undefined,
        compress: compress,
        template_variant: pdfTemplateVariant,
      };

      const blob = await waterMitigationService.report.generateReport(jobId, requestData);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Use default filename: {address}-{report title}
      const suffix = compress ? '-compressed' : '';
      const baseFilename = getDefaultFilename();
      link.download = `${baseFilename}${suffix}.pdf`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      message.destroy();
      message.success('PDF downloaded successfully');
    } catch (error) {
      message.destroy();
      console.error('Failed to download PDF:', error);
      message.error('Failed to download PDF');
    }
  };

  const handleClosePdfPreview = () => {
    if (pdfBlobUrl) {
      window.URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    setPdfPreviewVisible(false);
  };

  const handleUseTemplate = () => {
    setTemplateSelectorVisible(true);
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplateId) {
      message.warning('Please select a template');
      return;
    }

    try {
      const template = templatesData?.items.find(t => t.id === selectedTemplateId);
      if (!template) {
        message.error('Template not found');
        return;
      }

      // Apply template sections with placeholder replacement
      const templateSections = template.sections.map((section, index) => ({
        id: `section-${Date.now()}-${index}`,
        title: section.title,
        summary: replacePlaceholders(section.summary || ''),
        photos: [] as PhotoMetadata[],
        layout: section.layout,
        display_order: index
      }));

      setSections(templateSections);
      setTemplateSelectorVisible(false);
      setSelectedTemplateId('');
      message.success(`Template "${template.name}" applied successfully`);
    } catch (error) {
      console.error('Failed to apply template:', error);
      message.error('Failed to apply template');
    }
  };

  /**
   * Normalize a string for matching by:
   * 1. Converting to lowercase
   * 2. Removing special characters
   * 3. Splitting into tokens
   * 4. Creating variations (with/without spaces, hyphens)
   */
  const normalizeForMatching = (text: string): string[] => {
    if (!text) return [];

    const lower = text.toLowerCase().trim();
    const tokens: string[] = [];

    // Add original lowercase
    tokens.push(lower);

    // Split by common separators and add individual tokens
    const parts = lower.split(/[\s\-_:,]+/).filter(p => p.length > 0);
    tokens.push(...parts);

    // Create combined versions without separators
    const noSeparators = lower.replace(/[\s\-_:,]+/g, '');
    if (noSeparators !== lower) {
      tokens.push(noSeparators);
    }

    // Create space-only version
    const spacedOnly = lower.replace(/[-_:,]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (spacedOnly !== lower) {
      tokens.push(spacedOnly);
    }

    // Handle "Day X" patterns specially
    const dayMatch = lower.match(/day\s*(\d+)/i);
    if (dayMatch) {
      tokens.push(`day ${dayMatch[1]}`);
      tokens.push(`day${dayMatch[1]}`);
    }

    // Return unique tokens
    return Array.from(new Set(tokens));
  };

  /**
   * Check if a section title matches a photo category
   * Returns true if any normalized token matches
   */
  const matchesSectionToCategory = (sectionTitle: string, photoCategory: string): boolean => {
    if (!sectionTitle || !photoCategory) return false;

    const sectionTokens = normalizeForMatching(sectionTitle);
    const categoryTokens = normalizeForMatching(photoCategory);

    // Check for any exact token match
    for (const sToken of sectionTokens) {
      for (const cToken of categoryTokens) {
        // Exact match
        if (sToken === cToken) return true;

        // Partial match - category token is contained in section token or vice versa
        // But only if the token is at least 3 characters to avoid false positives
        if (sToken.length >= 3 && cToken.length >= 3) {
          if (sToken.includes(cToken) || cToken.includes(sToken)) return true;
        }
      }
    }

    return false;
  };

  /**
   * Calculate match score between section title and photo category
   * Higher score = better match
   */
  const calculateMatchScore = (sectionTitle: string, photoCategory: string): number => {
    if (!sectionTitle || !photoCategory) return 0;

    const sectionTokens = normalizeForMatching(sectionTitle);
    const categoryTokens = normalizeForMatching(photoCategory);

    let score = 0;

    for (const sToken of sectionTokens) {
      for (const cToken of categoryTokens) {
        // Exact match - highest score
        if (sToken === cToken) {
          score += 100;
        }
        // Partial match - lower score
        else if (sToken.length >= 3 && cToken.length >= 3) {
          if (sToken.includes(cToken)) {
            score += 50;
          } else if (cToken.includes(sToken)) {
            score += 50;
          }
        }
      }
    }

    // Bonus for exact "Day X" pattern match
    const sectionDayMatch = sectionTitle.match(/day\s*(\d+)/i);
    const categoryDayMatch = photoCategory.match(/day\s*(\d+)/i);
    if (sectionDayMatch && categoryDayMatch && sectionDayMatch[1] === categoryDayMatch[1]) {
      score += 200; // Strong bonus for exact day number match
    }

    return score;
  };

  /**
   * Auto-assign photos to sections based on category name matching
   * Each photo is assigned to ONLY the best matching section (no duplicates)
   */
  const handleAutoAssignPhotos = async () => {
    if (sections.length === 0) {
      message.info('Please add sections first before auto-assigning photos');
      return;
    }

    if (availablePhotos.length === 0) {
      message.info('No photos available for assignment');
      return;
    }

    setAutoAssigning(true);

    try {
      // Build new sections with assigned photos
      const newSections = sections.map(section => ({
        ...section,
        photos: [] as PhotoMetadata[]  // Clear existing photos for re-assignment
      }));

      let totalAssigned = 0;

      // For each photo, find the BEST matching section
      for (const photo of availablePhotos) {
        const category = photo.category;
        if (!category) continue;  // Skip photos without categories

        let bestSection = null;
        let bestScore = 0;

        // Calculate match score for each section
        for (const section of newSections) {
          const score = calculateMatchScore(section.title, category);
          if (score > bestScore) {
            bestScore = score;
            bestSection = section;
          }
        }

        // Assign photo to the best matching section (if any match found)
        if (bestSection && bestScore > 0) {
          const photoMeta: PhotoMetadata = {
            photo_id: photo.id,
            caption: photo.caption || '',
            show_date: true,
            show_description: true
          };
          bestSection.photos.push(photoMeta);
          totalAssigned++;
        }
      }

      // Count sections that received photos
      const sectionsWithPhotos = newSections.filter(s => s.photos.length > 0).length;

      // Update sections state
      setSections(newSections);

      // Show results
      if (totalAssigned === 0) {
        message.info('No matching photos found. Make sure photo categories match section titles.');
      } else {
        message.success(`${totalAssigned} photos assigned to ${sectionsWithPhotos} sections (no duplicates)`);
      }
    } catch (error) {
      console.error('Failed to auto-assign photos:', error);
      message.error('Failed to auto-assign photos');
    } finally {
      setAutoAssigning(false);
    }
  };


  // Create a Map for O(1) photo lookup (fixes N+1 pattern)
  const photoMap = useMemo(() => {
    const map = new Map<string, Photo>();
    availablePhotos.forEach(photo => map.set(photo.id, photo));
    return map;
  }, [availablePhotos]);

  const getCurrentSection = () => {
    return sections.find(s => s.id === selectedSectionId);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  const currentSection = getCurrentSection();

  // Build section options for mobile dropdown
  const sectionOptions = [
    { value: 'cover', label: 'Cover Page' },
    ...sections.map(s => ({
      value: s.id,
      label: `${s.title} (${s.photos.length})`
    }))
  ];

  return (
    <div style={{ minHeight: isMobile ? 'auto' : 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: isMobile ? '12px' : '16px 24px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fff'
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Title level={isMobile ? 5 : 3} style={{ margin: 0, marginRight: 'auto', width: isMobile ? '100%' : 'auto' }}>
            <FileTextOutlined /> Photo Report Builder
          </Title>

          {/* Primary actions row */}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveConfig}
            loading={saving}
            size={isMobile ? 'small' : 'middle'}
          >
            Save
          </Button>
          <Tooltip title="Automatically update photo dates by category (Day 1/2/3) when saving">
            <Checkbox
              checked={autoUpdatePhotoDates}
              onChange={(e) => setAutoUpdatePhotoDates(e.target.checked)}
              disabled={!mitigationStartDate || !mitigationEndDate}
            >
              {!isMobile && 'Update Photo Dates'}
            </Checkbox>
          </Tooltip>
          <Select
            value={pdfTemplateVariant}
            onChange={(val) => setPdfTemplateVariant(val)}
            style={{ width: isMobile ? 95 : 120 }}
            size={isMobile ? 'small' : 'middle'}
          >
            <Select.Option value="a">Format A</Select.Option>
            <Select.Option value="b">Format B</Select.Option>
            <Select.Option value="c">Format C</Select.Option>
          </Select>
          <Button
            type="default"
            icon={<FileImageOutlined />}
            onClick={handleGeneratePDF}
            disabled={!config?.id && sections.length === 0}
            size={isMobile ? 'small' : 'middle'}
          >
            {isMobile ? 'PDF' : 'Preview & Download PDF'}
          </Button>

          {/* Secondary actions - shown as dropdown on mobile */}
          {isMobile ? (
            <Dropdown
              menu={{
                items: [
                  { key: 'template', icon: <AppstoreAddOutlined />, label: 'Use Template', onClick: handleUseTemplate },
                  {
                    key: 'autoAssign', icon: <ThunderboltOutlined />, label: 'Auto-Assign Photos',
                    onClick: handleAutoAssignPhotos, disabled: sections.length === 0 || availablePhotos.length === 0
                  },
                ]
              }}
            >
              <Button size="small" icon={<DownOutlined />}>More</Button>
            </Dropdown>
          ) : (
            <>
              <Button icon={<AppstoreAddOutlined />} onClick={handleUseTemplate}>Use Template</Button>
              <Tooltip title="Auto-assign photos to sections based on category names">
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={handleAutoAssignPhotos}
                  loading={autoAssigning}
                  disabled={sections.length === 0 || availablePhotos.length === 0}
                >
                  Auto-Assign Photos
                </Button>
              </Tooltip>
            </>
          )}

          <DatePicker
            value={reportDate}
            onChange={(date) => setReportDate(date)}
            format="YYYY-MM-DD"
            allowClear={false}
            style={{ width: isMobile ? 120 : 140 }}
            placeholder="Report Date"
            size={isMobile ? 'small' : 'middle'}
          />

        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: isMobile ? 'visible' : 'hidden' }}>
        {/* Section Navigation - Sidebar on desktop, dropdown on mobile */}
        {isMobile ? (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', display: 'flex', gap: 8 }}>
            <Select
              value={selectedSectionId || 'cover'}
              onChange={(value) => setSelectedSectionId(value)}
              options={sectionOptions}
              style={{ flex: 1 }}
              size="small"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddSection} size="small">
              Add
            </Button>
          </div>
        ) : (
          <div style={{
            width: 250,
            borderRight: '1px solid #f0f0f0',
            background: '#fafafa',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ padding: 16, borderBottom: '1px solid #f0f0f0' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddSection} block>
                New Section
              </Button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Menu
                mode="inline"
                selectedKeys={[selectedSectionId || 'cover']}
                style={{ border: 'none', background: 'transparent' }}
              >
                <Menu.Item key="cover" icon={<FileTextOutlined />} onClick={() => setSelectedSectionId('cover')}>
                  Cover Page
                </Menu.Item>
                {sections.map((section) => (
                  <Menu.Item
                    key={section.id}
                    icon={<FileImageOutlined />}
                    onClick={() => setSelectedSectionId(section.id)}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{section.title}</span>
                      <Tag color="blue" style={{ marginLeft: 8 }}>{section.photos.length}</Tag>
                    </div>
                  </Menu.Item>
                ))}
              </Menu>
            </div>
          </div>
        )}

        {/* Right Content Area */}
        <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          {selectedSectionId === 'cover' ? (
            <div style={{ padding: isMobile ? 12 : 24, maxWidth: 800 }}>
              <Title level={4}>Cover Page</Title>
              <Form layout="vertical">
                <Form.Item label="Report Title">
                  <Input
                    value={coverTitle}
                    onChange={e => setCoverTitle(e.target.value)}
                    placeholder="Water Mitigation Photos"
                    size="large"
                  />
                </Form.Item>
                <Form.Item label="Description">
                  <TextArea
                    value={coverDescription}
                    onChange={e => setCoverDescription(e.target.value)}
                    placeholder="Property information, client details, report description..."
                    rows={6}
                  />
                </Form.Item>
              </Form>

              {/* Global Layout Setting */}
              {sections.length > 0 && (
                <div style={{ marginTop: 24, padding: 16, background: '#f6f8fa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
                  <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
                    <LayoutOutlined /> Photos per Page (All Sections)
                  </Title>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    Change layout for all {sections.length} sections at once
                  </Text>
                  <Space wrap>
                    {([
                      { value: 'single', label: '1 Photo' },
                      { value: 'two', label: '2 Photos' },
                      { value: 'three', label: '3 Photos' },
                      { value: 'four', label: '4 Photos' },
                      { value: 'six', label: '6 Photos' },
                    ] as const).map(opt => {
                      const allSame = sections.every(s => s.layout === opt.value);
                      return (
                        <Button
                          key={opt.value}
                          type={allSame ? 'primary' : 'default'}
                          onClick={() => handleApplyLayoutToAll(opt.value)}
                          size={isMobile ? 'small' : 'middle'}
                        >
                          {opt.label}
                        </Button>
                      );
                    })}
                  </Space>
                </div>
              )}
            </div>
          ) : currentSection ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* Section Header */}
              <div style={{ padding: isMobile ? 12 : 24, borderBottom: '1px solid #f0f0f0' }}>
                <Row justify="space-between" align="middle" gutter={[8, 8]}>
                  <Col flex="auto">
                    {editingSectionTitle ? (
                      <Input
                        value={tempSectionTitle}
                        onChange={e => setTempSectionTitle(e.target.value)}
                        onPressEnter={() => {
                          handleUpdateSection(currentSection.id, { title: tempSectionTitle });
                          setEditingSectionTitle(false);
                        }}
                        onBlur={() => {
                          handleUpdateSection(currentSection.id, { title: tempSectionTitle });
                          setEditingSectionTitle(false);
                        }}
                        autoFocus
                        style={{ fontSize: 20, fontWeight: 600 }}
                      />
                    ) : (
                      <Title
                        level={4}
                        style={{ margin: 0, cursor: 'pointer' }}
                        onClick={() => {
                          setTempSectionTitle(currentSection.title);
                          setEditingSectionTitle(true);
                        }}
                      >
                        {currentSection.title}
                        <EditOutlined style={{ marginLeft: 8, fontSize: 16, color: '#999' }} />
                      </Title>
                    )}
                    <Text type="secondary">{currentSection.photos.length} Photos</Text>
                  </Col>
                  <Col>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteSection(currentSection.id)}
                      size={isMobile ? 'small' : 'middle'}
                    >
                      {isMobile ? 'Delete' : 'Delete Section'}
                    </Button>
                  </Col>
                </Row>

                <Form layout="vertical" style={{ marginTop: 16 }}>
                  <Form.Item label="Section Summary">
                    <TextArea
                      value={currentSection.summary}
                      onChange={e => handleUpdateSection(currentSection.id, { summary: e.target.value })}
                      placeholder="Brief description of this section..."
                      rows={2}
                    />
                  </Form.Item>
                  <Form.Item label="Photo Layout">
                    <Select
                      value={currentSection.layout || 'two'}
                      onChange={value => handleUpdateSection(currentSection.id, { layout: value })}
                      style={{ width: 200 }}
                    >
                      <Select.Option value="single">1 photo per page</Select.Option>
                      <Select.Option value="two">2 photos per page</Select.Option>
                      <Select.Option value="three">3 photos per page</Select.Option>
                      <Select.Option value="four">4 photos per page</Select.Option>
                      <Select.Option value="six">6 photos per page</Select.Option>
                    </Select>
                  </Form.Item>
                </Form>
              </div>

              {/* Selected Photos Display */}
              <div style={{ flex: 1, padding: isMobile ? 12 : 24, overflow: 'auto' }}>
                <div style={{ marginBottom: 16 }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleOpenPhotoSelector}
                  >
                    Add Photos
                  </Button>
                </div>

                {currentSection.photos.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No photos added to this section yet"
                  >
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleOpenPhotoSelector}
                    >
                      Add Photos
                    </Button>
                  </Empty>
                ) : (
                  <Row gutter={[16, 16]}>
                    {currentSection.photos.map(photoMeta => {
                      // Use Map for O(1) lookup instead of array.find (O(n))
                      const photo = photoMap.get(photoMeta.photo_id);
                      if (!photo) return null;
                      return (
                        <Col key={photoMeta.photo_id} xs={12} sm={8} md={6} lg={4}>
                          <Card
                            hoverable
                            styles={{ body: { padding: 8 } }}
                            cover={
                              <div style={{ position: 'relative', height: 150, overflow: 'hidden' }}>
                                <Image
                                  src={photo.thumbnail_url || `/api/water-mitigation/photos/${photo.id}/preview?size=thumbnail`}
                                  alt={photo.caption || 'Photo'}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  preview={photo ? {
                                    src: photo.preview_url || `/api/water-mitigation/photos/${photo.id}/preview?size=web`
                                  } : false}
                                />
                                <Tooltip title="Remove from section">
                                  <Button
                                    type="primary"
                                    danger
                                    shape="circle"
                                    size="small"
                                    icon={<CloseCircleOutlined />}
                                    onClick={() => handleRemovePhoto(photoMeta.photo_id)}
                                    style={{
                                      position: 'absolute',
                                      top: 8,
                                      right: 8
                                    }}
                                  />
                                </Tooltip>
                              </div>
                            }
                          >
                            <div style={{ fontSize: 12 }}>
                              {photo.caption && (
                                <div style={{
                                  fontWeight: 500,
                                  marginBottom: 4,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {photo.caption}
                                </div>
                              )}
                              <Select
                                size="small"
                                value={photo.category || 'uncategorized'}
                                onChange={(value) => handlePhotoCategoryChange(photoMeta.photo_id, value)}
                                style={{ width: '100%', fontSize: 10, marginBottom: 4 }}
                                popupMatchSelectWidth={false}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {Object.entries(AI_CATEGORY_LABELS).map(([key, label]) => (
                                  <Select.Option key={key} value={key}>
                                    <span style={{ color: AI_CATEGORY_COLORS[key] || '#1890ff', fontSize: 11 }}>
                                      {label}
                                    </span>
                                  </Select.Option>
                                ))}
                              </Select>
                              {photo.taken_date && (
                                <div style={{ color: '#999', fontSize: 10 }}>
                                  {new Date(photo.taken_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Photo Selector Modal */}
      {photoSelectorVisible && (
        <PhotoSelectorModal
          visible={photoSelectorVisible}
          jobId={jobId}
          selectedPhotos={currentSection?.photos || []}
          onOk={handlePhotoSelectorOk}
          onCancel={handlePhotoSelectorCancel}
        />
      )}

      {/* PDF Preview Modal */}
      <Modal
        title="PDF Preview"
        open={pdfPreviewVisible}
        onCancel={handleClosePdfPreview}
        width="90vw"
        style={{ top: 20 }}
        footer={[
          <Button key="close" onClick={handleClosePdfPreview}>
            Close
          </Button>,
          <Dropdown
            key="download"
            menu={{
              items: [
                {
                  key: 'original',
                  label: `Original Quality — Format ${pdfTemplateVariant.toUpperCase()}`,
                  onClick: () => handleDownloadPdf(false)
                },
                {
                  key: 'compressed',
                  label: `Compressed — Format ${pdfTemplateVariant.toUpperCase()}`,
                  onClick: () => handleDownloadPdf(true)
                }
              ]
            }}
          >
            <Button type="primary" icon={<DownloadOutlined />}>
              Download (Format {pdfTemplateVariant.toUpperCase()}) <DownOutlined />
            </Button>
          </Dropdown>
        ]}
        styles={{ body: { height: 'calc(90vh - 110px)', padding: 0 } }}
      >
        {pdfBlobUrl ? (
          <iframe
            src={pdfBlobUrl}
            title="PDF Preview"
            width="100%"
            height="100%"
            style={{ border: 'none' }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="large" />
            <div>Loading PDF...</div>
          </div>
        )}
      </Modal>

      {/* Template Selector Modal */}
      <Modal
        title="Select Template"
        open={templateSelectorVisible}
        onOk={handleApplyTemplate}
        onCancel={() => {
          setTemplateSelectorVisible(false);
          setSelectedTemplateId('');
        }}
        okText="Apply Template"
        cancelText="Cancel"
      >
        <div style={{ marginBottom: 16 }}>
          <Text>Choose a template to populate the report sections:</Text>
        </div>
        <Select
          style={{ width: '100%' }}
          placeholder="Select a template"
          value={selectedTemplateId}
          onChange={setSelectedTemplateId}
        >
          {templatesData?.items.map(template => (
            <Select.Option key={template.id} value={template.id}>
              <Space>
                {template.is_default && <Tag color="gold">Default</Tag>}
                <span>{template.name}</span>
                <Tag color="blue">{template.sections.length} sections</Tag>
              </Space>
            </Select.Option>
          ))}
        </Select>
        {selectedTemplateId && (
          <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
            <Text type="secondary">
              <strong>Note:</strong> This will replace all current sections with the template sections.
              Photos will need to be added to each section after applying the template.
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WaterMitigationReportTab;
