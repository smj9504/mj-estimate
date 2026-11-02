/**
 * A visit as a screen sees it: what this phone holds, kept up to date from the
 * server when there's a signal. With none it still opens from what's saved here.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fieldVisitService } from '../../services/fieldVisitService';
import { getVisitSnapshot, liveShots, loadVisit, mergeServerVisit, subscribeVisit, uploadCounts } from './fieldStore';

export const useFieldVisit = (visitId: string, pollMs?: number) => {
  const snapshot = useSyncExternalStore(
    listener => subscribeVisit(visitId, listener),
    () => getVisitSnapshot(visitId),
  );

  useEffect(() => {
    loadVisit(visitId);
  }, [visitId]);

  const server = useQuery({
    queryKey: ['field-visit', visitId],
    queryFn: async () => {
      const askedAt = Date.now();
      const detail = await fieldVisitService.get(visitId);
      await loadVisit(visitId);
      mergeServerVisit(visitId, detail, askedAt);
      return detail;
    },
    retry: 1,
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
  });

  const shots = useMemo(() => liveShots(snapshot), [snapshot]);
  const counts = useMemo(() => uploadCounts(snapshot), [snapshot]);

  return {
    loaded: snapshot.loaded,
    header: snapshot.header,
    rooms: snapshot.rooms,
    shots,
    counts,
    server,
    /** No such visit, or not one this person may see */
    notFound: (server.error as any)?.response?.status === 404,
  };
};
