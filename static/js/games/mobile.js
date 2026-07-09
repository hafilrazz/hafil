/**
 * Detect coarse pointers / small screens for mobile arcade UI.
 */

export function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches || isTouchDevice();
}
