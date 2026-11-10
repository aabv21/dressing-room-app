import { useEffect, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import type { ClothingType } from './bodyType';
import { getProfile } from './profileRepository';

/**
 * The signed-in user's clothing type, which decides the categories garment editors offer. Reads the
 * profile once per user; until it arrives, or if the read fails, every category is offered.
 * NOTE: nothing caches the profile app-wide yet, so each screen using this reads it once. Upgrade
 * path: expose the profile from AuthProvider's own launch-time read.
 */
export function useClothingType(): ClothingType {
  const { userId } = useAuth();
  const [loaded, setLoaded] = useState<{ userId: string; clothingType: ClothingType } | null>(null);

  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    let current = true;
    getProfile(userId).then(
      (profile) => {
        const clothingType = profile?.clothing_type ?? null;
        if (current && clothingType !== null) {
          setLoaded({ userId, clothingType });
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [userId]);

  return loaded !== null && loaded.userId === userId ? loaded.clothingType : 'everything';
}
