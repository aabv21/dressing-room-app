import { useAuth } from '../auth/AuthProvider';
import type { ClothingType } from './bodyType';

/** The clothing type that decides the categories garment editors offer; every category until it's known. */
export function useClothingType(): ClothingType {
  const { profile } = useAuth();
  return profile?.clothing_type ?? 'everything';
}
