import React, { useState, useEffect, useRef, useMemo } from "react";
import { Heading } from "../utils/markdownParser";

interface HeadingPickerProps {
  headings: Heading[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

const INDENT = { 1: 0, 2: 12, 3: 22, 4: 32, 5: 40, 6: 48 } as const;
const LEVEL_COLOR: Record<number, string> = {
  1: "#58a6ff", 2: "#bc8cff", 3: "#3fb950", 4: "#f78166", 5: "#ffa657", 6: "#8b949e",
};

export function HeadingPicker({ headings, onSelect, onClose }: HeadingPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return headings;
    const q = query.toLowerCase();
    return headings.filter((h) => h.text.toLowerCase().includes(q));
  }, [headings, query]);

  // Sub-headings for the selected item (for preview panel)
  const preview = useMemo(() => {
    const h = filtered[selectedIdx];
    if (!h) return [];
    const origIdx = headings.findIndex((x) => x.id === h.id);
    const children: Heading[] = [];
    for (let i = origIdx + 1; i < headings.length; i++) {
      if (headings[i].level <= h.level) break;
      children.push(headings[i]);
    }
    return children;
  }, [filtered, selectedIdx, headings]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIdx(0); }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const h = filtered[selectedIdx];
        if (h) onSelect(h.id);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, selectedIdx, onSelect, onClose]);

  return (
    <div className="hpicker-overlay" onClick={onClose}>
      <div className="hpicker-modal" onClick={(e) => e.stopPropagation()}>
        {/* Left: search + list */}
        <div className="hpicker-left">
          <div className="hpicker-search">
            <span className="hpicker-search-icon">/</span>
            <input
              ref={inputRef}
              className="hpicker-input"
              placeholder="Jump to heading…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            <kbd className="hpicker-esc-hint">Esc</kbd>
          </div>
          <div className="hpicker-list" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="hpicker-empty">No headings match</div>
            ) : (
              filtered.map((h, i) => (
                <button
                  key={h.id}
                  data-idx={i}
                  className={`hpicker-item${i === selectedIdx ? " selected" : ""}`}
                  style={{ paddingLeft: 12 + INDENT[h.level as keyof typeof INDENT] }}
                  onClick={() => onSelect(h.id)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span
                    className="hpicker-level"
                    style={{ color: LEVEL_COLOR[h.level] }}
                  >
                    {"#".repeat(h.level)}
                  </span>
                  <span className="hpicker-text">{h.text}</span>
                </button>
              ))
            )}
          </div>
          <div className="hpicker-footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> jump</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>

        {/* Right: preview of selected heading's sub-headings */}
        <div className="hpicker-preview">
          {filtered[selectedIdx] ? (
            <>
              <div className="hpicker-preview-title">
                <span style={{ color: LEVEL_COLOR[filtered[selectedIdx].level] }}>
                  {"#".repeat(filtered[selectedIdx].level)}
                </span>
                {" "}{filtered[selectedIdx].text}
              </div>
              {preview.length === 0 ? (
                <div className="hpicker-preview-empty">No sub-headings</div>
              ) : (
                preview.map((h) => (
                  <div
                    key={h.id}
                    className="hpicker-preview-item"
                    style={{ paddingLeft: (h.level - filtered[selectedIdx].level) * 14 }}
                  >
                    <span style={{ color: LEVEL_COLOR[h.level], opacity: 0.7, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {"#".repeat(h.level)}
                    </span>
                    {" "}
                    <span className="hpicker-preview-text">{h.text}</span>
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="hpicker-preview-empty">No heading selected</div>
          )}
        </div>
      </div>
    </div>
  );
}
