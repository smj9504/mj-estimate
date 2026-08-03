import React, { createContext, useContext, useState, useCallback } from 'react';

interface BreadcrumbContextValue {
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  pageTitle: null,
  setPageTitle: () => {},
});

export const BreadcrumbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  const handleSetPageTitle = useCallback((title: string | null) => {
    setPageTitle(title);
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ pageTitle, setPageTitle: handleSetPageTitle }}>
      {children}
    </BreadcrumbContext.Provider>
  );
};

/**
 * Hook for pages to set their breadcrumb title.
 * Call in detail pages: useBreadcrumbTitle(job?.address || null);
 */
export const useBreadcrumbTitle = (title: string | null) => {
  const { setPageTitle } = useContext(BreadcrumbContext);

  React.useEffect(() => {
    setPageTitle(title);
    return () => setPageTitle(null);
  }, [title, setPageTitle]);
};

export const useBreadcrumb = () => useContext(BreadcrumbContext);
