import React, { useState, useEffect, useRef } from "react";
import { PDFDocumentProxy } from "pdfjs-dist";
import { Bookmark } from "../stores/appStore";

interface TocItem { title: string; page: number; level: number; }
type Mode = "page" | "toc" | "bookmarks";

interface Props {
  doc: PDFDocumentProxy;
  toc: TocItem[];
  bookmarks: Bookmark[];
  currentPage: number;
  totalPages: number;
  onGoPage: (n: number) => void;
  onClose: () => void;
}

export function PdfJumpModal({ doc, toc, bookmarks, currentPage, totalPages, onGoPage, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("page");
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [tocQuery, setTocQuery] = useState("");
  const [selectedToc, setSelectedToc] = useState(0);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const tocInputRef = useRef<HTMLInputElement>(null);

  // Focus the right input when mode changes — but don't auto-focus page number input on mount
  // (that would intercept 1/2/3 keys before user sees the modal)
  useEffect(() => {
    if (mode === "toc") {
      setTimeout(() => tocInputRef.current?.focus(), 30);
    }
    // Page mode: do NOT auto-focus, let keyboard nav work
  }, [mode]);

  const filteredToc = toc.filter((t) => !tocQuery || t.title.toLowerCase().includes(tocQuery.toLowerCase()));

  // c: Tab/Shift+Tab switches modal tabs; 1/2/3 only when NOT in an input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }

      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Tab / Shift+Tab cycle modal tabs
      if (e.key === "Tab") {
        e.preventDefault();
        const modes: Mode[] = ["page", "toc", "bookmarks"];
        const cur = modes.indexOf(mode);
        const next = e.shiftKey
          ? (cur - 1 + modes.length) % modes.length
          : (cur + 1) % modes.length;
        setMode(modes[next]);
        return;
      }

      // 1/2/3 switch tabs only when not typing in an input
      if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "1") { e.preventDefault(); setMode("page"); return; }
        if (e.key === "2") { e.preventDefault(); setMode("toc"); return; }
        if (e.key === "3") { e.preventDefault(); setMode("bookmarks"); return; }
      }

      // Page mode: Enter submits, allow typing digits even without explicit focus
      if (mode === "page") {
        if (e.key === "Enter") { e.preventDefault(); onGoPage(parseInt(pageInput) || 1); return; }
        // Let digits naturally go to the page input if it's focused
      }

      if (mode === "toc") {
        if (e.key === "ArrowDown") { e.preventDefault(); setSelectedToc((i) => Math.min(i + 1, filteredToc.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setSelectedToc((i) => Math.max(i - 1, 0)); }
        if (e.key === "Enter") { e.preventDefault(); const item = filteredToc[selectedToc]; if (item) onGoPage(item.page); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, filteredToc, selectedToc, onGoPage, onClose, pageInput]);

  const TABS: { key: Mode; label: string; hint: string }[] = [
    { key: "page", label: "Page #", hint: "1" },
    { key: "toc", label: "Contents", hint: "2" },
    { key: "bookmarks", label: "Bookmarks", hint: "3" },
  ];

  return (
    <div className="pjump-overlay" onClick={onClose}>
      <div className="pjump-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pjump-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`pjump-tab ${mode === t.key ? "active" : ""}`} onClick={() => setMode(t.key)}>
              {t.label}
              <span className="pjump-tab-hint">{t.hint}</span>
            </button>
          ))}
          <div className="pjump-tab-nav-hint">Tab ↔ switch</div>
          <button className="pjump-close" onClick={onClose}>×</button>
        </div>

        <div className="pjump-body">
          {mode === "page" && (
            <div className="pjump-page-mode">
              <div className="pjump-page-row">
                <span className="pjump-page-label">Go to page</span>
                <input
                  ref={pageInputRef}
                  className="pjump-page-input"
                  type="number"
                  value={pageInput}
                  min={1} max={totalPages}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { onGoPage(parseInt(pageInput) || 1); } }}
                  onClick={(e) => e.currentTarget.select()}
                />
                <span className="pjump-page-total">of {totalPages}</span>
                <button className="pjump-go-btn" onClick={() => onGoPage(parseInt(pageInput) || 1)}>Go</button>
              </div>
              <div className="pjump-page-hint">Click the field or press Enter · Tab to switch tabs</div>
            </div>
          )}

          {mode === "toc" && (
            <div className="pjump-toc-mode">
              {toc.length === 0 ? (
                <div className="pjump-empty">No table of contents in this PDF</div>
              ) : (
                <>
                  <input
                    ref={tocInputRef}
                    className="pjump-search-input"
                    placeholder="Search headings…"
                    value={tocQuery}
                    onChange={(e) => { setTocQuery(e.target.value); setSelectedToc(0); }}
                  />
                  <div className="pjump-toc-list">
                    {filteredToc.map((item, i) => (
                      <button
                        key={i}
                        className={`pjump-toc-item ${i === selectedToc ? "selected" : ""}`}
                        style={{ paddingLeft: 12 + item.level * 14 }}
                        onClick={() => onGoPage(item.page)}
                        onMouseEnter={() => setSelectedToc(i)}
                      >
                        <span className="pjump-toc-title">{item.title}</span>
                        <span className="pjump-toc-page">p.{item.page}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {mode === "bookmarks" && (
            <div className="pjump-bm-mode">
              {bookmarks.length === 0 ? (
                <div className="pjump-empty">No bookmarks for this PDF.<br/>Select text then press <kbd>m</kbd> to bookmark it.</div>
              ) : (
                bookmarks.map((b) => (
                  <button key={b.id} className="pjump-bm-item" onClick={() => b.page && onGoPage(b.page)}>
                    <div className="pjump-bm-header">
                      <span className="pjump-bm-page">Page {b.page}</span>
                      {b.pageHeading && <span className="pjump-bm-section">§ {b.pageHeading}</span>}
                      <span className="pjump-bm-date">{new Date(b.createdAt).toLocaleDateString()}</span>
                    </div>
                    {b.selectedText && (
                      <div className="pjump-bm-sel" style={{ borderLeftColor: b.highlightColor ?? "#f6c90e" }}>
                        "{b.selectedText.slice(0, 80)}{b.selectedText.length > 80 ? "…" : ""}"
                      </div>
                    )}
                    {b.message && <div className="pjump-bm-msg">{b.message}</div>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
