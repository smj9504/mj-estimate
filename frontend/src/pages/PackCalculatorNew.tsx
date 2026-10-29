/**
 * Packing Estimate - Main Page
 * Builder: job, rooms and settings on the left, the estimate on the right
 * Supports Quick Estimate and Photo AI modes
 * Supports recalculation from existing estimate via navigation state
 * Started from a claim (navigation state claimPhotos), it fills in the job,
 * loads the claim's packing photos as Photo AI rooms and analyzes them;
 * From Claim in Photo AI Rooms loads them from here, a claim and rooms picked
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Segmented, message } from 'antd';
import {
  ArrowLeftOutlined, CameraOutlined, AppstoreOutlined, ExportOutlined, CheckCircleFilled,
} from '@ant-design/icons';
import DetailsStep, { EstimationSettings } from '../components/packing-estimate/DetailsStep';
import PhotoAIRooms from '../components/packing-estimate/PhotoAIRooms';
import ClaimPhotosImportModal from '../components/packing-estimate/ClaimPhotosImportModal';
import QuickEstimateRooms from '../components/packing-estimate/QuickEstimateRooms';
import { DEFAULT_SETTINGS } from '../components/packing-estimate/constants';
import { loadClaimPhotoRooms } from '../components/packing-estimate/claimPhotos';
import {
  EstimateBreakdown, Figures, estimateFigures, regionLabel, modeLabel, sectionsWithLines, packEstimateTitle,
} from '../components/packing-estimate/packingUi';
import { PageHeader } from '../components/common/ui';
import * as packingService from '../services/packingEstimateService';
import type {
  PackingSettings, PackingRoom, PhotoRoom,
  RoomInput, EstimateResponse, PackingMode,
  ContentRoomInput, PackingPhotoClaim,
} from '../types/packing-estimate';

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

const PackCalculatorNew: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const recalcState = (location.state as any) || null;

  const [mode, setMode] = useState<PackingMode>(() => {
    if (recalcState?.mode === 'quick' || recalcState?.initialMode === 'quick') return 'quick';
    if (recalcState?.mode === 'photo_ai' || recalcState?.initialMode === 'photo_ai') return 'photo_ai';
    return 'photo_ai';
  });

  // Details state
  const [settings, setSettings] = useState<PackingSettings>(() => {
    if (recalcState?.settings) {
      return { ...DEFAULT_SETTINGS, ...recalcState.settings };
    }
    return {
      ...DEFAULT_SETTINGS,
      include_contingency: false,
      contingency_rate: 0,
    };
  });
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    recalcState?.companyId || null
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    recalcState?.clientId || null
  );
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    recalcState?.claimId || null
  );
  const [projectAddress, setProjectAddress] = useState(
    recalcState?.projectAddress || ''
  );

  // Room state
  const [rooms, setRooms] = useState<PackingRoom[]>([]);
  const [photoRooms, setPhotoRooms] = useState<PhotoRoom[]>([]);

  // Result state
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calculatedAt, setCalculatedAt] = useState<Date | null>(null);
  const [calculatedInputs, setCalculatedInputs] = useState<string | null>(null);
  // Sections whose line items are folded away in the estimate column
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const estimateRef = useRef<HTMLElement>(null);

  // Claim packing photos loading into rooms, then a token that starts Analyze All
  const [claimPhotoLoad, setClaimPhotoLoad] = useState<{ done: number; total: number } | null>(null);
  const [autoAnalyzeKey, setAutoAnalyzeKey] = useState<number | undefined>();
  const claimPhotosStarted = useRef(false);
  const [claimImportOpen, setClaimImportOpen] = useState(false);

  // Show recalculation notice
  useEffect(() => {
    if (recalcState?.recalculateFrom) {
      message.info('Settings loaded from previous estimate. Add rooms and recalculate.');
    }
  }, []);

  // A claim's packing photos (all its rooms, or roomNames) become Photo AI rooms
  const loadClaimPhotos = useCallback((
    claimId: string,
    opts: { roomNames?: string[]; existingNames?: string[]; analyze: boolean },
  ) => {
    setClaimPhotoLoad({ done: 0, total: 0 });
    loadClaimPhotoRooms(claimId, (done, total) => setClaimPhotoLoad({ done, total }), opts)
      .then(({ rooms: loaded, failed }) => {
        if (failed > 0) {
          message.warning(`${failed} photo${failed === 1 ? '' : 's'} couldn't be loaded and ${failed === 1 ? 'was' : 'were'} left out`);
        }
        if (loaded.length === 0) {
          message.warning('No packing photos could be loaded from the claim');
          return;
        }
        setPhotoRooms(prev => [...prev, ...loaded]);
        if (opts.analyze) {
          setAutoAnalyzeKey(Date.now());
        } else {
          message.success(`Loaded ${loaded.length} room${loaded.length === 1 ? '' : 's'} from the claim`);
        }
      })
      .catch((err: any) => {
        message.error(err?.response?.data?.detail || "Failed to load the claim's packing photos");
      })
      .finally(() => setClaimPhotoLoad(null));
  }, []);

  // Started from a claim: its packing photos become the Photo AI rooms
  useEffect(() => {
    const claimId: string | undefined = recalcState?.claimPhotos;
    if (!claimId || claimPhotosStarted.current) return;
    claimPhotosStarted.current = true;
    // A reload keeps the job but doesn't import and analyze the photos again
    const rest = { ...recalcState };
    delete rest.claimPhotos;
    navigate(location.pathname, { replace: true, state: rest });
    loadClaimPhotos(claimId, { analyze: true });
  }, []);

  // From Claim: the estimate goes on the claim the photos come from
  const handleLoadFromClaim = useCallback((claim: PackingPhotoClaim, roomNames: string[], analyze: boolean) => {
    if (claim.claim_id !== selectedClaimId) {
      setSelectedClientId(claim.client_id);
      setSelectedClaimId(claim.claim_id);
      if (claim.project_address) setProjectAddress(claim.project_address);
    } else if (!projectAddress && claim.project_address) {
      setProjectAddress(claim.project_address);
    }
    if (!selectedCompanyId && claim.company_id) setSelectedCompanyId(claim.company_id);
    loadClaimPhotos(claim.claim_id, {
      roomNames,
      existingNames: photoRooms.map(r => r.room_name),
      analyze,
    });
  }, [selectedClaimId, selectedCompanyId, projectAddress, photoRooms, loadClaimPhotos]);

  const roomInputs: RoomInput[] = useMemo(() => rooms.map(r => ({
    preset: r.preset,
    floor: r.floor,
    density: r.density,
    hints: r.hints,
    contamination: r.contamination,
    hint_volume: r.hint_volume,
    hint_qty: r.hint_qty,
    special_items: r.special_items,
    custom_special_items: r.custom_special_items,
  })), [rooms]);

  const contentRooms: ContentRoomInput[] = useMemo(() => photoRooms.map(r => ({
    room_name: r.room_name,
    preset_id: r.preset_id,
    items: r.items,
    density: r.density,
    floor: r.floor,
    contamination: r.contamination,
    special_items: r.special_items,
    custom_special_items: r.custom_special_items,
  })), [photoRooms]);

  // Everything the calculation reads; when it moves on, the estimate on screen is out of date
  const inputsKey = useMemo(() => JSON.stringify({
    mode,
    rooms: mode === 'quick' ? roomInputs : contentRooms,
    settings,
    selectedCompanyId,
    selectedClientId,
    selectedClaimId,
    projectAddress,
  }), [mode, roomInputs, contentRooms, settings, selectedCompanyId, selectedClientId, selectedClaimId, projectAddress]);

  const isStale = !!result && calculatedInputs !== null && calculatedInputs !== inputsKey;

  const handleCalculate = useCallback(async () => {
    setCalculating(true);
    const inputsAtStart = inputsKey;
    try {
      let response: EstimateResponse;

      if (mode === 'quick') {
        response = await packingService.quickEstimate({
          client_id: selectedClientId || undefined,
          company_id: selectedCompanyId || undefined,
          claim_id: selectedClaimId || undefined,
          project_address: projectAddress || undefined,
          rooms: roomInputs,
          crew_size: settings.crew_size,
          storage_months: settings.storage_months,
          staging_type: settings.staging_type,
          include_packback: settings.include_packback,
          include_op: settings.include_op,
          op_rate: settings.op_rate,
          include_contingency: settings.include_contingency,
          contingency_rate: settings.contingency_rate,
          region: settings.region,
          special_items: settings.special_items,
          custom_special_items: settings.custom_special_items,
        });
      } else {
        response = await packingService.contentEstimate({
          client_id: selectedClientId || undefined,
          company_id: selectedCompanyId || undefined,
          claim_id: selectedClaimId || undefined,
          project_address: projectAddress || undefined,
          rooms: contentRooms,
          crew_size: settings.crew_size,
          storage_months: settings.storage_months,
          staging_type: settings.staging_type,
          include_packback: settings.include_packback,
          include_op: settings.include_op,
          op_rate: settings.op_rate,
          include_contingency: settings.include_contingency,
          contingency_rate: settings.contingency_rate,
          region: settings.region,
          special_items: settings.special_items,
          custom_special_items: settings.custom_special_items,
        });
      }

      setResult(response);
      setCollapsedSections(new Set());
      setCalculatedInputs(inputsAtStart);
      setCalculatedAt(new Date());
      message.success('Estimate calculated successfully');

      // One column: bring the estimate up from below the inputs
      const top = estimateRef.current?.getBoundingClientRect().top;
      if (top !== undefined && top > window.innerHeight * 0.6) {
        estimateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err: any) {
      message.error(err.response?.data?.detail || 'Failed to calculate estimate');
    } finally {
      setCalculating(false);
    }
  }, [mode, roomInputs, contentRooms, settings, selectedClientId, selectedCompanyId, selectedClaimId, projectAddress, inputsKey]);

  const roomCount = mode === 'quick' ? rooms.length : photoRooms.length;
  const canCalculate = roomCount > 0;
  const analyzingCount = mode === 'photo_ai' ? photoRooms.filter(r => r.analyzing).length : 0;

  const calculateButton = (props: { block?: boolean } = {}) => (
    <Button
      type="primary"
      onClick={handleCalculate}
      loading={calculating}
      disabled={!canCalculate}
      block={props.block}
    >
      {result ? 'Recalculate' : 'Calculate Estimate'}
    </Button>
  );

  const calcState = calculatedAt && result
    ? (isStale ? `Out of date · calculated ${timeFormat.format(calculatedAt)}` : `Calculated ${timeFormat.format(calculatedAt)}`)
    : 'Not calculated yet';
  const meta = `${modeLabel(mode)} · ${roomCount} room${roomCount === 1 ? '' : 's'} · ${calcState}`;

  // What the first calculation still needs, in the order the inputs ask for it
  const unanalyzedCount = mode === 'photo_ai' ? photoRooms.filter(r => !r.analyzed && !r.analyzing).length : 0;
  const checklist: { key: string; done: boolean; text: string }[] = [
    {
      key: 'company',
      done: !!selectedCompanyId,
      text: selectedCompanyId ? 'Company selected' : 'Select a company (required)',
    },
    {
      key: 'rooms',
      done: roomCount > 0,
      text: roomCount > 0
        ? `${roomCount} room${roomCount === 1 ? '' : 's'} added`
        : mode === 'quick'
          ? 'Add rooms from the presets'
          : claimPhotoLoad ? "Loading the claim's packing photos..." : 'Add rooms with photos',
    },
    ...(mode === 'photo_ai' && roomCount > 0 ? [{
      key: 'analysis',
      done: unanalyzedCount === 0 && analyzingCount === 0,
      text: analyzingCount > 0
        ? `Analyzing ${analyzingCount} room${analyzingCount === 1 ? '' : 's'}...`
        : unanalyzedCount > 0
          ? `${unanalyzedCount} room${unanalyzedCount === 1 ? '' : 's'} not analyzed yet; analysis adds the detected items`
          : 'All rooms analyzed',
    }] : []),
  ];

  const foldable = result ? sectionsWithLines(result) : [];
  const allFolded = foldable.length > 0 && foldable.every(s => collapsedSections.has(s));
  const toggleSection = (section: string) => setCollapsedSections(prev => {
    const next = new Set(prev);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });

  return (
    <div className="pk-page pk-builder-page">
      <PageHeader
        leading={
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(recalcState?.returnTo || '/reconstruction-estimate/pack-calculator-new/list')}
            aria-label={recalcState?.returnTo ? 'Back to the client' : 'Back to packing estimates'}
          />
        }
        title={packEstimateTitle({ project_address: projectAddress })}
        meta={roomCount === 0 && !result
          ? <span>Calculate materials and labor for pack-out/pack-in operations</span>
          : <span>{meta}</span>}
        actions={
          <>
            <Segmented
              value={mode}
              onChange={v => setMode(v as PackingMode)}
              options={[
                { value: 'quick', label: 'Quick Estimate', icon: <AppstoreOutlined /> },
                { value: 'photo_ai', label: 'Photo AI', icon: <CameraOutlined /> },
              ]}
              aria-label="Estimation method"
            />
            {calculateButton()}
          </>
        }
      />

      <div className="pk-builder">
        <div className="pk-builder-inputs">
          <DetailsStep
            settings={settings}
            setSettings={setSettings}
            selectedCompanyId={selectedCompanyId}
            setSelectedCompanyId={setSelectedCompanyId}
            selectedClientId={selectedClientId}
            setSelectedClientId={setSelectedClientId}
            selectedClaimId={selectedClaimId}
            setSelectedClaimId={setSelectedClaimId}
            projectAddress={projectAddress}
            setProjectAddress={setProjectAddress}
            includeSettings={false}
          />

          {mode === 'quick'
            ? <QuickEstimateRooms rooms={rooms} setRooms={setRooms} />
            : (
              <PhotoAIRooms
                rooms={photoRooms}
                setRooms={setPhotoRooms}
                loading={claimPhotoLoad}
                autoAnalyzeKey={autoAnalyzeKey}
                onLoadFromClaim={() => setClaimImportOpen(true)}
              />
            )}

          <ClaimPhotosImportModal
            open={claimImportOpen}
            onClose={() => setClaimImportOpen(false)}
            currentClaimId={selectedClaimId}
            existingRoomNames={photoRooms.map(r => r.room_name)}
            onLoad={handleLoadFromClaim}
          />

          <EstimationSettings settings={settings} setSettings={setSettings} />

          {/* One column: the action sits at the end of the inputs as well as in the header */}
          <div className="pk-builder-inline-action">
            {calculateButton({ block: true })}
          </div>
        </div>

        <aside
          ref={estimateRef}
          className={`pk-estimate${calculating ? ' is-calculating' : ''}`}
          aria-label="Estimate"
          aria-busy={calculating}
        >
          <div className="ui-section-head">
            <h2 className="ui-section-title">Estimate</h2>
            <div className="pk-section-actions">
              {foldable.length > 0 && (
                <Button
                  type="text"
                  size="small"
                  className="pk-open-link"
                  onClick={() => setCollapsedSections(allFolded ? new Set() : new Set(foldable))}
                >
                  {allFolded ? 'Show line items' : 'Hide line items'}
                </Button>
              )}
              {result?.id && (
                <Button
                  type="text"
                  size="small"
                  icon={<ExportOutlined />}
                  className="pk-open-link"
                  onClick={() => navigate(`/reconstruction-estimate/pack-calculator-new/${result.id}`)}
                >
                  Open estimate
                </Button>
              )}
            </div>
          </div>

          {isStale && (
            <div className="pk-stale" role="status">
              <span>Inputs changed since the last calculation. Recalculate to update the estimate.</span>
              <Button size="small" onClick={handleCalculate} loading={calculating} disabled={!canCalculate}>
                Recalculate
              </Button>
            </div>
          )}

          {result ? (
            <div key={calculatedAt?.getTime()} className={`pk-estimate-body${isStale ? ' is-stale' : ''}`}>
              <Figures items={estimateFigures(result)} className="pk-figures--estimate" />
              <EstimateBreakdown estimate={result} collapsed={collapsedSections} onToggleSection={toggleSection} />
            </div>
          ) : (
            <div className="pk-estimate-empty">
              <p className="pk-estimate-empty-title">No estimate yet</p>
              <p className="pk-estimate-empty-text">
                {canCalculate
                  ? 'Calculate to see labor, materials, transport and totals here.'
                  : 'Labor, materials, transport and totals appear here after you calculate.'}
              </p>
              <ul className="pk-checklist">
                {checklist.map(item => (
                  <li key={item.key} className={item.done ? 'is-done' : undefined}>
                    {item.done
                      ? <CheckCircleFilled className="pk-check-icon" aria-label="Done" />
                      : <span className="pk-check-ring" aria-label="To do" />}
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
              <dl className="pk-estimate-inputs">
                <div><dt>Rooms</dt><dd>{roomCount}{analyzingCount > 0 ? ` (${analyzingCount} analyzing)` : ''}</dd></div>
                <div><dt>Crew</dt><dd>{settings.crew_size} people</dd></div>
                <div><dt>Region</dt><dd>{regionLabel(settings.region)}</dd></div>
                <div>
                  <dt>Staging</dt>
                  <dd>
                    {settings.staging_type === 'off_site' ? 'Off-site' : 'On-site'}
                    {settings.storage_months > 0 ? ` · ${settings.storage_months} month${settings.storage_months === 1 ? '' : 's'} storage` : ''}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default PackCalculatorNew;
