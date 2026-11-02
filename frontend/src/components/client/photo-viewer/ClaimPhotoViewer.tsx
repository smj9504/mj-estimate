import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Tag, Tooltip } from 'antd';
import {
  AppstoreOutlined, CheckOutlined, CloseOutlined, FullscreenExitOutlined, FullscreenOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useFileGallery } from '../../common/FileGallery/hooks/useFileGallery';
import { getCategoryColor, getCategoryLabel } from '../../common/FileGallery/categoryColors';
import type { FileContext, FileItem } from '../../common/FileGallery/types';
import { VideoBadge } from '../../common/FileGallery/VideoPlayer';
import { isVideoFile } from '../../common/FileGallery/videoFiles';
import { CLAIM_PHOTO_CATEGORIES } from '../ClaimPhotosSection';
import { WM_PHOTO_CATEGORIES, wmPhotoSetLabel } from '../ClaimWMPhotos';
import PhotoStage from './PhotoStage';
import { countCategories, mergePhotoSets, photoCategory, photoDate, photoKey, photoPlace } from './photoViewerUtils';
import './photoViewer.css';

interface PhotoSet {
  key: string;
  label: string;
  context: FileContext;
  contextId: string;
  categories: string[];
  emptyHint: string;
}

// A tab of the viewer: one set, or all of them as one list
interface ViewerTab {
  key: string;
  label: string;
  sets: PhotoSet[];
  categories: string[];
  emptyHint: string;
}

const ALL_PHOTOS = 'all-photos';

interface PhotoCardProps {
  file: FileItem;
  isCurrent: boolean;
  onSelect: (key: string) => void;
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
      onClick={() => onSelect(photoKey(file))}
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
        {isVideoFile(file) && <VideoBadge file={file} />}
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

interface LoadedSet {
  files: FileItem[];
  loading: boolean;
  error: unknown;
  refetch: () => unknown;
  loadingMore: boolean;
}

// One set with every page loaded, so the chip counts and the arrows cover all
// of it rather than what has been scrolled to.
const LoadSet: React.FC<{
  set: PhotoSet;
  children: (loaded: LoadedSet) => React.ReactElement;
}> = ({ set, children }) => {
  const {
    files, loading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useFileGallery({
    context: set.context,
    contextId: set.contextId,
    fileCategory: 'image',
    enableInfiniteScroll: true,
    // Same as the claim page's gallery, so they share pages already loaded
    pageSize: 20,
    // That gallery uploads and deletes while this is closed
    refetchIfStaleOnMount: true,
  });

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !error) fetchNextPage?.();
  }, [hasNextPage, isFetchingNextPage, error, fetchNextPage]);

  return children({
    files, loading, error, refetch, loadingMore: !!hasNextPage || isFetchingNextPage,
  });
};

// Each set is a hook call and a tab has however many sets it has, so each gets
// a component, nested around what needs them all
const LoadSets: React.FC<{
  sets: PhotoSet[];
  loaded?: LoadedSet[];
  children: (loaded: LoadedSet[]) => React.ReactElement;
}> = ({ sets, loaded = [], children }) => (
  sets.length === 0 ? children(loaded) : (
    <LoadSet set={sets[0]}>
      {(one) => <LoadSets sets={sets.slice(1)} loaded={[...loaded, one]}>{children}</LoadSets>}
    </LoadSet>
  )
);

// A tab's photos: the big photo on one side, category chips over its cards on
// the other.
const PhotoBrowser: React.FC<{
  loaded: LoadedSet[];
  tab: ViewerTab;
  cardsOpen: boolean;
  onCardsAvailable: (available: boolean) => void;
}> = ({ loaded, tab, cardsOpen, onCardsAvailable }) => {
  const files = useMemo(() => mergePhotoSets(loaded.map(l => l.files)), [loaded]);
  const error = loaded.some(l => l.error);
  // With some of the sets in, the rest are "more photos" under their cards
  const loading = files.length === 0 && loaded.some(l => l.loading);
  const loadingMore = loaded.some(l => l.loading || l.loadingMore);
  const retry = () => loaded.filter(l => l.error).forEach(l => l.refetch());

  const categories = useMemo(() => countCategories(files, tab.categories), [files, tab.categories]);

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

  // Not by record: the job's copy of a photo can replace the claim's as its set loads
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  // The first photo until one's picked, or when a filter leaves the picked one out
  const currentIndex = Math.max(0, shown.findIndex(f => photoKey(f) === currentKey));
  const current = shown[currentIndex] ?? null;
  const prev = shown[currentIndex - 1];
  const next = shown[currentIndex + 1];

  const step = useCallback((delta: number) => {
    const target = shown[currentIndex + delta];
    if (target) setCurrentKey(photoKey(target));
  }, [shown, currentIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // With a video in focus the arrows seek within it
      if (e.target instanceof HTMLVideoElement) return;
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

  const loadFailed = error && !loading && files.length === 0;
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
      <Button icon={<ReloadOutlined />} onClick={retry}>Try again</Button>
    </>
  ) : isEmpty ? (
    <>
      <strong>No photos here yet.</strong>
      <span>{tab.emptyHint}</span>
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
        <div className="cpv-cards" ref={cardsRef} aria-busy={loading || loadingMore}>
          {loading && Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="cpv-card cpv-card--skeleton" aria-hidden="true">
              <span className="cpv-card-thumb" />
              <span className="cpv-skeleton-line" />
              <span className="cpv-skeleton-line cpv-skeleton-line--short" />
            </div>
          ))}
          {shown.map(file => (
            <PhotoCard key={file.id} file={file} isCurrent={file.id === current?.id} onSelect={setCurrentKey} />
          ))}
          {!loading && loadingMore && !error && (
            <div className="cpv-cards-note" role="status">Loading more photos...</div>
          )}
          {error && files.length > 0 && (
            <div className="cpv-cards-note" role="alert">
              Some photos didn't load.{' '}
              <Button type="link" size="small" onClick={retry}>Try again</Button>
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
  const tabs = useMemo<ViewerTab[]>(() => {
    const sets: PhotoSet[] = [
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
    ];
    const setTabs = sets.map(set => ({
      key: set.key,
      label: set.label,
      sets: [set],
      categories: set.categories,
      emptyHint: set.emptyHint,
    }));
    return setTabs.length === 1 ? setTabs : [
      {
        key: ALL_PHOTOS,
        label: 'All photos',
        sets,
        categories: sets.flatMap(set => set.categories),
        emptyHint: 'Photos added to this claim or its water mitigation job show up here.',
      },
      ...setTabs,
    ];
  }, [claimId, wmJobs]);

  const [tabKey, setTabKey] = useState(tabs[0].key);
  const currentTab = tabs.find(t => t.key === tabKey) ?? tabs[0];

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
        {tabs.length > 1 && (
          <div className="cpv-tabs" role="tablist" aria-label="Photo set">
            {tabs.map(t => (
              <Button
                key={t.key}
                type="text"
                size="small"
                role="tab"
                aria-selected={currentTab.key === t.key}
                title={t.label}
                className={`ui-view-tab${currentTab.key === t.key ? ' is-selected' : ''}`}
                onClick={() => setTabKey(t.key)}
              >
                {t.label}
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
      <LoadSets key={currentTab.key} sets={currentTab.sets}>
        {(loaded) => (
          <PhotoBrowser
            loaded={loaded}
            tab={currentTab}
            cardsOpen={cardsOpen}
            onCardsAvailable={setCardsAvailable}
          />
        )}
      </LoadSets>
    </div>
  );
};

interface ClaimPhotoViewerProps extends ViewerBodyProps {
  open: boolean;
}

// A claim's photos over the whole window, so they can be looked through without
// leaving the page: the same sets as the Photos section on the client page, all
// of them together first.
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
