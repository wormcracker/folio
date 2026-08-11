import React, { useState, useEffect, useRef, useMemo } from "react";
import { useAppStore, FolderFile, Tab, Bookmark } from "../stores/appStore";
import { Heading } from "../utils/markdownParser";
import { readFileContent, getFileName, isPdfFile, isMarkdownFile } from "../utils/fileSystem";
import { PdfThumbnails } from "./PdfThumbnails";
import { PDFDocumentProxy } from "pdfjs-dist";

interface SidebarProps {
  headings: Heading[];
  onHeadingClick: (id: string) => void;
  activeHeadingId?: string;
}

type SidebarTab = "toc" | "files" | "recent" | "bookmarks";

// ── Quick-access modal (f / r / b keys) ─────────────────────────────────────
interface QuickModalProps {
  mode: "f" | "r" | "b";
  onClose: () => void;
  headings: Heading[];
  onHeadingClick: (id: string) => void;
  isPdf: boolean;
  pdfDoc: PDFDocumentProxy | null;
  pdfCurrentPage: number;
}

function QuickModal({ mode, onClose, headings, onHeadingClick, isPdf, pdfDoc, pdfCurrentPage }: QuickModalProps) {
  const { recentFiles, bookmarks, addBookmark, getActiveTab } = useAppStore();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [bmScreen, setBmScreen] = useState<"menu" | "add" | "local" | "global">("menu");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeTab = getActiveTab();

  useEffect(() => { inputRef.current?.focus(); }, [bmScreen]);
  useEffect(() => { setSelectedIdx(0); }, [query]);

  const filteredHeadings = useMemo(() => {
    if (!query.trim()) return headings;
    return headings.filter((h) => h.text.toLowerCase().includes(query.toLowerCase()));
  }, [headings, query]);

  const filteredRecent = useMemo(() => {
    if (!query.trim()) return recentFiles;
    return recentFiles.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()) || f.path.toLowerCase().includes(query.toLowerCase()));
  }, [recentFiles, query]);

  // Bookmarks: local = current file, global = all
  const localBookmarks = activeTab ? bookmarks.filter((b) => b.filePath === activeTab.filePath) : [];
  const globalBookmarks = [...bookmarks].sort((a, b) => b.createdAt - a.createdAt);
  const filteredLocal = useMemo(() => {
    if (!query.trim()) return localBookmarks;
    return localBookmarks.filter((b) => (b.selectedText ?? b.preview ?? "").toLowerCase().includes(query.toLowerCase()) || (b.message ?? "").toLowerCase().includes(query.toLowerCase()));
  }, [localBookmarks, query]);
  const filteredGlobal = useMemo(() => {
    if (!query.trim()) return globalBookmarks;
    return globalBookmarks.filter((b) => (b.selectedText ?? b.preview ?? "").toLowerCase().includes(query.toLowerCase()) || (b.message ?? "").toLowerCase().includes(query.toLowerCase()));
  }, [globalBookmarks, query]);

  const { addTab } = useAppStore();

  const handleOpenRecent = async (path: string) => {
    try {
      const recent = recentFiles.find(r => r.path === path);
      if (isPdfFile(path)) {
        addTab({ type: "pdf", filePath: path, fileName: getFileName(path), page: recent?.lastPage ?? 1, zoom: 1.2, layout: "single" });
      } else {
        const content = await readFileContent(path);
        addTab({ type: "md", filePath: path, fileName: getFileName(path), content });
        if (recent?.lastHeadingId) {
          setTimeout(() => (window as any).__scrollToHeading?.(recent.lastHeadingId), 300);
        } else if (recent?.lastScrollY) {
          setTimeout(() => {
            const el = document.querySelector(".md-container") as HTMLElement | null;
            if (el) el.scrollTop = recent.lastScrollY!;
          }, 300);
        }
      }
      onClose();
    } catch {}
  };

  const handleBookmarkGo = async (b: Bookmark) => {
    const active = getActiveTab();
    const scrollToBookmarkText = (bm: Bookmark) => {
      // For PDF: go to page and the highlight overlay is painted automatically
      if (bm.fileType === "pdf" && bm.page && window.__pdfHandle) {
        window.__pdfHandle.goToPage(bm.page);
        return;
      }
      // For MD: scroll the highlighted mark into view
      if (bm.fileType === "md" && bm.selectedText) {
        setTimeout(() => {
          const marks = document.querySelectorAll(".md-bm-highlight");
          for (const mark of marks) {
            if (mark.textContent === bm.selectedText) {
              mark.scrollIntoView({ behavior: "smooth", block: "center" });
              return;
            }
          }
          // Fallback to heading
          if (bm.headingId) onHeadingClick(bm.headingId);
        }, 150);
        return;
      }
      if (bm.headingId) onHeadingClick(bm.headingId);
    };

    if (!active || active.filePath !== b.filePath) {
      try {
        if (b.fileType === "pdf") {
          addTab({ type: "pdf", filePath: b.filePath, fileName: b.fileName, page: b.page ?? 1, zoom: 1.2, layout: "single" });
          setTimeout(() => scrollToBookmarkText(b), 800);
        } else {
          const content = await readFileContent(b.filePath);
          addTab({ type: "md", filePath: b.filePath, fileName: b.fileName, content });
          setTimeout(() => scrollToBookmarkText(b), 400);
        }
        onClose();
        return;
      } catch {}
    }
    scrollToBookmarkText(b);
    onClose();
  };

  // The active list depending on current screen
  const activeList: any[] = (() => {
    if (mode === "r") return filteredRecent;
    if (mode === "f" && !isPdf) return filteredHeadings;
    if (mode === "b") {
      if (bmScreen === "menu")   return [...filteredLocal, ...filteredGlobal];
      if (bmScreen === "local")  return filteredLocal;
      if (bmScreen === "global") return filteredGlobal;
    }
    return [];
  })();

  // Clamp selectedIdx to list length
  const clampedIdx = Math.min(selectedIdx, Math.max(0, activeList.length - 1));

  // Scroll selected item into view
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>(".qmodal-item, .qmodal-bm-item");
    items[clampedIdx]?.scrollIntoView({ block: "nearest" });
  }, [clampedIdx]);

  // Tab bar refs for bookmark panel
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tabFocusIdx, setTabFocusIdx] = useState(0);
  const bmTabOrder: Array<"menu"|"local"|"global"|"add"> = ["menu","local","global","add"];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT";
      const inTabBar = target.classList.contains("qmodal-bm-tab");

      // Ctrl+J / Ctrl+K — list navigation from anywhere
      const navDown = (e.key === "ArrowDown") || (e.ctrlKey && e.key === "j");
      const navUp   = (e.key === "ArrowUp")   || (e.ctrlKey && e.key === "k");

      if (navDown) { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, Math.max(0, activeList.length - 1))); return; }
      if (navUp)   { e.preventDefault(); setSelectedIdx((i) => Math.max(0, i - 1)); return; }

      // Tab / Shift+Tab — cycle through bookmark tabs when in bookmark mode
      if (mode === "b" && !inInput && (e.key === "Tab")) {
        e.preventDefault();
        const next = e.shiftKey
          ? (bmTabOrder.indexOf(bmScreen) - 1 + bmTabOrder.length) % bmTabOrder.length
          : (bmTabOrder.indexOf(bmScreen) + 1) % bmTabOrder.length;
        setBmScreen(bmTabOrder[next]);
        setSelectedIdx(0);
        return;
      }

      if (inInput) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (mode === "f" && !isPdf) {
            const item = filteredHeadings[clampedIdx];
            if (item) { onHeadingClick(item.id); onClose(); }
          } else if (mode === "r") {
            const item = filteredRecent[clampedIdx];
            if (item) handleOpenRecent(item.path);
          } else if (mode === "b" && bmScreen !== "add") {
            const list = bmScreen === "menu" ? [...filteredLocal, ...filteredGlobal] : bmScreen === "local" ? filteredLocal : filteredGlobal;
            const item = list[clampedIdx];
            if (item) handleBookmarkGo(item);
          }
        }
        return;
      }

      // Enter from list item focus
      if (e.key === "Enter" && !inInput) {
        e.preventDefault();
        if (mode === "r") {
          const item = filteredRecent[clampedIdx];
          if (item) handleOpenRecent(item.path);
        } else if (mode === "b" && bmScreen !== "add") {
          const list = bmScreen === "menu" ? [...filteredLocal, ...filteredGlobal] : bmScreen === "local" ? filteredLocal : filteredGlobal;
          const item = list[clampedIdx];
          if (item) handleBookmarkGo(item);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mode, bmScreen, filteredHeadings, filteredRecent, filteredLocal, filteredGlobal, clampedIdx, onClose]); // eslint-disable-line

  const INDENT = { 1: 0, 2: 12, 3: 22, 4: 32, 5: 40, 6: 48 } as const;
  const LEVEL_COLOR: Record<number, string> = { 1: "#58a6ff", 2: "#bc8cff", 3: "#3fb950", 4: "#f78166", 5: "#ffa657", 6: "#8b949e" };

  // ── Bookmark "b" modal — single stable mount, tabs switch content in-place ──
  if (mode === "b") {
    // Derive the visible list from the current tab
    const visibleList =
      bmScreen === "local"  ? filteredLocal  :
      bmScreen === "global" ? filteredGlobal :
      bmScreen === "menu"   ? [...filteredLocal, ...filteredGlobal] : [];

    const tabs: { id: "menu"|"local"|"global"|"add"; label: string; count?: number }[] = [
      { id: "menu",   label: "All",      count: filteredLocal.length + filteredGlobal.length },
      { id: "local",  label: "📄 Local",  count: filteredLocal.length },
      { id: "global", label: "🌐 Global", count: filteredGlobal.length },
      { id: "add",    label: "＋ Add" },
    ];

    return (
      <div className="qmodal-overlay" onClick={onClose}>
        <div className="qmodal qmodal--wide" onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div className="qmodal-header">
            <span className="qmodal-title">Bookmarks</span>
            <button className="qmodal-close" onClick={onClose}>×</button>
          </div>

          {/* Search — always visible, always focused */}
          <div className="qmodal-search">
            <span className="qmodal-search-icon">🔍</span>
            <input
              ref={inputRef}
              className="qmodal-input"
              placeholder={bmScreen === "add" ? "Press m to add a bookmark…" : "Filter bookmarks…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              readOnly={bmScreen === "add"}
            />
            {query && bmScreen !== "add" && (
              <button className="qmodal-clear" onClick={() => setQuery("")}>×</button>
            )}
          </div>

          {/* Tab bar — Tab/Shift-Tab cycles, click switches */}
          <div className="qmodal-bm-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={bmScreen === t.id}
                className={`qmodal-bm-tab${bmScreen === t.id ? " active" : ""}${t.id === "add" ? " qmodal-bm-tab--add" : ""}`}
                onClick={() => { setBmScreen(t.id); setSelectedIdx(0); }}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="qmodal-bm-tab-count">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          {bmScreen === "add" ? (
            <div className="qmodal-bm-add-info">
              <div className="qmodal-bm-add-icon">⊕</div>
              <p>Select text in the document first, then press <kbd>m</kbd> to open the bookmark dialog.</p>
              <p className="qmodal-bm-add-hint">In PDF: also available via the <strong>⊕</strong> toolbar button.</p>
            </div>
          ) : (
            <div className="qmodal-list" ref={listRef}>
              {visibleList.length === 0 ? (
                <div className="qmodal-empty">
                  {query ? `No bookmarks matching "${query}"` : "No bookmarks yet"}
                </div>
              ) : (
                visibleList.map((b, i) => (
                  <button
                    key={b.id}
                    className={`qmodal-bm-item${i === clampedIdx ? " selected" : ""}`}
                    onClick={() => handleBookmarkGo(b)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <div className="qmodal-bm-item-header">
                      <span
                        className="qmodal-bm-item-color-dot"
                        style={{ background: b.highlightColor ?? "#f6c90e" }}
                      />
                      <span className="qmodal-bm-item-file">{b.fileName}</span>
                      {b.page && <span className="qmodal-bm-item-page">p.{b.page}</span>}
                      {bmScreen === "menu" && (
                        <span className={`qmodal-bm-scope-badge ${b.scope === "global" ? "global" : "local"}`}>
                          {b.scope === "global" ? "🌐" : "📄"}
                        </span>
                      )}
                    </div>
                    {b.selectedText && (
                      <div
                        className="qmodal-bm-item-sel"
                        style={{ borderLeftColor: b.highlightColor ?? "#f6c90e" }}
                      >
                        "{b.selectedText.length > 90 ? b.selectedText.slice(0, 90) + "…" : b.selectedText}"
                      </div>
                    )}
                    {b.message && (
                      <div className="qmodal-bm-item-msg">💬 {b.message}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Footer */}
          <div className="qmodal-footer">
            {bmScreen !== "add" && <span><kbd>↑↓</kbd><kbd>^J/K</kbd> navigate · <kbd>↵</kbd> open · </span>}
            <span><kbd>Tab</kbd> switch tab · <kbd>Esc</kbd> close</span>
          </div>

        </div>
      </div>
    );
  }

  // ── "r" modal — Recent files ──
  if (mode === "r") {
    return (
      <div className="qmodal-overlay" onClick={onClose}>
        <div className="qmodal" onClick={(e) => e.stopPropagation()}>
          <div className="qmodal-header">
            <span className="qmodal-title">Recent Files</span>
            <button className="qmodal-close" onClick={onClose}>×</button>
          </div>
          <div className="qmodal-search">
            <span className="qmodal-search-icon">/</span>
            <input
              ref={inputRef}
              className="qmodal-input"
              placeholder="Filter recent files…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && <button className="qmodal-clear" onClick={() => setQuery("")}>×</button>}
          </div>
          <div className="qmodal-list" ref={listRef}>
            {filteredRecent.length === 0 ? (
              <div className="qmodal-empty">{recentFiles.length === 0 ? "No recent files" : "No matches"}</div>
            ) : (
              filteredRecent.map((f, i) => {
                const ext = f.name.split(".").pop()?.toLowerCase();
                const icon = ext === "pdf" ? "📕" : "📄";
                return (
                  <button
                    key={f.path}
                    className={`qmodal-item ${i === clampedIdx ? "selected" : ""}`}
                    onClick={() => handleOpenRecent(f.path)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <span className="qmodal-item-icon">{icon}</span>
                    <div className="qmodal-item-info">
                      <span className="qmodal-item-name">{f.name}</span>
                      <span className="qmodal-item-path">{f.path}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="qmodal-footer">
            <span><kbd>↑↓</kbd> or <kbd>^J/K</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      </div>
    );
  }

  // ── "f" modal — TOC for MD, Thumbnails for PDF ──
  if (mode === "f") {
    if (isPdf) {
      return (
        <div className="qmodal-overlay" onClick={onClose}>
          <div className="qmodal qmodal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="qmodal-header">
              <span className="qmodal-title">Pages</span>
              <button className="qmodal-close" onClick={onClose}>×</button>
            </div>
            <div className="qmodal-search">
              <span className="qmodal-search-icon">⟶</span>
              <input
                className="qmodal-input"
                type="number"
                placeholder={`Jump to page… (1–${pdfDoc?.numPages ?? "?"})`}
                min={1}
                max={pdfDoc?.numPages ?? 9999}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = parseInt((e.target as HTMLInputElement).value);
                    if (n) { window.__pdfHandle?.goToPage(n); onClose(); }
                  }
                  if (e.key === "Escape") onClose();
                }}
              />
            </div>
            <div className="qmodal-pdf-thumbs">
              <PdfThumbnails
                doc={pdfDoc}
                currentPage={pdfCurrentPage}
                onPageClick={(n) => { window.__pdfHandle?.goToPage(n); onClose(); }}
              />
            </div>
            <div className="qmodal-footer"><kbd>↵ Enter</kbd> jump · <kbd>Esc</kbd> close</div>
          </div>
        </div>
      );
    }

    return (
      <div className="qmodal-overlay" onClick={onClose}>
        <div className="qmodal" onClick={(e) => e.stopPropagation()}>
          <div className="qmodal-header">
            <span className="qmodal-title">Contents</span>
            <button className="qmodal-close" onClick={onClose}>×</button>
          </div>
          <div className="qmodal-search">
            <span className="qmodal-search-icon">/</span>
            <input
              ref={inputRef}
              className="qmodal-input"
              placeholder="Jump to heading…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && <button className="qmodal-clear" onClick={() => setQuery("")}>×</button>}
          </div>
          <div className="qmodal-list">
            {filteredHeadings.length === 0 ? (
              <div className="qmodal-empty">{headings.length === 0 ? "No headings" : "No matches"}</div>
            ) : (
              filteredHeadings.map((h, i) => (
                <button
                  key={h.id}
                  data-idx={i}
                  className={`qmodal-item qmodal-toc-item ${i === selectedIdx ? "selected" : ""}`}
                  style={{ paddingLeft: 12 + (INDENT[h.level as keyof typeof INDENT] ?? 0) }}
                  onClick={() => { onHeadingClick(h.id); onClose(); }}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="qmodal-toc-level" style={{ color: LEVEL_COLOR[h.level] }}>{"#".repeat(h.level)}</span>
                  <span className="qmodal-toc-text">{h.text}</span>
                </button>
              ))
            )}
          </div>
          <div className="qmodal-footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> jump</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

export function Sidebar({ headings, onHeadingClick, activeHeadingId }: SidebarProps) {
  const {
    sidebarOpen, recentFiles, folderFiles, openFolder,
    clearRecentFiles, removeRecentFile, addTab, bookmarks, removeBookmark,
    getActiveTab, sidebarActiveTab, setSidebarTab,
  } = useAppStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(new Set());
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [quickMode, setQuickMode] = useState<"f" | "r" | "b" | null>(null);

  const currentTab = getActiveTab();
  const isPdf = currentTab?.type === "pdf";
  const activeTab = sidebarActiveTab;

  // Poll __pdfHandle for doc + current page
  useEffect(() => {
    if (!isPdf) { setPdfDoc(null); return; }
    const poll = () => {
      const handle = window.__pdfHandle;
      if (handle) {
        const d = handle.getDoc();
        if (d) setPdfDoc(d);
        setPdfCurrentPage(handle.getCurrentPage());
      }
    };
    poll();
    const t = setInterval(poll, 200);
    return () => clearInterval(t);
  }, [isPdf, currentTab?.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent).detail?.page as number;
      if (page) setPdfCurrentPage(page);
    };
    window.addEventListener("pdf-page-change", handler);
    return () => window.removeEventListener("pdf-page-change", handler);
  }, []);

  // Global key handlers for quick modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditable = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (inEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f") { e.preventDefault(); setQuickMode("f"); }
      if (e.key === "r") { e.preventDefault(); setQuickMode("r"); }
      if (e.key === "b") { e.preventDefault(); setQuickMode("b"); }
    };
    const openBm = () => setQuickMode("b");
    window.addEventListener("keydown", handler);
    window.addEventListener("folio:open-bookmarks", openBm);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("folio:open-bookmarks", openBm);
    };
  }, []);

  const toggleDir = (path: string) => setExpandedDirs((p) => { const n = new Set(p); n.has(path) ? n.delete(path) : n.add(path); return n; });
  const toggleFold = (id: string) => setCollapsedHeadings((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const visibleHeadings = headings.filter((h, i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (headings[j].level < h.level && collapsedHeadings.has(headings[j].id)) return false;
    }
    return true;
  });

  const hasChildren = (idx: number) => headings.slice(idx + 1).some((n) => n.level > headings[idx].level);

  const handleFileOpen = async (path: string) => {
    try {
      const recent = recentFiles.find(r => r.path === path);
      if (isPdfFile(path)) {
        addTab({ type: "pdf", filePath: path, fileName: getFileName(path), page: recent?.lastPage ?? 1, zoom: 1.2, layout: "single" });
      } else {
        const content = await readFileContent(path);
        addTab({ type: "md", filePath: path, fileName: getFileName(path), content });
        if (recent?.lastHeadingId) {
          setTimeout(() => (window as any).__scrollToHeading?.(recent.lastHeadingId), 300);
        } else if (recent?.lastScrollY) {
          setTimeout(() => {
            const el = document.querySelector(".md-container") as HTMLElement | null;
            if (el) el.scrollTop = recent.lastScrollY!;
          }, 300);
        }
      }
    } catch {}
  };

  const folderHasMd = (dir: string) =>
    folderFiles.some((f) => !f.is_dir && f.path.startsWith(dir + "/") && f.supported);

  const buildTree = (parentPath: string) =>
    folderFiles
      .filter((f) => f.path.replace("/" + f.name, "") === parentPath)
      .sort((a, b) => (a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name)));

  const renderTree = (parentPath: string, depth = 0): React.ReactNode =>
    buildTree(parentPath).map((file) => {
      if (file.is_dir) {
        const hasMd = folderHasMd(file.path);
        const expanded = expandedDirs.has(file.path);
        return (
          <div key={file.path}>
            <div style={{ paddingLeft: depth * 12 }}
              className={`sidebar-file-item sidebar-dir${hasMd ? "" : " sidebar-dir--empty"}`}
              onClick={() => toggleDir(file.path)} title={file.path}>
              <span className="sidebar-icon">{expanded ? "▾" : "▸"}</span>
              <span className="sidebar-file-name">{file.name}</span>
            </div>
            {expanded && renderTree(file.path, depth + 1)}
          </div>
        );
      }
      const disabled = !file.supported;
      return (
        <div key={file.path} style={{ paddingLeft: depth * 12 + 12 }}>
          <div
            className={`sidebar-file-item sidebar-file ${file.extension === "pdf" ? "sidebar-pdf" : ""}${disabled ? " sidebar-file--disabled" : ""}`}
            onClick={() => !disabled && handleFileOpen(file.path)}
            title={disabled ? `${file.path} (unsupported file type)` : file.path}
          >
            <span className="sidebar-icon">{file.extension === "pdf" ? "⬜" : "·"}</span>
            <span className="sidebar-file-name">{file.name}</span>
          </div>
        </div>
      );
    });

  const fileBookmarks = currentTab ? bookmarks.filter((b) => b.filePath === currentTab.filePath) : [];
  const otherBookmarks = currentTab ? bookmarks.filter((b) => b.filePath !== currentTab.filePath) : bookmarks;

  const handleBookmarkGo = async (b: Bookmark) => {
    const active = getActiveTab();

    const scrollToBookmarkText = (bm: Bookmark) => {
      if (bm.fileType === "pdf" && bm.page && window.__pdfHandle) {
        window.__pdfHandle.goToPage(bm.page);
        return;
      }
      if (bm.fileType === "md" && bm.selectedText) {
        setTimeout(() => {
          const marks = document.querySelectorAll(".md-bm-highlight");
          for (const mark of marks) {
            if (mark.textContent === bm.selectedText) {
              mark.scrollIntoView({ behavior: "smooth", block: "center" });
              return;
            }
          }
          if (bm.headingId) onHeadingClick(bm.headingId);
        }, 150);
        return;
      }
      if (bm.headingId) onHeadingClick(bm.headingId);
    };

    if (!active || active.filePath !== b.filePath) {
      try {
        if (b.fileType === "pdf") {
          addTab({ type: "pdf", filePath: b.filePath, fileName: b.fileName, page: b.page ?? 1, zoom: 1.2, layout: "single" });
          setTimeout(() => scrollToBookmarkText(b), 800);
          return;
        } else {
          const content = await readFileContent(b.filePath);
          addTab({ type: "md", filePath: b.filePath, fileName: b.fileName, content });
          setTimeout(() => scrollToBookmarkText(b), 400);
          return;
        }
      } catch {}
    }
    scrollToBookmarkText(b);
  };

  const SIDEBAR_TABS: { key: SidebarTab; icon: string; title: string; hint: string }[] = [
    { key: "toc", icon: isPdf ? "⊞" : "≡", title: isPdf ? "Thumbnails (f)" : "Contents (f)", hint: "1" },
    { key: "files", icon: "⌂", title: "Files (2)", hint: "2" },
    { key: "bookmarks", icon: "⊕", title: "Bookmarks (b)", hint: "3" },
    { key: "recent", icon: "◷", title: "Recent (r)", hint: "4" },
  ];

  return (
    <>
      <aside className={`sidebar${sidebarOpen ? "" : " sidebar--hidden"}`}>
        <div className="sidebar-tabs">
          {SIDEBAR_TABS.map((t) => (
            <button
              key={t.key}
              className={`sidebar-tab-btn ${activeTab === t.key ? "active" : ""}`}
              onClick={() => setSidebarTab(t.key)}
              title={`${t.title} [${t.hint}]`}
            >
              {t.icon}
              <span className="sidebar-tab-hint">{t.hint}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-content">
          {/* TOC / Thumbnails */}
          {activeTab === "toc" && (
            <div className="toc-panel">
              {isPdf && currentTab ? (
                <>
                  <div className="sidebar-section-title">Pages</div>
                  <PdfThumbnails
                    doc={pdfDoc}
                    currentPage={pdfCurrentPage}
                    onPageClick={(n) => window.__pdfHandle?.goToPage(n)}
                  />
                </>
              ) : (
                <>
                  <div className="sidebar-section-title">Contents</div>
                  {headings.length === 0 ? <div className="sidebar-empty">No headings</div> : (
                    visibleHeadings.map((h) => {
                      const origIdx = headings.indexOf(h);
                      const foldable = hasChildren(origIdx);
                      const collapsed = collapsedHeadings.has(h.id);
                      const isActive = h.id === activeHeadingId;
                      return (
                        <div key={h.id} className={`toc-item-wrapper toc-h${h.level}${isActive ? " toc-item--active" : ""}`}>
                          {foldable ? (
                            <button className="toc-fold-btn" onClick={() => toggleFold(h.id)}>{collapsed ? "▸" : "▾"}</button>
                          ) : <span className="toc-fold-spacer" />}
                          <button className="toc-label" onClick={() => onHeadingClick(h.id)} title={h.text}>{h.text}</button>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          )}

          {/* File browser */}
          {activeTab === "files" && (
            <div className="files-panel">
              <div className="sidebar-section-title">{openFolder ? openFolder.split("/").pop() : "No folder open"}</div>
              {folderFiles.length === 0 ? <div className="sidebar-empty">Open a folder to browse</div> : (
                <div className="file-tree">{openFolder && renderTree(openFolder)}</div>
              )}
            </div>
          )}

          {/* Bookmarks */}
          {activeTab === "bookmarks" && (
            <div className="bm-panel">
              <div className="sidebar-section-title sidebar-section-title--row">
                <span>Bookmarks</span>
                {bookmarks.length > 0 && <span className="bm-file-count">{bookmarks.length}</span>}
              </div>
              {bookmarks.length === 0 ? (
                <div className="sidebar-empty">No bookmarks yet.<br />Select text then press <kbd>m</kbd> to bookmark it.</div>
              ) : (
                <>
                  {fileBookmarks.length > 0 && <div className="bm-section-label">This file</div>}
                  {fileBookmarks.map((b) => (
                    <BookmarkItem key={b.id} b={b} onRemove={removeBookmark} onGo={handleBookmarkGo} />
                  ))}
                  {otherBookmarks.length > 0 && (
                    <>
                      <div className="bm-section-label">Other files</div>
                      {otherBookmarks.map((b) => (
                        <BookmarkItem key={b.id} b={b} onRemove={removeBookmark} onGo={handleBookmarkGo} />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Recent */}
          {activeTab === "recent" && (
            <div className="recent-panel">
              <div className="sidebar-section-title sidebar-section-title--row">
                <span>Recent</span>
                {recentFiles.length > 0 && <button className="clear-btn" onClick={clearRecentFiles}>Clear all</button>}
              </div>
              {recentFiles.length === 0 ? <div className="sidebar-empty">No recent files</div> : (
                recentFiles.map((f) => (
                  <div key={f.path} className="recent-item-wrapper">
                    <button className="recent-item" onClick={() => handleFileOpen(f.path)} title={f.path}>
                      <div className="recent-info">
                        <span className="recent-name">{f.name}</span>
                        <span className="recent-path">{f.path}</span>
                      </div>
                    </button>
                    <button className="recent-delete-btn" onClick={(e) => { e.stopPropagation(); removeRecentFile(f.path); }}>×</button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Quick-access modals triggered by f/r/b */}
      {quickMode && (
        <QuickModal
          mode={quickMode}
          onClose={() => setQuickMode(null)}
          headings={headings}
          onHeadingClick={onHeadingClick}
          isPdf={isPdf}
          pdfDoc={pdfDoc}
          pdfCurrentPage={pdfCurrentPage}
        />
      )}
    </>
  );
}

function BookmarkItem({ b, onRemove, onGo }: { b: Bookmark; onRemove: (id: string) => void; onGo: (b: Bookmark) => void }) {
  return (
    <div className="bm-item-wrapper">
      <button className="bm-item" onClick={() => onGo(b)}>
        <div className="bm-item-header">
          <span className="bm-item-file">{b.fileName}</span>
          {b.page && <span className="bm-item-page">p.{b.page}</span>}
          {b.lineNumber && <span className="bm-item-page">L{b.lineNumber}</span>}
          {b.headingText && <span className="bm-item-heading">{b.headingText}</span>}
        </div>
        {b.selectedText && (
          <div className="bm-item-sel" style={{ borderLeftColor: b.highlightColor ?? "#f6c90e" }}>
            "{b.selectedText.slice(0, 60)}{b.selectedText.length > 60 ? "…" : ""}"
          </div>
        )}
        {b.message && <div className="bm-item-msg">{b.message}</div>}
        {!b.selectedText && <div className="bm-item-preview">{b.preview}</div>}
      </button>
      <button className="bm-item-del" onClick={(e) => { e.stopPropagation(); onRemove(b.id); }}>×</button>
    </div>
  );
}
