/**
 * WMDocumentPages - the document being made from photos: one white letter sheet
 * per page, in order, each showing its photo as it will sit on the page. Drag to
 * reorder, click a sheet to see the photo at full size.
 */
import React, { useState } from 'react';
import { Button, Image, Tooltip } from 'antd';
import { CloseOutlined, FileTextOutlined, RotateRightOutlined, ScissorOutlined } from '@ant-design/icons';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface WMDocumentPagesProps {
  photoIds: string[];
  rotations: Record<string, number>;
  /** A page the document opens with that isn't a photo, like the EWA's form */
  leadingPage?: string;
  sheetUrl: (photoId: string) => string;
  fullSizeUrl: (photoId: string) => string;
  onReorder: (photoIds: string[]) => void;
  onRotate: (photoId: string) => void;
  onCrop: (photoId: string) => void;
  onRemove: (photoId: string) => void;
}

interface PageSheetProps {
  id: string;
  number: number;
  rotation: number;
  src: string;
  onOpen: () => void;
  onRotate: () => void;
  onCrop: () => void;
  onRemove: () => void;
}

const PageSheet: React.FC<PageSheetProps> = ({ id, number, rotation, src, onOpen, onRotate, onCrop, onRemove }) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const [missing, setMissing] = useState(false);

  return (
    <li
      ref={setNodeRef}
      className={`wdc-page${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        className="wdc-sheet"
        aria-label={`See page ${number} at full size`}
        onClick={onOpen}
        {...pointerListeners}
      >
        {missing ? (
          <span className="wdc-sheet-missing">No preview</span>
        ) : (
          <img
            className={`wdc-sheet-photo${rotation % 180 === 90 ? ' is-sideways' : ''}`}
            src={src}
            alt=""
            draggable={false}
            style={{ transform: `rotate(${rotation}deg)` }}
            onError={() => setMissing(true)}
          />
        )}
      </button>
      <div className="wdc-page-bar">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="wdc-page-num"
          {...attributes}
          aria-label={`Page ${number}. Press space to move it.`}
          onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLButtonElement>}
        >
          {number}
        </button>
        <span className="wdc-page-actions">
          <Tooltip title="Rotate 90°">
            <Button type="text" size="small" className="ui-icon-btn" aria-label="Rotate 90°" icon={<RotateRightOutlined />} onClick={onRotate} />
          </Tooltip>
          <Tooltip title="Crop">
            <Button type="text" size="small" className="ui-icon-btn" aria-label="Crop" icon={<ScissorOutlined />} onClick={onCrop} />
          </Tooltip>
          <Tooltip title="Remove">
            <Button type="text" size="small" className="ui-icon-btn ui-icon-btn--danger" aria-label="Remove" icon={<CloseOutlined />} onClick={onRemove} />
          </Tooltip>
        </span>
      </div>
    </li>
  );
};

const WMDocumentPages: React.FC<WMDocumentPagesProps> = ({
  photoIds,
  rotations,
  leadingPage,
  sheetUrl,
  fullSizeUrl,
  onReorder,
  onRotate,
  onCrop,
  onRemove,
}) => {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press, so a phone can still scroll the row of sheets by them
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(photoIds, photoIds.indexOf(String(active.id)), photoIds.indexOf(String(over.id))));
  };

  const firstNumber = leadingPage ? 2 : 1;

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={photoIds} strategy={rectSortingStrategy}>
          <ol className="wdc-pages">
            {leadingPage && (
              <li className="wdc-page">
                <div className="wdc-sheet wdc-sheet--form">
                  <FileTextOutlined aria-hidden />
                  {leadingPage}
                </div>
                <div className="wdc-page-bar">
                  <span className="wdc-page-num wdc-page-num--still">1</span>
                </div>
              </li>
            )}
            {photoIds.map((id, index) => (
              <PageSheet
                key={id}
                id={id}
                number={index + firstNumber}
                rotation={rotations[id] || 0}
                src={sheetUrl(id)}
                onOpen={() => setOpenAt(index)}
                onRotate={() => onRotate(id)}
                onCrop={() => onCrop(id)}
                onRemove={() => onRemove(id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <Image.PreviewGroup
        items={photoIds.map(fullSizeUrl)}
        preview={{
          visible: openAt !== null,
          current: openAt ?? 0,
          onChange: setOpenAt,
          onVisibleChange: (visible) => {
            if (!visible) setOpenAt(null);
          },
          imageRender: (original, { current }) => {
            const rotation = rotations[photoIds[current]] || 0;
            // Fills the preview, or the photo's own size limits have nothing to measure against
            return rotation ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  transform: `rotate(${rotation}deg)`,
                }}
              >
                {original}
              </div>
            ) : original;
          },
        }}
      />
    </>
  );
};

export default WMDocumentPages;
