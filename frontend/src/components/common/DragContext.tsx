import React, { createContext, useContext } from 'react';

interface DragContextValue {
  listeners: any;
  attributes: any;
  isDragging: boolean;
}

const DragContext = createContext<DragContextValue | null>(null);

export const DragProvider: React.FC<{
  children: React.ReactNode;
  listeners: any;
  attributes: any;
  isDragging: boolean;
}> = ({ children, listeners, attributes, isDragging }) => {
  return (
    <DragContext.Provider value={{ listeners, attributes, isDragging }}>
      {children}
    </DragContext.Provider>
  );
};

export const useDragContext = () => {
  return useContext(DragContext);
};

export default DragContext;
