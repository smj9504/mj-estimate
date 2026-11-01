/**
 * PackingReportModal - download a saved estimate's report, what an adjuster
 * asks for besides the estimate: its contents list, its room photos, or both,
 * room by room. A room's photos are the ones saved with the estimate. One from
 * before rooms kept theirs shows the claim's packing photos filed under the
 * room of the same name, so if it isn't on a claim, or the claim has none of
 * its rooms, it has only its contents list.
 */
import React, { useState } from 'react';
import { Button, Checkbox, Modal, Radio, Spin, message } from 'antd';
import { ExclamationCircleOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useSheetModal } from '../common/ui';
import * as packingService from '../../services/packingEstimateService';
import type { PackingReportRequest } from '../../types/packing-estimate';
import './packing.css';

type ReportContent = 'both' | 'list' | 'photos';

const CONTENTS: { value: ReportContent; label: string; hint: string }[] = [
  { value: 'both', label: 'Contents list and photos', hint: "Each room's items, then its photos" },
  { value: 'list', label: 'Contents list', hint: 'The items of each room' },
  { value: 'photos', label: 'Photos', hint: 'The photos of each room' },
];

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

interface PackingReportModalProps {
  open: boolean;
  onClose: () => void;
  estimateId: string;
}

const PackingReportModal: React.FC<PackingReportModalProps> = ({ open, onClose, estimateId }) => {
  const { sheetProps } = useSheetModal();
  const [content, setContent] = useState<ReportContent | null>(null);
  const [showTotal, setShowTotal] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Fetched each time it opens: the claim's photos may have moved since
  const optionsQuery = useQuery({
    queryKey: ['packing-report-options', estimateId],
    queryFn: () => packingService.getReportOptions(estimateId),
    enabled: open,
    staleTime: 0,
  });
  const options = optionsQuery.data;
  const hasPhotos = (options?.photo_count ?? 0) > 0;
  // Photos when there are some, until a choice is made
  const chosen: ReportContent = content && (hasPhotos || content === 'list')
    ? content
    : hasPhotos ? 'both' : 'list';
  const withList = chosen !== 'photos';
  const withPhotos = chosen !== 'list';

  const rooms = options?.rooms ?? [];
  const inReport = (room: { item_count: number; photo_count: number }) =>
    (withList && room.item_count > 0) || (withPhotos && room.photo_count > 0);
  const shownRooms = rooms.filter(inReport);
  const count = [
    plural(shownRooms.length, 'room'),
    ...(withList ? [plural(shownRooms.reduce((n, r) => n + r.item_count, 0), 'item')] : []),
    ...(withPhotos ? [plural(shownRooms.reduce((n, r) => n + r.photo_count, 0), 'photo')] : []),
  ].join(' · ');

  const handleDownload = async () => {
    const request: PackingReportRequest = {
      contents_list: withList,
      photos: withPhotos,
      estimate_total: showTotal,
    };
    setDownloading(true);
    try {
      await packingService.exportReport(estimateId, request);
      message.success('Report downloaded');
      onClose();
    } catch (err) {
      message.error((await packingService.downloadErrorDetail(err)) || 'Failed to create the report');
    } finally {
      setDownloading(false);
    }
  };

  const noPhotosNote = options && !hasPhotos && (
    <div className="pk-note">
      <ExclamationCircleOutlined aria-hidden="true" />
      <span>
        {options.has_claim
          ? "The claim has no packing photos of these rooms. A room's photos are the ones filed for packing under the same room name on the claim."
          : "This estimate has no saved photos and isn't on a claim, so it has no photos to add."}
      </span>
    </div>
  );

  const body = optionsQuery.isLoading ? (
    <div className="pk-folder-empty"><Spin size="small" /></div>
  ) : optionsQuery.isError || !options ? (
    <div className="pk-folder-empty">
      Couldn't load this estimate's rooms.{' '}
      <button type="button" className="pk-text-link" onClick={() => optionsQuery.refetch()}>Try again</button>
    </div>
  ) : (
    <>
      <Radio.Group
        className="pk-report-choice"
        value={chosen}
        onChange={e => setContent(e.target.value)}
        aria-label="What the report shows"
      >
        {CONTENTS.map(c => (
          <Radio key={c.value} value={c.value} disabled={c.value !== 'list' && !hasPhotos}>
            <span className="pk-report-choice-label">{c.label}</span>
            <span className="pk-report-choice-hint">{c.hint}</span>
          </Radio>
        ))}
      </Radio.Group>
      {noPhotosNote}

      <div className="pk-folder-list pk-report-rooms">
        {rooms.length === 0 ? (
          <div className="pk-folder-empty">This estimate has no rooms.</div>
        ) : rooms.map((room, i) => (
          <div key={`${room.room_name}-${i}`} className={`pk-folder-row${inReport(room) ? '' : ' is-off'}`}>
            <span className="pk-folder-name">{room.room_name}</span>
            <span className="pk-folder-photos">
              {[
                ...(withList ? [plural(room.item_count, 'item')] : []),
                ...(withPhotos ? [room.photo_count > 0 ? plural(room.photo_count, 'photo') : 'No photos'] : []),
              ].join(' · ')}
            </span>
          </div>
        ))}
      </div>
      {chosen === 'photos' && shownRooms.length < rooms.length && (
        <p className="pk-report-hint">Rooms without photos are left out.</p>
      )}

      <Checkbox className="pk-claim-analyze" checked={showTotal} onChange={e => setShowTotal(e.target.checked)}>
        Show the estimate total
      </Checkbox>
    </>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Create Report"
      width={520}
      className="pk-folder-modal"
      {...sheetProps}
      footer={[
        <span key="count" className="pk-folder-count">{options ? count : ''}</span>,
        <Button key="cancel" onClick={onClose} disabled={downloading}>Cancel</Button>,
        <Button
          key="download"
          type="primary"
          icon={<FilePdfOutlined />}
          onClick={handleDownload}
          loading={downloading}
          disabled={!options || shownRooms.length === 0}
        >
          {downloading && withPhotos ? 'Adding photos...' : 'Download PDF'}
        </Button>,
      ]}
      destroyOnHidden
    >
      <p className="pk-folder-intro">
        A report for the adjuster: the estimate's contents list, its room photos, or both, room by room.
      </p>
      {body}
    </Modal>
  );
};

export default PackingReportModal;
