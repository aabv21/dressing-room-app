import { router } from 'expo-router';
import { useEffect } from 'react';

import { useOnboarding } from '../../profile/OnboardingProvider';

/**
 * Where the guard lands an unfinished onboarding. With a saved clothing type (the only required step)
 * it resumes at Body, with Clothing pushed underneath so back still reaches it and its sign-out link.
 */
export default function OnboardingIndex() {
  const { status, values } = useOnboarding();
  const hasClothingType = values.clothing_type !== null && values.clothing_type !== undefined;

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    router.replace('/clothing');
    if (hasClothingType) {
      router.push('/body');
    }
  }, [status, hasClothingType]);

  return null;
}
