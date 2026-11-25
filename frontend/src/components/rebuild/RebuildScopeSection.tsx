/**
 * The project's scope of work: a rough room-by-room summary of what was
 * built, for the completion paperwork (COC, the package for the carrier).
 *
 * "Draft from estimate" reads the claim's latest insurance estimate PDF on
 * the server (rebuild/scope_summary.py) and opens the draft to edit; it is
 * saved only when the office saves it, with the revision it came from, so
 * the page can say when a newer estimate has come in since.
 */

import React, { useState } from 'react';
import { Button, Modal, Input, Select, Skeleton, Tooltip, message } from 'antd';
import { CopyOutlined, EditOutlined, FileSearchOutlined, SwapOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { humanize, useSheetModal } from '../common/ui';
import { rebuildService } from '../../services/rebuildService';
import type { RebuildProject, RebuildScopeDraft, RebuildScopeSource } from '../../types/rebuild';
import type { ClaimNegotiation } from '../../types/client';

type EstimateVersion = ClaimNegotiation & { file_download_id?: string | null };

interface Props {
  project: RebuildProject;
  /** The claim's estimate revisions, newest first */
  versions: EstimateVersion[];
  /** The one the project page opens on: the newest rebuild estimate with a PDF */
  latestEstimate: EstimateVersion | null;
  onSaved: () => void;
}

const revisionLabel = (v: EstimateVersion) =>
  [`Rev #${v.revision_number}`, humanize(v.revision_type || 'initial'), v.estimate_category && humanize(v.estimate_category)]
    .filter(Boolean)
    .join(' · ');

const RebuildScopeSection: React.FC<Props> = ({ project, versions, latestEstimate, onSaved }) => {
  const { isPhone, sheetProps } = useSheetModal('tall');
  const ctlSize = isPhone ? 'middle' : 'small';

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // The draft's source while the modal is open; saved with the text
  const [source, setSource] = useState<RebuildScopeSource | null>(null);
  const [draft, setDraft] = useState<RebuildScopeDraft | null>(null);
  const [draftFrom, setDraftFrom] = useState<string | undefined>();
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scope = (project.scope_of_work || '').trim();
  const saved = project.scope_source || null;
  const withPdf = versions.filter(v => v.file_download_id);
  // A newer estimate than the one the saved scope was drafted from
  const stale = !!(saved && latestEstimate && saved.negotiation_id !== latestEstimate.id);

  const runDraft = async (negotiationId?: string) => {
    setDrafting(true);
    setDraftError(null);
    setDraftFrom(negotiationId);
    try {
      const result = await rebuildService.draftScope(project.id, negotiationId);
      setDraft(result);
      setText(result.text);
      setSource(result.source);
      setDraftFrom(result.source.negotiation_id);
    } catch (err: any) {
      setDraftError(err?.response?.data?.detail || 'Could not read the estimate PDF');
    } finally {
      setDrafting(false);
    }
  };

  const openDraft = (negotiationId?: string) => {
    setText(project.scope_of_work || '');
    setSource(saved);
    setDraft(null);
    setOpen(true);
    runDraft(negotiationId || latestEstimate?.id);
  };

  const openEdit = () => {
    setText(project.scope_of_work || '');
    setSource(saved);
    setDraft(null);
    setDraftError(null);
    setDraftFrom(saved?.negotiation_id || latestEstimate?.id);
    setOpen(true);
  };

  const save = async () => {
    const value = text.trim();
    setSaving(true);
    try {
      await rebuildService.updateProject(project.id, {
        scope_of_work: value,
        // Cleared by hand, it no longer comes from any estimate
        scope_source: value ? source : null,
      });
      message.success('Scope of work saved');
      setOpen(false);
      onSaved();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not save the scope of work');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scope);
      message.success('Scope of work copied');
    } catch {
      message.error('Could not copy. Select the text and copy it instead.');
    }
  };

  const noEstimate = withPdf.length === 0;
  const draftButton = (
    <Tooltip title={noEstimate ? 'No insurance estimate PDF on this claim yet' : undefined}>
      <Button size={ctlSize} type={scope ? 'text' : 'default'} className={scope ? 'ui-icon-btn' : undefined}
        icon={<FileSearchOutlined />} disabled={noEstimate} onClick={() => openDraft()}>
        {scope ? 'Redraft' : 'Draft from estimate'}
      </Button>
    </Tooltip>
  );

  const renderDraftStatus = () => {
    if (drafting) {
      return (
        <div className="rb-scope-status">
          <Skeleton active title={false} paragraph={{ rows: 2 }} />
          <span className="rb-scope-status-text">Reading the estimate PDF…</span>
        </div>
      );
    }
    if (draftError) {
      return <div className="rb-scope-status rb-scope-status--error">{draftError}</div>;
    }
    if (draft) {
      const skipped = draft.skipped_count
        ? ` ${draft.skipped_count} line${draft.skipped_count === 1 ? ' was' : 's were'} left out: water mitigation and what every job has (contents, protection, debris, cleaning, supervision, permits).`
        : '';
      return (
        <div className="rb-scope-status">
          Drafted from {draft.line_count} estimate line{draft.line_count === 1 ? '' : 's'}.{skipped}{' '}
          Check it against the PDF and edit before saving.
        </div>
      );
    }
    return null;
  };

  return (
    <section className="ui-section rb-scope">
      <div className="ui-section-head">
        <h2 className="ui-section-title">Scope of work</h2>
        <span className="rb-scope-actions">
          {scope && (
            <Tooltip title="Copy">
              <Button size={ctlSize} type="text" className="ui-icon-btn" icon={<CopyOutlined />} aria-label="Copy scope of work" onClick={copy} />
            </Tooltip>
          )}
          {scope && (
            <Button size={ctlSize} type="text" className="ui-icon-btn" icon={<EditOutlined />} onClick={openEdit}>Edit</Button>
          )}
          {draftButton}
        </span>
      </div>

      {stale && latestEstimate && (
        <div className="rb-scope-stale" role="status">
          <WarningOutlined aria-hidden="true" />
          <span>
            A newer estimate came in after this scope was drafted: <strong>{revisionLabel(latestEstimate)}</strong>.{' '}
            <Button size="small" type="link" onClick={() => openDraft(latestEstimate.id)}>Redraft from it</Button>
          </span>
        </div>
      )}

      {scope ? (
        <div className="rb-scope-text">{scope}</div>
      ) : (
        <p className="sup-empty rb-scope-empty">
          {noEstimate
            ? 'No scope yet. Once the carrier\'s estimate PDF is on the claim, the scope can be drafted from it.'
            : `No scope yet. Draft it from ${latestEstimate ? revisionLabel(latestEstimate) : 'the latest estimate'}, then edit it.`}
        </p>
      )}

      {scope && saved && (
        <div className="rb-scope-source">
          Drafted from {saved.label}
          {saved.drafted_at && ` · ${dayjs(saved.drafted_at).format('MMM D, YYYY')}`}
        </div>
      )}

      <Modal
        title="Scope of work"
        open={open}
        width={720}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText="Save scope"
        okButtonProps={{ disabled: drafting }}
        confirmLoading={saving}
        destroyOnClose
        {...sheetProps}
      >
        <div className="rb-scope-modal">
          {withPdf.length > 0 && (
            <div className="rb-scope-from">
              <Select
                size={isPhone ? 'large' : 'middle'}
                value={draftFrom}
                placeholder="Estimate revision"
                options={withPdf.map(v => ({
                  value: v.id,
                  label: `${revisionLabel(v)}${v.id === latestEstimate?.id ? ' (latest)' : ''}`,
                }))}
                onChange={id => setDraftFrom(id)}
                suffixIcon={<SwapOutlined />}
                popupMatchSelectWidth={false}
                aria-label="Estimate to draft from"
                className="rb-scope-from-select"
              />
              <Button icon={<FileSearchOutlined />} loading={drafting} onClick={() => runDraft(draftFrom)}>
                {draft || drafting ? 'Draft again' : 'Draft from this estimate'}
              </Button>
            </div>
          )}
          {renderDraftStatus()}
          {draft && scope && (
            <p className="rb-scope-replace">Saving replaces the scope that is on the project now.</p>
          )}
          <Input.TextArea
            value={text}
            onChange={e => setText(e.target.value)}
            autoSize={{ minRows: 12, maxRows: isPhone ? 18 : 24 }}
            placeholder={'Kitchen\n- Drywall: Replace 1/2" drywall\n- Paint: walls, ceiling'}
            aria-label="Scope of work"
            className="rb-scope-input"
          />
        </div>
      </Modal>
    </section>
  );
};

export default RebuildScopeSection;
