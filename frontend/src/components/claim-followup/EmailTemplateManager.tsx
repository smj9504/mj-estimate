import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, ConfigProvider, Drawer, Form, Grid, Input, Modal, Segmented, Select, Skeleton, Tooltip, message,
} from 'antd';
import type { InputRef } from 'antd';
import {
  ArrowLeftOutlined, CopyOutlined, DeleteOutlined, PlusOutlined, SearchOutlined,
} from '@ant-design/icons';
import RichTextEditor from '../editor/RichTextEditor';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import type { EmailTemplate } from '../../types/claimFollowUp';
import { comfortTheme } from '../../styles/antTheme';
import {
  TEMPLATE_FIELDS, TEMPLATE_TYPE_OPTIONS, fieldLabel, fillTemplate, findPlaceholders,
  isBlankHtml, placeholderOf, templateTypeLabel, toEditorHtml,
} from './emailTemplates';

export interface TemplateDraft {
  subject: string;
  body: string;
  name?: string;
  template_type?: string;
  description?: string;
}

interface EmailTemplateManagerProps {
  open: boolean;
  onClose: () => void;
  /** This claim's field values, for the preview */
  values?: Record<string, string | undefined>;
  /** Start a new template from the email being written */
  draft?: TemplateDraft | null;
  /** Put a template into the email being written */
  onUse?: (template: EmailTemplate) => void;
}

interface TemplateFormValues {
  name: string;
  template_type: string;
  description?: string;
  subject_template: string;
  body_template: string;
}

const NEW = '__new__';
const TYPE_ORDER = TEMPLATE_TYPE_OPTIONS.map(o => o.value);

const confirmDiscard = (onOk: () => void) => Modal.confirm({
  title: 'Discard your changes?',
  content: 'The edits to this template have not been saved.',
  okText: 'Discard',
  okButtonProps: { danger: true },
  cancelText: 'Keep editing',
  onOk,
});

/** Leftover placeholders get a highlight in the preview so they are easy to spot */
const markMissing = (html: string) =>
  html.replace(/\{\{(\w+)\}\}/g, '<mark class="fu-tpl-missing">{{$1}}</mark>');

// ── Editor for one template ──

interface TemplateEditorProps {
  template?: EmailTemplate;
  draft?: TemplateDraft | null;
  values: Record<string, string | undefined>;
  isMobile: boolean;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (template: EmailTemplate) => void;
  onDeleted: () => void;
  onDuplicate: (template: EmailTemplate) => void;
  onUse?: (template: EmailTemplate) => void;
}

const TemplateEditor: React.FC<TemplateEditorProps> = ({
  template, draft, values, isMobile, onBack, onDirtyChange, onSaved, onDeleted, onDuplicate, onUse,
}) => {
  const [form] = Form.useForm<TemplateFormValues>();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [dirty, setDirtyState] = useState(!template && !!draft);
  const [pending, setPending] = useState<'save' | 'use' | null>(null);
  const subjectRef = useRef<InputRef>(null);
  const bodyWrapRef = useRef<HTMLDivElement>(null);

  const setDirty = (next: boolean) => {
    setDirtyState(next);
    onDirtyChange(next);
  };

  useEffect(() => { onDirtyChange(dirty); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const subject = Form.useWatch('subject_template', form) || '';
  const body = Form.useWatch('body_template', form) || '';

  const initialValues: Partial<TemplateFormValues> = template
    ? {
      name: template.name,
      template_type: template.template_type,
      description: template.description,
      subject_template: template.subject_template,
      body_template: toEditorHtml(template.body_template),
    }
    : {
      name: draft?.name || '',
      template_type: draft?.template_type || 'custom',
      description: draft?.description,
      subject_template: draft?.subject || '',
      body_template: draft?.body || '',
    };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['email-templates'] });

  const saveMutation = useMutation({
    mutationFn: (data: TemplateFormValues) => {
      const payload = {
        ...data,
        description: data.description?.trim() || undefined,
        available_variables: findPlaceholders(data.subject_template, data.body_template),
      };
      return template
        ? claimFollowUpService.updateTemplate(template.id, payload)
        : claimFollowUpService.createTemplate(payload);
    },
    onSuccess: (saved) => {
      message.success(template ? 'Template saved' : 'Template created');
      setDirty(false);
      // Put it in the list now so the selection does not wait for the refetch
      queryClient.setQueryData<EmailTemplate[]>(['email-templates'], (old = []) => (
        old.some(t => t.id === saved.id) ? old.map(t => (t.id === saved.id ? saved : t)) : [...old, saved]
      ));
      invalidate();
      onSaved(saved);
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not save the template. Try again.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => claimFollowUpService.deleteTemplate(id),
    onSuccess: (_, id) => {
      message.success('Template deleted');
      setDirty(false);
      queryClient.setQueryData<EmailTemplate[]>(['email-templates'], (old = []) => old.filter(t => t.id !== id));
      invalidate();
      onDeleted();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not delete the template.'),
  });

  const save = async (): Promise<EmailTemplate | null> => {
    try {
      const data = await form.validateFields();
      if (isBlankHtml(data.body_template)) {
        form.setFields([{ name: 'body_template', errors: ['Write the email this template sends'] }]);
        return null;
      }
      return await saveMutation.mutateAsync({ ...data, name: data.name.trim() });
    } catch {
      return null;
    }
  };

  const saveOnly = async () => {
    setPending('save');
    await save();
    setPending(null);
  };

  const useInEmail = async () => {
    if (!onUse) return;
    setPending('use');
    const saved = dirty || !template ? await save() : template;
    setPending(null);
    if (saved) onUse(saved);
  };

  const confirmDelete = () => {
    if (!template) return;
    Modal.confirm({
      title: `Delete “${template.name}”?`,
      content: 'It disappears from the template menu. Emails already sent with it are not affected.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => deleteMutation.mutateAsync(template.id),
    });
  };

  /**
   * Put a field where the cursor is, in the subject or the body. The chips
   * keep focus on mousedown, so the caret is still where the person left it.
   */
  const insertField = (key: string) => {
    const text = placeholderOf(key);
    const active = document.activeElement as HTMLElement | null;
    const inSubject = !!active && active === subjectRef.current?.input;
    const inBody = !!active && !!bodyWrapRef.current?.contains(active) && active.isContentEditable;
    if ((inSubject || inBody) && document.execCommand('insertText', false, text)) return;
    // No caret in either field: add it to the end of the body
    const current = form.getFieldValue('body_template') || '';
    form.setFieldValue('body_template', isBlankHtml(current) ? `<p>${text}</p>` : `${current}${text}`);
    setDirty(true);
  };

  // Only meaningful when opened from a claim that supplies values
  const hasClaim = Object.keys(values).length > 0;
  const missing = hasClaim ? findPlaceholders(subject, body).filter(k => !values[k]?.trim()) : [];
  const isSystem = !!template?.is_system;

  return (
    <div className="fu-tpl-editor">
      <div className="fu-tpl-editor-head">
        {isMobile && (
          <Button type="text" className="ui-icon-btn" icon={<ArrowLeftOutlined />} aria-label="Back to templates" onClick={onBack} />
        )}
        <h3 className="fu-tpl-editor-title">{template ? template.name : 'New template'}</h3>
        <div className="fu-tpl-editor-tools">
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as 'edit' | 'preview')}
            options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
          />
          {template && (
            <Tooltip title="Duplicate">
              <Button type="text" className="ui-icon-btn" icon={<CopyOutlined />} aria-label="Duplicate template" onClick={() => onDuplicate(template)} />
            </Tooltip>
          )}
          {template && !isSystem && (
            <Tooltip title="Delete">
              <Button type="text" className="ui-icon-btn ui-icon-btn--danger" icon={<DeleteOutlined />} aria-label="Delete template" onClick={confirmDelete} />
            </Tooltip>
          )}
        </div>
      </div>

      <Form
        form={form}
        name="email-template"
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={() => { if (!dirty) setDirty(true); }}
        requiredMark={false}
        className="fu-tpl-form"
        style={{ display: mode === 'edit' ? undefined : 'none' }}
      >
        <div className="fu-tpl-row">
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Give the template a name' }]}>
            <Input placeholder="e.g. 2nd follow-up on WM documents" maxLength={120} />
          </Form.Item>
          <Form.Item name="template_type" label="Used for">
            <Select options={TEMPLATE_TYPE_OPTIONS} />
          </Form.Item>
        </div>
        <Form.Item name="description" label="When to use it" extra="Shown under the name in the template menu.">
          <Input placeholder="Optional" maxLength={200} />
        </Form.Item>
        <Form.Item name="subject_template" label="Subject" rules={[{ required: true, whitespace: true, message: 'Write a subject line' }]}>
          <Input ref={subjectRef} placeholder="e.g. Claim {{claim_number}} – documents for {{property_address}}" />
        </Form.Item>

        <div className="fu-tpl-fields" role="group" aria-label="Insert a claim field">
          <span className="fu-tpl-fields-label">Insert a field</span>
          {TEMPLATE_FIELDS.map(f => (
            <Tooltip key={f.key} title={placeholderOf(f.key)} mouseEnterDelay={0.4}>
              <button
                type="button"
                className="fu-tpl-field"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertField(f.key)}
              >
                {f.label}
              </button>
            </Tooltip>
          ))}
        </div>

        <div ref={bodyWrapRef} className="fu-tpl-body">
          <Form.Item
            name="body_template"
            label="Email"
            rules={[{ required: true, message: 'Write the email this template sends' }]}
          >
            <RichTextEditor placeholder="Write the email. Fields fill in with the claim's details when you use it." minHeight={240} maxHeight={480} />
          </Form.Item>
        </div>
      </Form>

      {mode === 'preview' && (
        <div className="fu-tpl-preview">
          <p className="fu-tpl-preview-note">
            {hasClaim ? "Filled in with this claim's details." : 'Fields fill in when the template is used on a claim.'}
          </p>
          <div className="fu-tpl-preview-subject">
            <span className="fu-tpl-preview-label">Subject</span>
            <span dangerouslySetInnerHTML={{ __html: markMissing(fillTemplate(subject, values, { html: true })) || '<span class="fu-muted">No subject</span>' }} />
          </div>
          <div
            className="fu-tpl-preview-body"
            dangerouslySetInnerHTML={{ __html: markMissing(fillTemplate(body, values, { html: true })) }}
          />
        </div>
      )}

      {missing.length > 0 && (
        <p className="fu-tpl-hint">
          No value on this claim for {missing.map(fieldLabel).join(', ')}. It stays highlighted in the email until someone fills it in.
        </p>
      )}

      <div className="fu-tpl-actions">
        <Button type="primary" onClick={saveOnly} loading={pending === 'save'} disabled={pending === 'use'}>
          {template ? 'Save changes' : 'Create template'}
        </Button>
        {onUse && (
          <Button onClick={useInEmail} loading={pending === 'use'} disabled={pending === 'save'}>
            {dirty || !template ? 'Save and use in email' : 'Use in email'}
          </Button>
        )}
        {template && template.usage_count > 0 && (
          <span className="fu-tpl-usage">Used {template.usage_count} {template.usage_count === 1 ? 'time' : 'times'}</span>
        )}
      </div>
    </div>
  );
};

// ── Drawer: the list and the editor ──

const EmailTemplateManager: React.FC<EmailTemplateManagerProps> = ({ open, onClose, values = {}, draft, onUse }) => {
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<TemplateDraft | null>(null);
  // Each new or duplicated template gets a fresh editor
  const [newCount, setNewCount] = useState(0);
  const [search, setSearch] = useState('');
  const dirtyRef = useRef(false);

  const { data: templates = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => claimFollowUpService.getTemplates(),
    enabled: open,
  });

  const sorted = useMemo(() => [...templates].sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.template_type);
    const tb = TYPE_ORDER.indexOf(b.template_type);
    return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb) || a.name.localeCompare(b.name);
  }), [templates]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(t => `${t.name} ${t.subject_template} ${t.description || ''}`.toLowerCase().includes(q));
  }, [sorted, search]);

  // Opening from "Save as template" starts a new one; otherwise show the first
  useEffect(() => {
    if (!open) return;
    if (draft) {
      setNewDraft(draft);
      setNewCount(c => c + 1);
      setSelectedId(NEW);
    } else if (!isMobile && selectedId === null && sorted.length > 0) {
      setSelectedId(sorted[0].id);
    }
  }, [open, draft, sorted.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A deleted or missing template falls back to the list
  useEffect(() => {
    if (selectedId && selectedId !== NEW && !isLoading && !templates.some(t => t.id === selectedId)) {
      setSelectedId(isMobile ? null : sorted[0]?.id ?? null);
    }
  }, [templates, selectedId, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const guard = (next: () => void) => {
    if (dirtyRef.current) confirmDiscard(() => { dirtyRef.current = false; next(); });
    else next();
  };

  const select = (id: string | null, fromDraft: TemplateDraft | null = null) => guard(() => {
    setNewDraft(fromDraft);
    if (id === NEW) setNewCount(c => c + 1);
    setSelectedId(id);
  });

  const close = () => guard(() => {
    setSelectedId(null);
    setNewDraft(null);
    setSearch('');
    onClose();
  });

  const selected = templates.find(t => t.id === selectedId);
  const showList = !isMobile || selectedId === null;
  const showEditor = selectedId !== null && (selectedId === NEW || !!selected);

  const renderList = () => (
    <div className="fu-tpl-list-pane">
      <div className="fu-tpl-list-tools">
        <Input
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder="Search templates"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search templates"
        />
        <Button icon={<PlusOutlined />} onClick={() => select(NEW)}>New</Button>
      </div>
      {isLoading ? (
        <Skeleton active title={false} paragraph={{ rows: 6 }} />
      ) : isError ? (
        <div className="fu-tpl-empty">
          <p>Couldn't load templates.</p>
          <Button onClick={() => refetch()}>Try again</Button>
        </div>
      ) : templates.length === 0 ? (
        <div className="fu-tpl-empty">
          <p className="fu-tpl-empty-title">No templates yet</p>
          <p>Templates fill in the claim number, address and adjuster for you. Start with the follow-up you send most.</p>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => select(NEW)}>New template</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="fu-tpl-empty">No template matches “{search}”.</p>
      ) : (
        <ul className="fu-tpl-list" aria-label="Templates">
          {shown.map(t => (
            <li key={t.id}>
              <button
                type="button"
                className={`fu-tpl-item${t.id === selectedId ? ' is-selected' : ''}`}
                aria-current={t.id === selectedId ? 'true' : undefined}
                onClick={() => { if (t.id !== selectedId) select(t.id); }}
              >
                <span className="fu-tpl-item-name">{t.name}</span>
                <span className="fu-tpl-item-meta">
                  {templateTypeLabel(t.template_type)}
                  {t.is_system && ' · Built-in'}
                  {t.usage_count > 0 && ` · Used ${t.usage_count}×`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <ConfigProvider theme={comfortTheme}>
      <Drawer
        title="Email templates"
        open={open}
        onClose={close}
        width={isMobile ? '100%' : 1000}
        destroyOnHidden
        className="fu-tpl-drawer"
        styles={{ body: { padding: 0 } }}
      >
        <div className={`fu-tpl-layout${isMobile ? ' is-mobile' : ''}`}>
          {showList && renderList()}
          {showEditor ? (
            <TemplateEditor
              key={selectedId === NEW ? `new-${newCount}` : selectedId!}
              template={selectedId === NEW ? undefined : selected}
              draft={selectedId === NEW ? newDraft : null}
              values={values}
              isMobile={isMobile}
              onBack={() => select(null)}
              onDirtyChange={(d) => { dirtyRef.current = d; }}
              onSaved={(saved) => { setNewDraft(null); setSelectedId(saved.id); }}
              onDeleted={() => setSelectedId(isMobile ? null : (sorted.find(t => t.id !== selectedId)?.id ?? null))}
              onDuplicate={(t) => select(NEW, {
                name: `Copy of ${t.name}`,
                template_type: t.template_type,
                description: t.description,
                subject: t.subject_template,
                body: toEditorHtml(t.body_template),
              })}
              onUse={onUse ? (t) => { dirtyRef.current = false; onUse(t); close(); } : undefined}
            />
          ) : !isMobile && (
            <div className="fu-tpl-editor fu-tpl-editor--idle">
              <p className="fu-muted">Pick a template to edit it, or start a new one.</p>
            </div>
          )}
        </div>
      </Drawer>
    </ConfigProvider>
  );
};

export default EmailTemplateManager;
