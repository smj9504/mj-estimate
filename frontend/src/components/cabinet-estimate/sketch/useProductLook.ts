/**
 * An option's chosen products over the sketch's finish, ready to draw:
 * productLook(), with each product's swatch picture loaded (a surface shows
 * the product's colour until its picture is in, or if it never loads).
 */

import { useEffect, useMemo, useState } from 'react';
import type { CabinetSketchFinish } from '../../../types/cabinetSketch';
import type { ProductSnapshot } from '../../../types/productLibrary';
import { fileService } from '../../../services/fileService';
import { productLook } from './productLook';
import type { ProductLookResult, ProductSurfaces } from './productLook';

/** Pictures already loaded, by file id, for the page's lifetime. */
const loaded = new Map<string, HTMLImageElement>();

export function useProductLook(
  finish: CabinetSketchFinish,
  products?: Record<string, ProductSnapshot> | null
): ProductLookResult {
  const base = useMemo(() => productLook(finish, products), [finish, products]);
  const [, setLoadedCount] = useState(loaded.size);

  const wanted = useMemo(
    () => Object.values(base.surfaces).map((s) => s?.imageFileId).filter((id): id is string => !!id),
    [base]
  );
  useEffect(() => {
    const live = { current: true };
    const load = (id: string) => {
      const img = new Image();
      // Drawn into WebGL, so fetched with CORS
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loaded.set(id, img);
        if (live.current) setLoadedCount(loaded.size);
      };
      img.src = fileService.getInlineUrl(id);
    };
    wanted.filter((id) => !loaded.has(id)).forEach(load);
    return () => {
      live.current = false;
    };
  }, [wanted]);

  const ready = wanted.filter((id) => loaded.has(id)).join(',');
  const surfaces = useMemo(() => {
    const out: ProductSurfaces = {};
    for (const [key, look] of Object.entries(base.surfaces) as [keyof ProductSurfaces, ProductSurfaces[keyof ProductSurfaces]][]) {
      if (!look) continue;
      out[key] = look.imageFileId ? { ...look, image: loaded.get(look.imageFileId) ?? null } : look;
    }
    return out;
    // `ready` changes as pictures arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, ready]);

  return useMemo(() => ({ ...base, surfaces }), [base, surfaces]);
}
