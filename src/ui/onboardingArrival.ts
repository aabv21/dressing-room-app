import { createContext, useContext } from 'react';

export type OnboardingArrival = {
  /** True from the moment an account finishes onboarding until the tabs have opened on the Closet. */
  pending: boolean;
  settle: () => void;
};

/** Finishing onboarding lands on the Closet: the root guard raises it, the (tabs) layout navigates and settles it. */
export const OnboardingArrivalContext = createContext<OnboardingArrival>({ pending: false, settle: () => undefined });

export function useOnboardingArrival(): OnboardingArrival {
  return useContext(OnboardingArrivalContext);
}
