import { createContext, useContext } from 'react';

export type OnboardingArrival = {
  /** True from the moment an account finishes onboarding until the tabs have opened on the Closet. */
  pending: boolean;
  settle: () => void;
};

/**
 * Finishing onboarding lands on the Closet (where the first goal, adding favorites, lives) instead
 * of Today. The root guard raises it; the (tabs) layout, which only exists once the guard has moved
 * into (tabs), navigates and settles it.
 */
export const OnboardingArrivalContext = createContext<OnboardingArrival>({ pending: false, settle: () => undefined });

export function useOnboardingArrival(): OnboardingArrival {
  return useContext(OnboardingArrivalContext);
}
