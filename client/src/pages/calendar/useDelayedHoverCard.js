import { useCallback, useEffect, useRef, useState } from 'react';

const SHOW_MS = 140;
const HIDE_MS = 160;

/**
 * Delayed show/hide for calendar event hover cards (pill + time-grid blocks).
 */
export default function useDelayedHoverCard() {
  const anchorRef = useRef(null);
  const showT = useRef(null);
  const hideT = useRef(null);
  const [anchorRect, setAnchorRect] = useState(null);

  const clearTimers = useCallback(() => {
    clearTimeout(showT.current);
    clearTimeout(hideT.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  function openSoon() {
    clearTimers();
    showT.current = setTimeout(() => {
      if (anchorRef.current) setAnchorRect(anchorRef.current.getBoundingClientRect());
    }, SHOW_MS);
  }

  function closeSoon() {
    clearTimers();
    hideT.current = setTimeout(() => setAnchorRect(null), HIDE_MS);
  }

  function closeNow() {
    clearTimers();
    setAnchorRect(null);
  }

  return {
    anchorRef,
    anchorRect,
    openSoon,
    closeSoon,
    closeNow,
    keepOpen: clearTimers,
  };
}
