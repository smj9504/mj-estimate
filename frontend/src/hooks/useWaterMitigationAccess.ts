/**
 * Whether the person has the full Water Mitigation screen or only its View
 * grant (water_mitigation_view). The View grant covers job details, photos
 * (no AI tools), documents (no invoice editing) and trash.
 */

import { useAuth } from '../contexts/AuthContext';
import { hasLimitedScreen } from '../constants/screens';

export const useWaterMitigationAccess = () => {
  const { user } = useAuth();
  return { limited: hasLimitedScreen(user?.screens, 'water_mitigation') };
};
