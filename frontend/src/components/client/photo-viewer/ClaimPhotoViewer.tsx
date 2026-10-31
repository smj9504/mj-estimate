import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Tag, Tooltip } from 'antd';
import {
  AppstoreOutlined, CheckOutlined, CloseOutlined, FullscreenExitOutlined, FullscreenOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useFileGallery } from '../../common/FileGallery/hooks/useFileGallery';
import { getCategoryColor, getCategoryLabel } from '../../common/FileGallery/categoryColors';
import type { FileContext, FileItem } from '../../common/FileGallery/types';
import { CLAIM_PHOTO_CATEGORIES } from '../ClaimPhotosSection';
import { WM_PHOTO_CATEGORIES, wmPhotoSetLabel } from '../ClaimWMPhotos';
import PhotoStage from './PhotoStage';
import { countCategories, photoCategory, photoDate, photoPlace } from './photoViewerUtils';
import './photoViewer.css';

interface PhotoSet {
  key: string;
  label: string;
  context: FileContext;
  contextId: string;
  categories: string[];
  emptyHint: string;
}

interface PhotoCardProps {
  file: FileItem;
  isCurrent: boolean;
  onSelect: (id: string) => void;
}

const PhotoCard: React.FC<PhotoCardProps> = memo(({ file, isCurrent, onSelect }) => {
  const category = photoCategory(file);
  const label = getCategoryLabel(category);
  const date = photoDate(file);
  const place = photoPlace(file);
  return (
    <button
      type="button"
      className={`cpv-card${isCurrent ? ' is-current' : ''}`}
      aria-current={isCurrent || undefined}
      aria-label={[file.originalName, label, date, place].filter(Boolean).join(', ')}
      onClick={() => onSelect(file.id)}
    >
      <span className="cpv-card-thumb">
        <img
          src={file.thumbnailUrl || file.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={(e) => {
            // A thumbnail that's gone still has its web size
            if (file.url && e.currentTarget.src !== file.url) e.currentTarget.src = file.url;
          }}
        />
      </span>
      <span className="cpv-card-category">
        <span className="ui-filter-chip-dot" style={{ background: getCategoryColor(category) }} aria-hidden="true" />
        <span className="cpv-card-text">{label}</span>
      </span>
      {date && <span className="cpv-card-meta cpv-card-text">{date}</span>}
      {place && <span className="cpv-card-meta cpv-card-text">{place}</span>}
    </button>
  );
});
PhotoCard.displayName = 'PhotoCard';

interface CategoryChipProps {
  dot?: string;
  label: string;
  count: number;
  selected: boolean;
  showCheck?: boolean;
  onToggle: () => void;
}

const CategoryChip: React.FC<CategoryChipProps> = ({ dot, label, count, selected, showCheck, onToggle }) => (
  <Tag
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    className={`ui-filter-chip${selected ? ' is-selected' : ''}`}
    onClick={onToggle}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    }}
  >
    {dot && <span className="ui-filter-chip-dot" style={{ background: dot }} aria-hidden="true" />}
    {label}
    <span className="cpv-chip-count">{count}</span>
    {showCheck && selected && <CheckOutlined className="ui-filter-chip-check" aria-hidden="true" />}
  </Tag>
);

// One set's photos: the big photo on one side, category chips over its cards on
// the other. Every page of the set loads, so the chip counts and the arrows
// cover all of it rather than what has been scrolled to.
const PhotoSetView: React.FC<{
  set: PhotoSet;
  cardsOpen: boolean;
  onCardsAvailable: (available: boolean) => void;
}> = ({ set, cardsOpen, onCardsAvailable }) => {
  const {
    files, loading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useFileGallery({
    context: set.context,
    contextId: set.contextId,
    fileCategory: 'image',
    enableInfiniteScroll: true,
    // Same as the claim page's gallery, so they share pages already loaded
    pageSize: 20,
  });

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !error) fetchNextPage?.();
  }, [hasNextPage, isFetchingNextPage, error, fetchNextPage]);

  const categories = useMemo(() => countCategories(files, set.categories), [files, set.categories]);

  const [picked, setPicked] = useState<string[]>([]);
  // A category can empty out from under a chip when the photos reload
  const selected = useMemo(
    () => picked.filter(key => categories.some(c => c.key === key)),
    [picked, categories],
  );
  const shown = useMemo(
    () => (selected.length > 0 ? files.filter(f => selected.includes(photoCategory(f))) : files),
    [files, selected],
  );

  const [currentId, setCurrentId] = useState<string | null>(null);
  // The first photo until one's picked, or when a filter leaves the picked one out
  const currentIndex = Math.max(0, shown.findIndex(f => f.id === currentId));
  const current = shown[currentIndex] ?? null;
  const prev = shown[currentIndex - 1];
  const next = shown[currentIndex + 1];

  const step = useCallback((delta: number) => {
    const target = shown[currentIndex + delta];
    if (target) setCurrentId(target.id);
  }, [shown, currentIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step]);

  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardsRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.id, selected, cardsOpen]);

  const toggleCategory = (key: string) => setPicked(
    selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key],
  );

  const loadFailed = !!error && files.length === 0;
  const isEmpty = !loading && !loadFailed && files.length === 0;
  const cardsAvailable = !loadFailed && !isEmpty;
  const showCards = cardsOpen && cardsAvailable;

  useEffect(() => {
    onCardsAvailable(cardsAvailable);
  }, [cardsAvailable, onCardsAvailable]);

  const placeholder = loadFailed ? (
    <>
      <strong>Couldn't load these photos.</strong>
      <span>It may be a connection or server problem.</span>
      <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Try again</Button>
    </>
  ) : isEmpty ? (
    <>
      <strong>No photos here yet.</strong>
      <span>{set.emptyHint}</span>
    </>
  ) : loading ? (
    <span role="status">Loading photos...</span>
  ) : null;

  return (
    <div className={`cpv-body${showCards ? '' : ' is-stage-only'}`}>
      <PhotoStage
        file={current}
        prev={prev}
        next={next}
        position={currentIndex + 1}
        total={shown.length}
        onStep={step}
        placeholder={placeholder}
      />
      <aside className="cpv-panel" aria-label="Photo cards" hidden={!showCards}>
        {files.length > 0 && (
          <div className="cpv-filters" role="group" aria-label="Filter by category">
            <CategoryChip
              label="All"
              count={files.length}
              selected={selected.length === 0}
              onToggle={() => setPicked([])}
            />
            {categories.map(({ key, count }) => (
              <CategoryChip
                key={key}
                dot={getCategoryColor(key)}
                label={getCategoryLabel(key)}
                count={count}
                selected={selected.includes(key)}
                showCheck
                onToggle={() => toggleCategory(key)}
              />
            ))}
          </div>
        )}
        <div className="cpv-cards" ref={cardsRef} aria-busy={loading || isFetchingNextPage}>
          {loading && Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="cpv-card cpv-card--skeleton" aria-hidden="true">
              <span className="cpv-card-thumb" />
              <span className="cpv-skeleton-line" />
              <span className="cpv-skeleton-line cpv-skeleton-line--short" />
            </div>
          ))}
          {shown.map(file => (
            <PhotoCard key={file.id} file={file} isCurrent={file.id === current?.id} onSelect={setCurrentId} />
          ))}
          {(hasNextPage || isFetchingNextPage) && !error && (
            <div className="cpv-cards-note" role="status">Loading more photos...</div>
          )}
          {error && files.length > 0 && (
            <div className="cpv-cards-note" role="alert">
              Some photos didn't load.{' '}
              <Button type="link" size="small" onClick={() => refetch()}>Try again</Button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

interface ViewerBodyProps {
  claimId: string;
  wmJobs: { id: string; property_address?: string; company_name?: string }[];
  subtitle?: string;
  onClose: () => void;
}

const ViewerBody: React.FC<ViewerBodyProps> = ({ claimId, wmJobs, subtitle, onClose }) => {
  const sets = useMemo<PhotoSet[]>(() => [
    ...wmJobs.map((job, i) => ({
      key: job.id,
      label: wmPhotoSetLabel(job, i, wmJobs.length),
      context: 'water-mitigation' as const,
      contextId: job.id,
      categories: WM_PHOTO_CATEGORIES,
      emptyHint: "Photos added to this claim's water mitigation job show up here.",
    })),
    {
      key: claimId,
      label: 'Completion',
      context: 'claim' as const,
      contextId: claimId,
      categories: CLAIM_PHOTO_CATEGORIES,
      emptyHint: "Completion photos added on the client's claim show up here.",
    },
  ], [claimId, wmJobs]);

  const [setKey, setSetKey] = useState(sets[0].key);
  const currentSet = sets.find(s => s.key === setKey) ?? sets[0];

  const [cardsOpen, setCardsOpen] = useState(true);
  // An empty or failed set has no cards to show or hide
  const [cardsAvailable, setCardsAvailable] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  const toggleFullscreen = useCallback(() => {
    const change = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    // Refused by the browser: the viewer still fills the window
    change.catch(() => undefined);
  }, []);

  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // In full screen the browser spends Esc on leaving full screen
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenEnabled) toggleFullscreen();
      } else if (e.key === 'c' || e.key === 'C') {
        if (cardsAvailable) setCardsOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, toggleFullscreen, cardsAvailable]);

  return (
    <div className="cpv">
      <header className="cpv-bar">
        <div className="cpv-title">
          <strong>Photos</strong>
          {subtitle && <span className="cpv-title-meta" title={subtitle}>{subtitle}</span>}
        </div>
        {sets.length > 1 && (
          <div className="cpv-tabs" role="tablist" aria-label="Photo set">
            {sets.map(s => (
              <Button
                key={s.key}
                type="text"
                size="small"
                role="tab"
                aria-selected={currentSet.key === s.key}
                title={s.label}
                className={`ui-view-tab${currentSet.key === s.key ? ' is-selected' : ''}`}
                onClick={() => setSetKey(s.key)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        )}
        <div className="cpv-bar-actions">
          {cardsAvailable && (
            <Tooltip title={`${cardsOpen ? 'Hide' : 'Show'} cards (C)`}>
              <Button
                type="text"
                size="small"
                className="ui-icon-btn"
                aria-pressed={cardsOpen}
                aria-label={cardsOpen ? 'Hide cards' : 'Show cards'}
                icon={<AppstoreOutlined />}
                onClick={() => setCardsOpen(open => !open)}
              >
                <span className="cpv-bar-action-label">{cardsOpen ? 'Hide cards' : 'Show cards'}</span>
              </Button>
            </Tooltip>
          )}
          {document.fullscreenEnabled && (
            <Tooltip title={`${isFullscreen ? 'Exit full screen' : 'Full screen'} (F)`}>
              <Button
                type="text"
                size="small"
                className="ui-icon-btn"
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={toggleFullscreen}
              >
                <span className="cpv-bar-action-label">{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Close (Esc)">
            <Button
              type="text"
              size="small"
              className="ui-icon-btn"
              aria-label="Close photos"
              icon={<CloseOutlined />}
              onClick={onClose}
            />
          </Tooltip>
        </div>
      </header>
      <PhotoSetView
        key={currentSet.key}
        set={currentSet}
        cardsOpen={cardsOpen}
        onCardsAvailable={setCardsAvailable}
      />
    </div>
  );
};

interface ClaimPhotoViewerProps extends ViewerBodyProps {
  open: boolean;
}

// A claim's photos over the whole window, so they can be looked through without
// leaving the page: the same sets as the Photos section on the client page.
const ClaimPhotoViewer: React.FC<ClaimPhotoViewerProps> = ({ open, onClose, subtitle, ...rest }) => (
  <Modal
    open={open}
    onCancel={onClose}
    title={`Photos${subtitle ? ` for ${subtitle}` : ''}`}
    footer={null}
    closable={false}
    keyboard={false}
    destroyOnHidden
    width="100%"
    rootClassName="cpv-root"
    transitionName=""
    maskTransitionName=""
  >
    <ViewerBody {...rest} subtitle={subtitle} onClose={onClose} />
  </Modal>
);

export default ClaimPhotoViewer;
