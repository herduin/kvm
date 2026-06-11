import { useEffect } from "react";

import { useUiStore } from "./stores";

/**
 * Detects whether the current device is a touch/mobile device and sets
 * `isMobileMode` in the global UI store accordingly.
 *
 * Detection uses two complementary heuristics:
 *  - `navigator.maxTouchPoints > 0`: true on any device that supports touch.
 *  - `(pointer: coarse)` media query: true when the primary pointing device is
 *    a finger (phone/tablet) rather than a precise mouse.
 *
 * Call this hook once at the top of the component tree (e.g. WebRTCVideo) so
 * all child components can read `isMobileMode` from the store.
 */
export function useMobileMode() {
  const { isMobileMode, setMobileMode } = useUiStore();

  useEffect(() => {
    const isTouchDevice =
      navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    setMobileMode(isTouchDevice);
  }, [setMobileMode]);

  return { isMobileMode };
}
