import { useCallback, useEffect, useRef } from "react";

import { useHidRpc } from "./useHidRpc";
import { useJsonRpc } from "./useJsonRpc";
import { useUiStore, useVideoStore } from "./stores";

// ─── Tuning constants ────────────────────────────────────────────────────────
/** Maximum milliseconds between touchstart and touchend to count as a tap. */
const TAP_MAX_MS = 250;
/** Milliseconds of held-still contact that triggers long-press drag mode. */
const LONG_PRESS_MS = 500;
/** Maximum pixels a finger may move and still be considered a tap. */
const TAP_MAX_DISTANCE_PX = 12;
/** Mouse-sensitivity multiplier for one-finger trackpad moves. */
const TRACKPAD_SENSITIVITY = 1.5;
/** Scroll-sensitivity multiplier for two-finger swipe wheel events. */
const SCROLL_SENSITIVITY = 0.4;

// ─── HID button masks ────────────────────────────────────────────────────────
const BTN_LEFT = 0x01;
const BTN_RIGHT = 0x02;
const BTN_MIDDLE = 0x04;

// ─── Internal gesture state ──────────────────────────────────────────────────
type GesturePhase = "idle" | "pending" | "dragging" | "scrolling" | "longpress-drag";

interface TouchPoint {
  x: number;
  y: number;
}

function centroid(touches: TouchList): TouchPoint {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < touches.length; i++) {
    sx += touches[i].clientX;
    sy += touches[i].clientY;
  }
  return { x: sx / touches.length, y: sy / touches.length };
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Attaches touch-gesture event listeners to `elementRef` and translates them
 * to HID mouse/wheel events.
 *
 * Gesture table (AnyDesk-style trackpad):
 *
 * | Gesture                           | Action                         |
 * |-----------------------------------|--------------------------------|
 * | 1-finger tap                      | Left click (or right click if  |
 * |                                   | `rightClickNextTap` is set)    |
 * | 2-finger tap                      | Right click                    |
 * | 3-finger tap                      | Middle click                   |
 * | 1-finger drag                     | Relative cursor movement       |
 * | 1-finger long-press then drag     | Left-button drag               |
 * | 2-finger vertical swipe           | Vertical scroll (wheel)        |
 * | 2-finger horizontal swipe         | Horizontal scroll (wheel)      |
 *
 * Direct-touch mode (`touchMode === "direct"`) maps the finger position
 * directly to absolute video coordinates instead of sending relative deltas.
 */
export function useTouchTrackpad(elementRef: React.RefObject<HTMLElement | null>) {
  const { send } = useJsonRpc();
  const { reportAbsMouseEvent, reportRelMouseEvent, rpcHidReady } = useHidRpc();
  const { rightClickNextTap, setRightClickNextTap, touchMode } = useUiStore();
  const {
    width: videoWidth,
    height: videoHeight,
    clientWidth: vcw,
    clientHeight: vch,
  } = useVideoStore();

  // ── Stable refs so event handlers always read the latest values ────────────
  const rightClickNextTapRef = useRef(rightClickNextTap);
  const touchModeRef = useRef(touchMode);
  const videoRef = useRef({ videoWidth, videoHeight, vcw, vch });
  const rpcReadyRef = useRef(rpcHidReady);
  const rpcRef = useRef({ reportAbsMouseEvent, reportRelMouseEvent, send });

  useEffect(() => {
    rightClickNextTapRef.current = rightClickNextTap;
  }, [rightClickNextTap]);
  useEffect(() => {
    touchModeRef.current = touchMode;
  }, [touchMode]);
  useEffect(() => {
    videoRef.current = { videoWidth, videoHeight, vcw, vch };
  }, [videoWidth, videoHeight, vcw, vch]);
  useEffect(() => {
    rpcReadyRef.current = rpcHidReady;
  }, [rpcHidReady]);
  useEffect(() => {
    rpcRef.current = { reportAbsMouseEvent, reportRelMouseEvent, send };
  }, [reportAbsMouseEvent, reportRelMouseEvent, send]);

  // ── Internal gesture state (stored in refs so it doesn't trigger re-renders)
  const phase = useRef<GesturePhase>("idle");
  const startTime = useRef(0);
  const maxTouchCount = useRef(0);
  const startPos = useRef<TouchPoint>({ x: 0, y: 0 });
  const lastPos = useRef<TouchPoint>({ x: 0, y: 0 });
  const lastScrollCentroid = useRef<TouchPoint>({ x: 0, y: 0 });
  const currentButtons = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Low-level send helpers ─────────────────────────────────────────────────

  const sendRel = useCallback((dx: number, dy: number, buttons: number) => {
    if (rpcReadyRef.current) {
      rpcRef.current.reportRelMouseEvent(dx, dy, buttons);
    } else {
      void rpcRef.current.send("relMouseReport", { dx, dy, buttons });
    }
  }, []);

  const sendAbs = useCallback(
    (clientX: number, clientY: number, buttons: number) => {
      const el = elementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { videoWidth: vw, videoHeight: vh, vcw: cw, vch: ch } = videoRef.current;
      if (!cw || !ch) return;

      const videoAspect = vw / vh;
      const elemAspect = cw / ch;

      let effW = cw;
      let effH = ch;
      let offX = 0;
      let offY = 0;

      if (elemAspect > videoAspect) {
        effW = ch * videoAspect;
        offX = (cw - effW) / 2;
      } else if (elemAspect < videoAspect) {
        effH = cw / videoAspect;
        offY = (ch - effH) / 2;
      }

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const clampedX = Math.min(Math.max(offX, localX), offX + effW);
      const clampedY = Math.min(Math.max(offY, localY), offY + effH);
      const x = Math.round(((clampedX - offX) / effW) * 32767);
      const y = Math.round(((clampedY - offY) / effH) * 32767);

      if (rpcReadyRef.current) {
        rpcRef.current.reportAbsMouseEvent(x, y, buttons);
      } else {
        void rpcRef.current.send("absMouseReport", { x, y, buttons });
      }
    },
    [elementRef],
  );

  const sendClick = useCallback(
    (button: number, clientX?: number, clientY?: number) => {
      if (touchModeRef.current === "direct" && clientX !== undefined && clientY !== undefined) {
        sendAbs(clientX, clientY, button);
        setTimeout(() => sendAbs(clientX, clientY, 0), 50);
      } else {
        sendRel(0, 0, button);
        setTimeout(() => sendRel(0, 0, 0), 50);
      }
    },
    [sendAbs, sendRel],
  );

  const sendWheel = useCallback((wheelX: number, wheelY: number) => {
    void rpcRef.current.send("wheelReport", { wheelX, wheelY });
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      clearLongPress();

      const count = e.touches.length;
      const pos = centroid(e.touches);

      phase.current = "pending";
      startTime.current = Date.now();
      maxTouchCount.current = count;
      startPos.current = pos;
      lastPos.current = pos;
      lastScrollCentroid.current = pos;
      currentButtons.current = 0;

      // Arm long-press timer for single-finger gestures
      if (count === 1) {
        longPressTimer.current = setTimeout(() => {
          if (phase.current === "pending") {
            phase.current = "longpress-drag";
            currentButtons.current = BTN_LEFT;
            sendRel(0, 0, BTN_LEFT);
          }
        }, LONG_PRESS_MS);
      }
    },
    [clearLongPress, sendRel],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      const count = e.touches.length;
      const pos = centroid(e.touches);

      // Track the maximum number of simultaneous fingers in this gesture
      if (count > maxTouchCount.current) {
        maxTouchCount.current = count;
      }

      const moved = distance(pos, startPos.current);

      if (phase.current === "pending" && moved > TAP_MAX_DISTANCE_PX) {
        clearLongPress();
        if (count >= 2) {
          phase.current = "scrolling";
          lastScrollCentroid.current = pos;
        } else {
          phase.current = "dragging";
        }
      }

      const dx = (pos.x - lastPos.current.x) * TRACKPAD_SENSITIVITY;
      const dy = (pos.y - lastPos.current.y) * TRACKPAD_SENSITIVITY;

      if (phase.current === "dragging") {
        if (touchModeRef.current === "direct") {
          const t = e.touches[0];
          sendAbs(t.clientX, t.clientY, 0);
        } else {
          sendRel(Math.round(dx), Math.round(dy), 0);
        }
      } else if (phase.current === "longpress-drag") {
        if (touchModeRef.current === "direct") {
          const t = e.touches[0];
          sendAbs(t.clientX, t.clientY, BTN_LEFT);
        } else {
          sendRel(Math.round(dx), Math.round(dy), BTN_LEFT);
        }
      } else if (phase.current === "scrolling" && count >= 2) {
        const scrollDx = (pos.x - lastScrollCentroid.current.x) * SCROLL_SENSITIVITY;
        const scrollDy = (pos.y - lastScrollCentroid.current.y) * SCROLL_SENSITIVITY;
        const wheelX = Math.round(scrollDx);
        // Negate Y: finger moving up → positive deltaY → wheel scroll up (negative HID direction)
        const wheelY = -Math.round(scrollDy);
        if (wheelX !== 0 || wheelY !== 0) {
          sendWheel(wheelX, wheelY);
        }
        lastScrollCentroid.current = pos;
      }

      lastPos.current = pos;
    },
    [clearLongPress, sendAbs, sendRel, sendWheel],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      clearLongPress();

      const elapsed = Date.now() - startTime.current;
      const moved = distance(lastPos.current, startPos.current);
      const fingerCount = maxTouchCount.current;
      const wasTap = elapsed < TAP_MAX_MS && moved < TAP_MAX_DISTANCE_PX;
      const lastTouch = e.changedTouches[0];

      if (phase.current === "longpress-drag") {
        // Release the held button
        sendRel(0, 0, 0);
      } else if (phase.current === "pending" || wasTap) {
        if (fingerCount === 1) {
          if (rightClickNextTapRef.current) {
            sendClick(BTN_RIGHT, lastTouch?.clientX, lastTouch?.clientY);
            setRightClickNextTap(false);
          } else {
            sendClick(BTN_LEFT, lastTouch?.clientX, lastTouch?.clientY);
          }
        } else if (fingerCount === 2) {
          sendClick(BTN_RIGHT, lastTouch?.clientX, lastTouch?.clientY);
        } else if (fingerCount >= 3) {
          sendClick(BTN_MIDDLE, lastTouch?.clientX, lastTouch?.clientY);
        }
      }

      // Reset gesture state when all fingers are lifted
      if (e.touches.length === 0) {
        phase.current = "idle";
        maxTouchCount.current = 0;
        currentButtons.current = 0;
      }
    },
    [clearLongPress, sendClick, sendRel, setRightClickNextTap],
  );

  // ── Effect: attach/detach listeners on the target element ─────────────────
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    // passive: false is required so we can call preventDefault() and suppress
    // native scroll/zoom which would fight with the trackpad gesture.
    const opts: AddEventListenerOptions = { passive: false };

    el.addEventListener("touchstart", handleTouchStart, opts);
    el.addEventListener("touchmove", handleTouchMove, opts);
    el.addEventListener("touchend", handleTouchEnd, opts);
    el.addEventListener("touchcancel", handleTouchEnd, opts);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [elementRef, handleTouchStart, handleTouchMove, handleTouchEnd]);
}
