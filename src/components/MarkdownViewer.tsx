import React, { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";
import { parseMarkdown, Heading } from "../utils/markdownParser";
import { useVimMotions } from "../hooks/useVimMotions";
import { useSearch } from "../hooks/useSearch";
import { SearchBar } from "./SearchBar";
import { resolvePath, readFileContent, getFileName, isMarkdownFile } from "../utils/fileSystem";
import { useAppStore } from "../stores/appStore";
import { BookmarkModal } from "./BookmarkModal";

interface MarkdownViewerProps {
  content: string;
  filePath: string;
  tabId: string;
  onHeadingsChange: (headings: Heading[]) => void;
  onActiveHeadingChange?: (id: string | undefined) => void;
  initialScrollY?: number;
}

const POLL_MS = 1000;

export function MarkdownViewer({ content, filePath, tabId, onHeadingsChange, onActiveHeadingChange, initialScrollY }: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { addTab, updateMdScroll, updateMdContent, addBookmark, bookmarks, getActiveTab, settings, updateRecentPosition } = useAppStore();
  const search = useSearch(contentRef as React.RefObject<HTMLElement>);
  const [searchVisible, setSearchVisible] = useState(false);
  const searchVisibleRef = useRef(false);
  const [showBookmarkAdd, setShowBookmarkAdd] = useState(false);
  const [currentHeading, setCurrentHeading] = useState<{ id: string; text: string } | null>(null);
  const [currentLine, setCurrentLine] = useState(1);
  const [pendingSelection, setPendingSelection] = useState<{ text: string; context: string } | null>(null);

  const { html, headings } = useMemo(() => parseMarkdown(content, filePath, () => {}), [content, filePath]);
  useEffect(() => { onHeadingsChange(headings); }, [headings, onHeadingsChange]);

  useEffect(() => {
    if (initialScrollY && containerRef.current) containerRef.current.scrollTop = initialScrollY;
  }, [tabId]); // eslint-disable-line

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      updateMdScroll(tabId, el.scrollTop);
      const allHeadings = document.querySelectorAll<HTMLElement>(
        ".markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6"
      );
      let active: { id: string; text: string } | null = null;
      for (const h of allHeadings) {
        if (h.offsetTop - el.scrollTop <= 80) active = { id: h.id, text: h.textContent ?? "" };
        else break;
      }
      setCurrentHeading(active);
      onActiveHeadingChange?.(active?.id);
      updateRecentPosition(filePath, { scrollY: el.scrollTop, headingId: active?.id });
      const lineHeight = 24;
      setCurrentLine(Math.max(1, Math.round(el.scrollTop / lineHeight) + 1));
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [tabId, updateMdScroll, onActiveHeadingChange]);

  // Hot reload
  useEffect(() => {
    if (!filePath) return;
    let last = content;
    const t = setInterval(async () => {
      try {
        const fresh = await invoke<string>("read_file", { path: filePath });
        if (fresh !== last) { last = fresh; updateMdContent(tabId, fresh); }
      } catch {}
    }, POLL_MS);
    return () => clearInterval(t);
  }, [filePath, tabId]); // eslint-disable-line

  // Capture text selection for bookmarks — latched on pointerup, NOT selectionchange.
  // selectionchange fires when a modal opens (focus change clears the selection),
  // which would null out pendingSelection before the modal can read it.
  // pointerup fires immediately after the user finishes dragging, before any click handler.
  const latchedSelRef = useRef<{ text: string; context: string } | null>(null);
  useEffect(() => {
    const onPointerUp = () => {
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const text = sel.toString().trim();
        if (!text) return;
        // Only latch if selection is inside the markdown content
        const range = sel.getRangeAt(0);
        const ancestor = range.commonAncestorContainer;
        const el = ancestor instanceof Element ? ancestor : ancestor.parentElement;
        if (!el?.closest(".markdown-body")) return;
        const context = el?.closest("p,li,blockquote,h1,h2,h3,h4,h5,h6")?.textContent?.slice(0, 200) ?? "";
        const latched = { text, context };
        latchedSelRef.current = latched;
        setPendingSelection(latched);
      });
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, []);

  // Render existing highlights from bookmarks.
  // Runs after html is set (dangerouslySetInnerHTML replaces DOM, wiping any injected marks).
  // Strategy: depth-first walk of all text nodes; for each text node try every bookmark.
  // A text node may match multiple bookmarks — we split it each time and recurse on the tail.
  useEffect(() => {
    // Use a requestAnimationFrame so React has committed the dangerouslySetInnerHTML update.
    const raf = requestAnimationFrame(() => {
      const body = contentRef.current?.querySelector(".markdown-body");
      if (!body) return;

      // Remove any stale marks (shouldn't exist since html re-render resets DOM, but be safe)
      body.querySelectorAll(".md-bm-highlight").forEach((el) => {
        const parent = el.parentNode;
        if (parent) { parent.replaceChild(document.createTextNode(el.textContent ?? ""), el); parent.normalize(); }
      });

      const fileBookmarks = bookmarks.filter(
        (b) => b.filePath === filePath && b.selectedText && b.fileType === "md"
      );
      if (fileBookmarks.length === 0) return;

      // ── Build a rope of all leaf text nodes (excluding code/script/style) ────
      type RopeEntry = { node: Text; start: number; end: number };
      const rope: RopeEntry[] = [];
      let ropeText = "";

      const collectTextNodes = (node: Node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as Element).tagName;
          if (["SCRIPT","STYLE","CODE","PRE"].includes(tag)) return;
          node.childNodes.forEach(collectTextNodes);
        } else if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent ?? "";
          if (!t) return;
          rope.push({ node: node as Text, start: ropeText.length, end: ropeText.length + t.length });
          ropeText += t;
        }
      };
      collectTextNodes(body);
      if (rope.length === 0) return;

      // ── Whitespace-normalised search ─────────────────────────────────────────
      // pdfjs and browser selections include real newlines / multiple spaces that
      // differ from what the DOM contains. Normalise both needle and haystack to
      // collapse any whitespace run into a single space, then map matches back.
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();

      // Build normRope: normalised ropeText + map normIdx → ropeText idx
      let normRopeText = "";
      const normToRope: number[] = []; // normRopeText index → ropeText index
      {
        let ri = 0;
        while (ri < ropeText.length) {
          const ch = ropeText[ri];
          if (/\s/.test(ch)) {
            normRopeText += " ";
            normToRope.push(ri);
            while (ri < ropeText.length && /\s/.test(ropeText[ri])) ri++;
          } else {
            normRopeText += ch;
            normToRope.push(ri);
            ri++;
          }
        }
      }

      // ── Apply each bookmark ──────────────────────────────────────────────────
      // We work on a snapshot of the rope BEFORE mutations, then apply each
      // bookmark to nodes by rope character range. After mutation the rope is
      // stale but that's fine — each bookmark is independent and we re-snapshot.
      for (const bm of fileBookmarks) {
        const normSel = norm(bm.selectedText!);
        if (!normSel) continue;
        const color = bm.highlightColor ?? "#f6c90e";

        let searchFrom = 0;
        // Could be multiple instances; highlight all occurrences
        while (true) {
          const normIdx = normRopeText.indexOf(normSel, searchFrom);
          if (normIdx === -1) break;
          const normEnd = normIdx + normSel.length;
          searchFrom = normIdx + 1;

          // Map back to rope char positions
          const ropeStart = normToRope[normIdx];
          const ropeEnd   = normToRope[Math.min(normEnd, normToRope.length - 1)] + 1;

          // Find which rope entries are covered by [ropeStart, ropeEnd)
          // We take a snapshot of current rope at this moment
          const snapshot: RopeEntry[] = [];
          let ri = 0;
          // Rebuild live rope since previous iterations may have split text nodes
          const liveRope: RopeEntry[] = [];
          let liveText = "";
          const rebuildRope = (node: Node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const tag = (node as Element).tagName;
              if (["SCRIPT","STYLE","CODE","PRE","MARK"].includes(tag)) return;
              node.childNodes.forEach(rebuildRope);
            } else if (node.nodeType === Node.TEXT_NODE) {
              const t = node.textContent ?? "";
              if (!t) return;
              liveRope.push({ node: node as Text, start: liveText.length, end: liveText.length + t.length });
              liveText += t;
            }
          };
          rebuildRope(body);

          // Recalculate normToRope on liveText for this bookmark (reuse same logic)
          let liveNorm = "";
          const liveNormToLive: number[] = [];
          {
            let i2 = 0;
            while (i2 < liveText.length) {
              const ch = liveText[i2];
              if (/\s/.test(ch)) {
                liveNorm += " ";
                liveNormToLive.push(i2);
                while (i2 < liveText.length && /\s/.test(liveText[i2])) i2++;
              } else {
                liveNorm += ch;
                liveNormToLive.push(i2);
                i2++;
              }
            }
          }

          const liveNormIdx = liveNorm.indexOf(normSel);
          if (liveNormIdx === -1) break;
          const liveNormEnd = liveNormIdx + normSel.length;
          const liveStart = liveNormToLive[liveNormIdx];
          const liveEnd   = liveNormToLive[Math.min(liveNormEnd, liveNormToLive.length - 1)] + 1;

          // Nodes that overlap [liveStart, liveEnd)
          const hitEntries = liveRope.filter(e => e.end > liveStart && e.start < liveEnd);
          if (hitEntries.length === 0) break;

          // Wrap each hit node (or the relevant slice of it) in a <mark>
          for (const entry of hitEntries) {
            const nodeText = entry.node.textContent ?? "";
            const sliceStart = Math.max(0, liveStart - entry.start);
            const sliceEnd   = Math.min(nodeText.length, liveEnd - entry.start);
            if (sliceStart >= sliceEnd) continue;

            const parent = entry.node.parentNode;
            if (!parent) continue;

            const before = document.createTextNode(nodeText.slice(0, sliceStart));
            const mark = document.createElement("mark");
            mark.className = "md-bm-highlight";
            mark.textContent = nodeText.slice(sliceStart, sliceEnd);
            mark.dataset.note = bm.message ?? "";
            mark.style.cssText = `background:${color}44;border-bottom:2px solid ${color};border-radius:2px;cursor:pointer;padding:1px 0;`;
            const after = document.createTextNode(nodeText.slice(sliceEnd));
            parent.insertBefore(before, entry.node);
            parent.insertBefore(mark, entry.node);
            if (nodeText.slice(sliceEnd)) parent.insertBefore(after, entry.node);
            parent.removeChild(entry.node);
          }
          // Only highlight first occurrence per bookmark
          break;
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [bookmarks, filePath, html]);

  const openSearch = useCallback(() => {
    searchVisibleRef.current = true;
    setSearchVisible(true);
    search.open();
  }, [search]);

  const closeSearch = useCallback(() => {
    searchVisibleRef.current = false;
    setSearchVisible(false);
    search.close();
  }, [search]);

  useVimMotions({ containerRef, onSearch: openSearch, onEscape: closeSearch, searchVisibleRef, enabled: true });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") { e.preventDefault(); openSearch(); }
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (!inInput && !e.metaKey && !e.ctrlKey && e.key === "m") {
        e.preventDefault();
        setShowBookmarkAdd(true);
      }
      if (!inInput && !e.metaKey && !e.ctrlKey && e.key === "b") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("folio:open-bookmarks"));
      }
      // [ / ] — navigate between bookmark highlights locally
      if (!inInput && !e.metaKey && !e.ctrlKey && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        const marks = Array.from(document.querySelectorAll<HTMLElement>(".md-bm-highlight"));
        if (marks.length === 0) return;
        const delta = e.key === "]" ? 1 : -1;
        // Find which mark is currently nearest to viewport center
        const viewMid = window.innerHeight / 2;
        let closest = 0;
        let minDist = Infinity;
        marks.forEach((m, i) => {
          const r = m.getBoundingClientRect();
          const dist = Math.abs(r.top + r.height / 2 - viewMid);
          if (dist < minDist) { minDist = dist; closest = i; }
        });
        const next = (closest + delta + marks.length) % marks.length;
        marks[next].scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash
        marks[next].style.outline = "2px solid " + (marks[next].style.borderBottomColor || "#f6c90e");
        setTimeout(() => { marks[next].style.outline = ""; }, 800);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openSearch]);

  // Post-process: images + click delegation
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    el.querySelectorAll<HTMLImageElement>("img[data-relative]").forEach((img) => {
      const src = img.getAttribute("data-src");
      if (!src) return;
      resolvePath(filePath, src).then((r) => {
        img.src = convertFileSrc(r);
        img.onerror = () => { img.style.opacity = "0.4"; img.alt = `[Not found: ${src}]`; };
      }).catch(() => { img.style.opacity = "0.4"; });
    });

    const onClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("copy-btn")) {
        e.preventDefault(); e.stopPropagation();
        const raw = decodeURIComponent(target.getAttribute("data-code") ?? "");
        try { await navigator.clipboard.writeText(raw); }
        catch { const ta = document.createElement("textarea"); ta.value = raw; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
        target.textContent = "Copied!"; target.classList.add("copied");
        setTimeout(() => { target.textContent = "Copy"; target.classList.remove("copied"); }, 1500);
        return;
      }
      const link = target.closest("a");
      if (!link) return;
      if (link.classList.contains("external")) {
        e.preventDefault(); e.stopPropagation();
        const href = link.getAttribute("data-href") ?? "";
        if (href) await open(href);
        return;
      }
      if (link.classList.contains("anchor")) {
        e.preventDefault();
        const id = (link.getAttribute("href") ?? "").replace("#", "");
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (link.classList.contains("internal")) {
        e.preventDefault();
        const href = link.getAttribute("data-file-href") ?? "";
        const base = link.getAttribute("data-base-path") ?? filePath;
        try {
          const resolved = await resolvePath(base, href);
          if (isMarkdownFile(resolved)) {
            const fc = await readFileContent(resolved);
            addTab({ type: "md", filePath: resolved, fileName: getFileName(resolved), content: fc });
          } else { await open(`file://${resolved}`); }
        } catch {}
        return;
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [html, filePath, addTab]);

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el && containerRef.current) containerRef.current.scrollTo({ top: el.offsetTop - 80, behavior: "smooth" });
  }, []);

  useEffect(() => {
    (window as any).__scrollToHeading = scrollToHeading;
    return () => { delete (window as any).__scrollToHeading; };
  }, [scrollToHeading]);

  // Drag and drop
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      for (const f of Array.from(e.dataTransfer?.files ?? [])) {
        const fp = (f as any).path as string | undefined;
        if (fp && isMarkdownFile(fp)) { try { addTab({ type: "md", filePath: fp, fileName: getFileName(fp), content: await readFileContent(fp) }); } catch {} }
      }
    };
    el.addEventListener("dragover", onDragOver); el.addEventListener("drop", onDrop);
    return () => { el.removeEventListener("dragover", onDragOver); el.removeEventListener("drop", onDrop); };
  }, [addTab]);

  const activeTab = getActiveTab();

  return (
    <div className={`viewer-wrapper${settings.autoFitMd ? " viewer-autofit" : ""}`}>
      {searchVisible && (
        <SearchBar query={search.query} matchCount={search.matchCount} currentMatch={search.currentMatch}
          onSearch={search.search} onNext={search.next} onPrev={search.prev} onClose={closeSearch} />
      )}
      <div className="md-toolbar">
        <button
          className={`md-tool-btn ${settings.autoFitMd ? "active" : ""}`}
          onClick={() => useAppStore.getState().updateSettings({ autoFitMd: !settings.autoFitMd })}
          title="Auto-fit content width (a)"
        >⟷ Auto-fit</button>
      </div>
      <div className="viewer-scroll" ref={containerRef}>
        <div className={`viewer-content${settings.autoFitMd ? " viewer-content--autofit" : ""}`} ref={contentRef}>
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
      {showBookmarkAdd && activeTab && (
        <BookmarkModal
          tab={activeTab}
          headingText={currentHeading?.text}
          selectedText={pendingSelection?.text}
          textContext={pendingSelection?.context}
          onSave={(msg, color, scope) => {
            addBookmark({
              filePath,
              fileName: activeTab.fileName,
              fileType: "md",
              scope: scope ?? "local",
              headingId: currentHeading?.id,
              headingText: currentHeading?.text,
              lineNumber: currentLine,
              message: msg,
              highlightColor: color,
              selectedText: pendingSelection?.text,
              textContext: pendingSelection?.context,
              preview: pendingSelection?.text
                ? `"${pendingSelection.text.slice(0, 60)}"`
                : currentHeading?.text ?? `Line ${currentLine}`,
            });
            latchedSelRef.current = null;
            setPendingSelection(null);
            setShowBookmarkAdd(false);
          }}
          onClose={() => setShowBookmarkAdd(false)}
        />
      )}
    </div>
  );
}
