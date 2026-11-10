import { router } from 'expo-router';
import { useEffect } from 'react';

import { useOnboarding } from '../../profile/OnboardingProvider';

/**
 * The group's root path ("/"), where the root guard lands a signed-in user with onboarding still
 * open. Once the profile is read it resumes at the first unfinished step: Clothing is the only
 * required one, so with a saved clothing type a relaunch continues at Body (nothing typed is lost) — with
 * Clothing pushed underneath, so going back still reaches the first step and its sign-out link.
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
