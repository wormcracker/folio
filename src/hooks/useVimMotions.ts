import { useEffect, useRef, useCallback } from "react";

interface UseVimMotionsOptions {
  containerRef: React.RefObject<HTMLElement>;
  onSearch?: () => void;
  onEscape?: () => void;
  // FIX: ref to search visibility so the hook always reads live state,
  // no stale closures, no external suspend/resume needed.
  searchVisibleRef: React.RefObject<boolean>;
  enabled?: boolean;
}

const LINE = 60;
const half = () => window.innerHeight / 2;
const full = () => window.innerHeight;

export function useVimMotions({ containerRef, onSearch, onEscape, searchVisibleRef, enabled = true }: UseVimMotionsOptions) {
  const countRef = useRef("");
  const pendingRef = useRef("");

  const getCount = useCallback(() => {
    const n = parseInt(countRef.current, 10);
    countRef.current = "";
    return isNaN(n) || n === 0 ? 1 : n;
  }, []);

  const by = useCallback((dy: number) => containerRef.current?.scrollBy({ top: dy, behavior: "smooth" }), [containerRef]);
  const to = useCallback((top: number) => containerRef.current?.scrollTo({ top, behavior: "smooth" }), [containerRef]);

  useEffect(() => {
    if (!enabled) return;

    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // FIX: Never intercept when search bar input is focused
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      // FIX: Never intercept modifier combos — those belong to App.tsx
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // FIX: If search is visible, only allow Escape to close it — all other
      // vim keys are suspended. Using a ref avoids stale closure.
      if (searchVisibleRef.current) {
        if (e.key === "Escape") { e.preventDefault(); onEscape?.(); }
        return;
      }

      const el = containerRef.current;
      if (!el) return;
      const key = e.key;

      // Count digits
      if (/^[1-9]$/.test(key) && !pendingRef.current) { countRef.current += key; e.preventDefault(); return; }
      if (/^[0-9]$/.test(key) && countRef.current && !pendingRef.current) { countRef.current += key; e.preventDefault(); return; }

      // gg sequence
      if (pendingRef.current === "g") {
        if (key === "g") to(0);
        pendingRef.current = ""; countRef.current = ""; e.preventDefault(); return;
      }

      switch (key) {
        case "j": case "ArrowDown":   by(LINE * getCount()); e.preventDefault(); break;
        case "k": case "ArrowUp":     by(-LINE * getCount()); e.preventDefault(); break;
        case "h": case "ArrowLeft":   el.scrollBy({ left: -40 * getCount(), behavior: "smooth" }); e.preventDefault(); break;
        case "l": case "ArrowRight":  el.scrollBy({ left: 40 * getCount(), behavior: "smooth" }); e.preventDefault(); break;
        case "d":  by(half() * getCount()); e.preventDefault(); break;
        case "u":  by(-half() * getCount()); e.preventDefault(); break;
        case "f": case " ": case "PageDown": by(full() * getCount()); e.preventDefault(); break;
        case "b": case "PageUp": by(-full() * getCount()); e.preventDefault(); break;
        case "G": {
          const n = parseInt(countRef.current, 10); countRef.current = "";
          to(isNaN(n) || n === 0 ? el.scrollHeight : (el.scrollHeight * n) / 100);
          e.preventDefault(); break;
        }
        case "g": pendingRef.current = "g"; e.preventDefault(); break;
        case "0":
          if (!countRef.current) { el.scrollTo({ left: 0, behavior: "smooth" }); e.preventDefault(); }
          else { countRef.current += "0"; e.preventDefault(); }
          break;
        case "$": el.scrollTo({ left: el.scrollWidth, behavior: "smooth" }); e.preventDefault(); break;
        // "/" opens find/search
        case "/": onSearch?.(); e.preventDefault(); break;
        case "Escape": countRef.current = ""; pendingRef.current = ""; onEscape?.(); e.preventDefault(); break;
        default: pendingRef.current = ""; countRef.current = "";
      }
    };

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled, by, to, getCount, onSearch, onEscape, searchVisibleRef, containerRef]);
}
