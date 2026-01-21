import React from 'react';
import { Resizable, ResizeCallbackData } from 'react-resizable';

interface ResizableTitleProps {
  onResize: (e: React.SyntheticEvent, data: ResizeCallbackData) => void;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  [key: string]: any;
}

const ResizableTitle: React.FC<ResizableTitleProps> = ({
  onResize,
  width,
  minWidth = 50,
  maxWidth = 800,
  ...restProps
}) => {
  if (!width) {
    return <th {...restProps} />;
  }

  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: -5,
            bottom: 0,
            top: 0,
            width: 10,
            cursor: 'col-resize',
            zIndex: 1,
          }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
      minConstraints={[minWidth, 0]}
      maxConstraints={[maxWidth, 0]}
    >
      <th {...restProps} style={{ ...restProps.style, position: 'relative' }} />
    </Resizable>
  );
};

export default ResizableTitle;
