import React, { useState, useEffect } from 'react';
import { InputNumber, Space, Typography } from 'antd';
import { WallFixture, Wall, WallSegment } from '../../../types/sketch';
import { getSegmentsForFixture } from '../../../utils/wallUtils';

const { Text } = Typography;

interface WallSegmentEditorProps {
  fixture: WallFixture;
  wall: Wall;
  onSegmentLengthChange: (side: 'before' | 'after', lengthFeet: number) => void;
  position?: { x: number; y: number }; // Position for the editor
}

export const WallSegmentEditor: React.FC<WallSegmentEditorProps> = ({
  fixture,
  wall,
  onSegmentLengthChange,
  position = { x: 0, y: 0 }
}) => {
  // Store lengths in total feet (for applying changes)
  const [beforeLength, setBeforeLength] = useState(0);
  const [afterLength, setAfterLength] = useState(0);

  // Store separate feet and inches for input
  const [beforeFeet, setBeforeFeet] = useState<number | undefined>(0);
  const [beforeInches, setBeforeInches] = useState<number | undefined>(0);
  const [afterFeet, setAfterFeet] = useState<number | undefined>(0);
  const [afterInches, setAfterInches] = useState<number | undefined>(0);

  // Get current segment lengths
  useEffect(() => {
    const { beforeSegment, afterSegment } = getSegmentsForFixture(wall, fixture.id);

    console.log('🔍 WallSegmentEditor - wall:', wall.id);
    console.log('🔍 Wall coordinates:', { start: wall.start, end: wall.end });
    console.log('🔍 Fixture:', fixture.id, 'position:', fixture.position);

    if (beforeSegment) {
      // Calculate actual pixel distance between segment start and end
      const pixelLength = Math.sqrt(
        Math.pow(beforeSegment.end.x - beforeSegment.start.x, 2) +
        Math.pow(beforeSegment.end.y - beforeSegment.start.y, 2)
      );
      console.log('📏 Before segment:', {
        start: beforeSegment.start,
        end: beforeSegment.end,
        pixelLength,
        storedLength: beforeSegment.length
      });

      // Convert pixels to feet (20 pixels = 1 foot)
      const totalFeet = pixelLength / 20;
      let feet = Math.floor(totalFeet);
      let inches = Math.round((totalFeet - feet) * 12);

      // Handle case where rounding causes inches to be 12
      if (inches >= 12) {
        feet += 1;
        inches = 0;
      }

      setBeforeLength(totalFeet);
      setBeforeFeet(feet);
      setBeforeInches(inches);
    }

    if (afterSegment) {
      // Calculate actual pixel distance between segment start and end
      const pixelLength = Math.sqrt(
        Math.pow(afterSegment.end.x - afterSegment.start.x, 2) +
        Math.pow(afterSegment.end.y - afterSegment.start.y, 2)
      );
      console.log('📏 After segment:', {
        start: afterSegment.start,
        end: afterSegment.end,
        pixelLength,
        storedLength: afterSegment.length
      });

      // Convert pixels to feet (20 pixels = 1 foot)
      const totalFeet = pixelLength / 20;
      let feet = Math.floor(totalFeet);
      let inches = Math.round((totalFeet - feet) * 12);

      // Handle case where rounding causes inches to be 12
      if (inches >= 12) {
        feet += 1;
        inches = 0;
      }

      setAfterLength(totalFeet);
      setAfterFeet(feet);
      setAfterInches(inches);
    }
  }, [wall, fixture.id]);

  // Before segment handlers
  const handleBeforeFeetChange = (value: number | null) => {
    setBeforeFeet(value === null ? undefined : value);
  };

  const handleBeforeInchesChange = (value: number | null) => {
    setBeforeInches(value === null ? undefined : value);
  };

  const handleBeforePressEnter = () => {
    let feet = beforeFeet ?? 0;
    let inches = beforeInches ?? 0;

    // Handle case where inches >= 12
    if (inches >= 12) {
      feet += Math.floor(inches / 12);
      inches = inches % 12;
    }

    const totalFeet = feet + inches / 12;

    // Minimum 0.5 feet (6 inches)
    if (totalFeet >= 0.5) {
      setBeforeLength(totalFeet);
      setBeforeFeet(feet);
      setBeforeInches(inches);
      onSegmentLengthChange('before', totalFeet);
    } else {
      // Reset to previous valid value
      let feet = Math.floor(beforeLength);
      let inches = Math.round((beforeLength - feet) * 12);
      if (inches >= 12) {
        feet += 1;
        inches = 0;
      }
      setBeforeFeet(feet);
      setBeforeInches(inches);
    }
  };

  const handleBeforeBlur = () => {
    const feet = beforeFeet ?? 0;
    const inches = beforeInches ?? 0;
    const totalFeet = feet + inches / 12;

    if (totalFeet < 0.5) {
      // Reset to previous valid value
      const feet = Math.floor(beforeLength);
      const inches = Math.round((beforeLength - feet) * 12);
      setBeforeFeet(feet);
      setBeforeInches(inches);
    }
  };

  // After segment handlers
  const handleAfterFeetChange = (value: number | null) => {
    setAfterFeet(value === null ? undefined : value);
  };

  const handleAfterInchesChange = (value: number | null) => {
    setAfterInches(value === null ? undefined : value);
  };

  const handleAfterPressEnter = () => {
    let feet = afterFeet ?? 0;
    let inches = afterInches ?? 0;

    // Handle case where inches >= 12
    if (inches >= 12) {
      feet += Math.floor(inches / 12);
      inches = inches % 12;
    }

    const totalFeet = feet + inches / 12;

    // Minimum 0.5 feet (6 inches)
    if (totalFeet >= 0.5) {
      setAfterLength(totalFeet);
      setAfterFeet(feet);
      setAfterInches(inches);
      onSegmentLengthChange('after', totalFeet);
    } else {
      // Reset to previous valid value
      let feet = Math.floor(afterLength);
      let inches = Math.round((afterLength - feet) * 12);
      if (inches >= 12) {
        feet += 1;
        inches = 0;
      }
      setAfterFeet(feet);
      setAfterInches(inches);
    }
  };

  const handleAfterBlur = () => {
    const feet = afterFeet ?? 0;
    const inches = afterInches ?? 0;
    const totalFeet = feet + inches / 12;

    if (totalFeet < 0.5) {
      // Reset to previous valid value
      const feet = Math.floor(afterLength);
      const inches = Math.round((afterLength - feet) * 12);
      setAfterFeet(feet);
      setAfterInches(inches);
    }
  };

  const { beforeSegment, afterSegment } = getSegmentsForFixture(wall, fixture.id);

  return (
    <div
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        backgroundColor: 'white',
        border: '1px solid #d9d9d9',
        borderRadius: '4px',
        padding: '12px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        zIndex: 1000,
        minWidth: '200px'
      }}
    >
      <div style={{ marginBottom: '8px' }}>
        <Text strong style={{ fontSize: '13px' }}>
          Wall Segments
        </Text>
      </div>

      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {beforeSegment && (
          <div>
            <Text style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>Before:</Text>
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber
                size="small"
                value={beforeFeet}
                onChange={handleBeforeFeetChange}
                onPressEnter={handleBeforePressEnter}
                onBlur={handleBeforeBlur}
                min={0}
                max={100}
                step={1}
                precision={0}
                addonAfter="ft"
                style={{ width: '80px' }}
              />
              <InputNumber
                size="small"
                value={beforeInches}
                onChange={handleBeforeInchesChange}
                onPressEnter={handleBeforePressEnter}
                onBlur={handleBeforeBlur}
                min={0}
                max={11}
                step={1}
                precision={0}
                addonAfter="in"
                style={{ width: '80px' }}
              />
            </Space.Compact>
          </div>
        )}

        {afterSegment && (
          <div>
            <Text style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>After:</Text>
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber
                size="small"
                value={afterFeet}
                onChange={handleAfterFeetChange}
                onPressEnter={handleAfterPressEnter}
                onBlur={handleAfterBlur}
                min={0}
                max={100}
                step={1}
                precision={0}
                addonAfter="ft"
                style={{ width: '80px' }}
              />
              <InputNumber
                size="small"
                value={afterInches}
                onChange={handleAfterInchesChange}
                onPressEnter={handleAfterPressEnter}
                onBlur={handleAfterBlur}
                min={0}
                max={11}
                step={1}
                precision={0}
                addonAfter="in"
                style={{ width: '80px' }}
              />
            </Space.Compact>
          </div>
        )}
      </Space>

      <div style={{ marginTop: '8px', fontSize: '11px', color: '#8c8c8c' }}>
        <Text type="secondary">
          Total: {(beforeLength + fixture.dimensions.width + afterLength).toFixed(1)} ft
        </Text>
      </div>
    </div>
  );
};
