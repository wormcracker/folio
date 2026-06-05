/**
 * PdfViewer — powered by pdfjs-dist
 *
 * Architecture:
 * - Chunked loading: only renders pages near the viewport, evicts far pages
 * - Render queue: priority queue renders current page first, then neighbours
 * - Text selection → bookmark: latched on pointerup, not cleared by modal open
 * - Search: wraps only the exact matched chars in <mark>, not the whole span
 * - h/l keys: horizontal scroll on the pdf-scroll container
 * - "b" key: opens bookmark list modal (add/local/global)
 * - "m" key or ⊕ button: opens add-bookmark modal with current selection
 */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useAppStore, PdfTab, Bookmark } from "../stores/appStore";
import { readFileBinary } from "../utils/fileSystem";
import { PdfJumpModal } from "./PdfJumpModal";
import { BookmarkModal } from "./BookmarkModal";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

// ─── Types ────────────────────────────────────────────────────────────────────
interface TocItem {
  title: string;
  page: number;
  level: number;
}

export interface PdfViewerHandle {
  getDoc: () => PDFDocumentProxy | null;
  getToc: () => TocItem[];
  getCurrentPage: () => number;
  goToPage: (n: number) => void;
}

declare global {
  interface Window {
    __pdfHandle?: PdfViewerHandle;
  }
}

type FitMode = "off" | "width" | "page";

interface LatchedSelection {
  text: string;
  page: number;
  context: string;
}

interface PageState {
  rendered: boolean;
  width: number;
  height: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const RENDER_MARGIN_PX = 800; // px above/below viewport to keep rendered
const EVICT_MARGIN_PX = 2400; // px beyond which we free the canvas
const MAX_CONCURRENT = 3; // max simultaneous page renders
const PLACEHOLDER_W = 620; // initial placeholder width

// ─── Component ────────────────────────────────────────────────────────────────
export function PdfViewer({ tab }: { tab: PdfTab }) {
  const {
    updatePdfPage,
    updatePdfZoom,
    updatePdfLayout,
    updatePdfTotalPages,
    updatePdfPageRotation,
    addBookmark,
    bookmarks,
    settings,
    theme,
    updateRecentPosition,
  } = useAppStore();

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [darkInvert, setDarkInvert] = useState(settings.pdfDarkMode);
  const [fitMode, setFitMode] = useState<FitMode>(
    settings.autoFitPdf ? "width" : "off",
  );
  const [showJump, setShowJump] = useState(false);
  const [showBmAdd, setShowBmAdd] = useState(false);
  // ── Latched selection: captured on pointerup, held until modal closes ──────
  const [latchedSel, setLatchedSel] = useState<LatchedSelection | null>(null);
  const latchedSelRef = useRef<LatchedSelection | null>(null); // mirror for sync reads

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<
    Array<{
      page: number;
      spanIdx: number;
      matchStart: number;
      matchLen: number;
    }>
  >([]);
  const [searchPos, setSearchPos] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // DOM refs
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderTasks = useRef<Map<number, RenderTask>>(new Map());
  const activeRenders = useRef<Set<number>>(new Set()); // pages currently rendering
  const renderedPages = useRef<Set<number>>(new Set()); // pages with live canvas content
  const pageStateRef = useRef<Map<number, PageState>>(new Map());
  const renderQueue = useRef<number[]>([]);
  const queueRunning = useRef(false);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const fitModeRef = useRef<FitMode>(fitMode);
  const tabRef = useRef(tab);

  useEffect(() => {
    fitModeRef.current = fitMode;
  }, [fitMode]);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const shouldInvert = darkInvert && theme === "dark";

  // File bookmarks with selectedText (for highlights)
  const fileBookmarks = useMemo(
    () =>
      bookmarks.filter(
        (b) => b.filePath === tab.filePath && b.selectedText && b.page != null,
      ),
    [bookmarks, tab.filePath],
  );

  useEffect(() => {
    setDarkInvert(settings.pdfDarkMode);
  }, [settings.pdfDarkMode]);
  useEffect(() => {
    setFitMode(settings.autoFitPdf ? "width" : "off");
  }, [settings.autoFitPdf]);

  const cycleFitMode = () =>
    setFitMode((m) => (m === "off" ? "width" : m === "width" ? "page" : "off"));

  // ── Compute scale for a given page ────────────────────────────────────────
  const computeScale = useCallback(
    (
      vp0: { width: number; height: number },
      fm: FitMode,
      layout: string,
      zoom: number,
    ): number => {
      const cont = containerRef.current;
      let scale = zoom;
      if (fm !== "off" && cont) {
        const availW = cont.clientWidth - (layout === "double" ? 80 : 48);
        if (fm === "width") {
          scale = Math.max(0.2, Math.min(availW / vp0.width, 6));
        } else {
          const availH = cont.clientHeight - 32;
          scale = Math.max(
            0.2,
            Math.min(Math.min(availW / vp0.width, availH / vp0.height), 6),
          );
        }
      }
      if (layout === "double") scale *= 0.5;
      return scale;
    },
    [],
  );

  // ── Core render function ─────────────────────────────────────────────────
  const renderPage = useCallback(
    async (pageNum: number) => {
      const pdfDoc = docRef.current;
      if (!pdfDoc) return;
      if (activeRenders.current.has(pageNum)) return;

      const canvas = canvasRefs.current.get(pageNum);
      const textDiv = textLayerRefs.current.get(pageNum);
      const wrapper = wrapperRefs.current.get(pageNum);
      if (!canvas || !textDiv || !wrapper) return;

      activeRenders.current.add(pageNum);

      // Cancel any existing render for this page
      const existing = renderTasks.current.get(pageNum);
      if (existing) {
        try {
          existing.cancel();
        } catch {}
        renderTasks.current.delete(pageNum);
      }

      try {
        const page: PDFPageProxy = await pdfDoc.getPage(pageNum);
        const t = tabRef.current;
        const extraRot = t.pageRotations?.[pageNum] ?? 0;
        const vp0 = page.getViewport({ scale: 1, rotation: extraRot });
        const scale = computeScale(vp0, fitModeRef.current, t.layout, t.zoom);

        const dpr = window.devicePixelRatio || 1;
        const vpLogical = page.getViewport({ scale, rotation: extraRot });
        const vpDevice = page.getViewport({
          scale: scale * dpr,
          rotation: extraRot,
        });

        canvas.width = vpDevice.width;
        canvas.height = vpDevice.height;
        canvas.style.width = `${vpLogical.width}px`;
        canvas.style.height = `${vpLogical.height}px`;

        wrapper.style.width = `${vpLogical.width}px`;
        wrapper.style.height = `${vpLogical.height}px`;

        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
          canvasContext: ctx,
          viewport: vpDevice,
        });
        renderTasks.current.set(pageNum, renderTask);
        await renderTask.promise;
        renderTasks.current.delete(pageNum);

        // Text layer
        textDiv.innerHTML = "";
        textDiv.style.width = `${vpLogical.width}px`;
        textDiv.style.height = `${vpLogical.height}px`;
        textDiv.style.setProperty("--scale-factor", String(scale));

        const textContent = await page.getTextContent();
        const textRenderTask = pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport: vpLogical,
          textDivs: [],
        });
        if (textRenderTask) await textRenderTask.promise;

        renderedPages.current.add(pageNum);
        pageStateRef.current.set(pageNum, {
          rendered: true,
          width: vpLogical.width,
          height: vpLogical.height,
        });

        paintHighlights(pageNum, wrapper, textDiv);
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.warn(`[PdfViewer] page ${pageNum}:`, err?.message ?? err);
        }
      } finally {
        activeRenders.current.delete(pageNum);
      }
    },
    [computeScale],
  ); // eslint-disable-line

  // ── Evict a page to free memory ───────────────────────────────────────────
  const evictPage = useCallback((pageNum: number) => {
    const canvas = canvasRefs.current.get(pageNum);
    const textDiv = textLayerRefs.current.get(pageNum);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (textDiv) {
      textDiv.innerHTML = "";
    }
    const wrapper = wrapperRefs.current.get(pageNum);
    if (wrapper)
      wrapper.querySelectorAll(".pdf-bm-hl").forEach((el) => el.remove());
    renderedPages.current.delete(pageNum);
    const ps = pageStateRef.current.get(pageNum);
    if (ps) pageStateRef.current.set(pageNum, { ...ps, rendered: false });
  }, []);

  // ── Render queue processor ────────────────────────────────────────────────
  const drainQueue = useCallback(async () => {
    if (queueRunning.current) return;
    queueRunning.current = true;
    while (renderQueue.current.length > 0) {
      if (activeRenders.current.size >= MAX_CONCURRENT) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      const next = renderQueue.current.shift();
      if (next == null) break;
      if (activeRenders.current.has(next)) continue;
      renderPage(next); // fire and forget — do NOT await, let it run concurrently
    }
    queueRunning.current = false;
  }, [renderPage]);

  const enqueue = useCallback(
    (pages: number[]) => {
      // Deduplicate: remove pages already queued or rendering
      const existing = new Set(renderQueue.current);
      for (const p of pages) {
        if (!existing.has(p) && !activeRenders.current.has(p)) {
          renderQueue.current.push(p);
          existing.add(p);
        }
      }
      drainQueue();
    },
    [drainQueue],
  );

  // ── Scroll-driven visibility check ───────────────────────────────────────
  const checkVisibility = useCallback(() => {
    const cont = containerRef.current;
    if (!cont || !docRef.current) return;
    const contRect = cont.getBoundingClientRect();
    const viewTop = cont.scrollTop - RENDER_MARGIN_PX;
    const viewBot = cont.scrollTop + cont.clientHeight + RENDER_MARGIN_PX;
    const evictTop = cont.scrollTop - EVICT_MARGIN_PX;
    const evictBot = cont.scrollTop + cont.clientHeight + EVICT_MARGIN_PX;

    const toRender: number[] = [];

    wrapperRefs.current.forEach((wrapper, pageNum) => {
      const offsetTop = wrapper.offsetTop;
      const offsetBot = offsetTop + wrapper.offsetHeight;
      const inRender = offsetBot > viewTop && offsetTop < viewBot;
      const inEvict = offsetBot > evictTop && offsetTop < evictBot;

      if (
        inRender &&
        !renderedPages.current.has(pageNum) &&
        !activeRenders.current.has(pageNum)
      ) {
        toRender.push(pageNum);
      }
      if (
        !inEvict &&
        renderedPages.current.has(pageNum) &&
        !activeRenders.current.has(pageNum)
      ) {
        evictPage(pageNum);
      }
    });

    // Sort by distance from current page (current page first)
    const currentPage = tabRef.current.page;
    toRender.sort(
      (a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage),
    );
    if (toRender.length > 0) enqueue(toRender);
  }, [enqueue, evictPage]);

  // ── Load PDF ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    docRef.current = null;
    pageStateRef.current.clear();
    renderedPages.current.clear();
    activeRenders.current.clear();
    renderQueue.current = [];
    queueRunning.current = false;

    (async () => {
      try {
        const data = await readFileBinary(tab.filePath);
        const task = pdfjsLib.getDocument({
          data: data.buffer.slice(0) as ArrayBuffer,
          disableAutoFetch: true,
          disableStream: true,
          isEvalSupported: false,
          useSystemFonts: true,
        });
        const pdfDoc = await task.promise;
        if (cancelled) {
          pdfDoc.destroy();
          return;
        }
        docRef.current = pdfDoc;

        updatePdfTotalPages(tab.id, pdfDoc.numPages);

        // Placeholder sizes from page 1 only — no blocking loop
        const p1 = await pdfDoc.getPage(1);
        const vp1 = p1.getViewport({ scale: 1 });
        const ratio = vp1.height / vp1.width;
        const placeholderH = Math.round(PLACEHOLDER_W * ratio);
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          pageStateRef.current.set(i, {
            rendered: false,
            width: PLACEHOLDER_W,
            height: placeholderH,
          });
        }

        try {
          const outline = await pdfDoc.getOutline();
          const items = await flattenOutline(pdfDoc, outline ?? [], 0);
          if (!cancelled) setToc(items);
        } catch {
          if (!cancelled) setToc([]);
        }

        if (!cancelled) {
          setDoc(pdfDoc);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Failed to load PDF");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTasks.current.forEach((t) => {
        try {
          t.cancel();
        } catch {}
      });
      renderTasks.current.clear();
      activeRenders.current.clear();
      renderQueue.current = [];
    };
  }, [tab.filePath]); // eslint-disable-line

  // ── After doc loads: render starting page + neighbours ───────────────────
  useEffect(() => {
    if (!doc || loading) return;
    // Small delay so DOM has mounted the placeholder wrappers
    const t = setTimeout(() => {
      const startPage = tabRef.current.page;
      const pages: number[] = [];
      for (let i = startPage; i <= Math.min(startPage + 4, doc.numPages); i++)
        pages.push(i);
      for (let i = startPage - 1; i >= Math.max(1, startPage - 2); i--)
        pages.push(i);
      enqueue(pages);
    }, 30);
    return () => clearTimeout(t);
  }, [doc, loading]); // eslint-disable-line

  // ── Scroll listener: drives visibility + page tracking ───────────────────
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont || !doc) return;

    let rafId = 0;
    const h = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // Page tracking
        const contRect = cont.getBoundingClientRect();
        for (const [, wrapper] of wrapperRefs.current) {
          const r = wrapper.getBoundingClientRect();
          if (r.top >= contRect.top - 10) {
            const p = parseInt(wrapper.dataset.page ?? "1");
            if (p !== tabRef.current.page) {
              updatePdfPage(tab.id, p);
              updateRecentPosition(tab.filePath, { page: p });
              window.dispatchEvent(
                new CustomEvent("pdf-page-change", { detail: { page: p } }),
              );
            }
            break;
          }
        }
        // Render/evict
        checkVisibility();
      });
    };

    cont.addEventListener("scroll", h, { passive: true });
    return () => {
      cont.removeEventListener("scroll", h);
      cancelAnimationFrame(rafId);
    };
  }, [
    doc,
    tab.id,
    tab.filePath,
    updatePdfPage,
    updateRecentPosition,
    checkVisibility,
  ]);

  // ── ResizeObserver: re-render visible pages on container resize ───────────
  useEffect(() => {
    roRef.current?.disconnect();
    if (!doc) return;
    const ro = new ResizeObserver(() => {
      if (!docRef.current) return;
      // Mark all rendered pages as needing re-render
      renderedPages.current.forEach((p) => {
        const task = renderTasks.current.get(p);
        if (task) {
          try {
            task.cancel();
          } catch {}
        }
        activeRenders.current.delete(p);
        renderedPages.current.delete(p);
      });
      renderQueue.current = [];
      checkVisibility();
    });
    if (containerRef.current) ro.observe(containerRef.current);
    roRef.current = ro;
    return () => ro.disconnect();
  }, [doc, checkVisibility]);

  // ── Re-render on zoom / layout / fitMode / rotation change ───────────────
  useEffect(() => {
    if (!doc) return;
    renderedPages.current.forEach((p) => {
      const task = renderTasks.current.get(p);
      if (task) {
        try {
          task.cancel();
        } catch {}
      }
      activeRenders.current.delete(p);
      renderedPages.current.delete(p);
    });
    renderQueue.current = [];
    checkVisibility();
  }, [tab.zoom, tab.layout, fitMode, tab.pageRotations]); // eslint-disable-line

  // ── Expose handle ────────────────────────────────────────────────────────
  const goToPage = useCallback(
    (n: number) => {
      const d = docRef.current;
      if (!d) return;
      const p = Math.max(1, Math.min(n, d.numPages));
      updatePdfPage(tab.id, p);
      const el = containerRef.current?.querySelector(
        `[data-page="${p}"]`,
      ) as HTMLElement | null;
      const scrollCont = containerRef.current;
      if (el && scrollCont) {
        scrollCont.scrollTop = el.offsetTop;
      }
    },
    [tab.id, updatePdfPage],
  );

  useEffect(() => {
    window.__pdfHandle = {
      getDoc: () => docRef.current,
      getToc: () => toc,
      getCurrentPage: () => tabRef.current.page,
      goToPage,
    };
    return () => {
      delete window.__pdfHandle;
    };
  }, [toc, goToPage]);

  // ── Restore page on tab switch ────────────────────────────────────────────
  useEffect(() => {
    if (!doc || loading) return;
    setTimeout(() => {
      const el = wrapperRefs.current.get(tab.page);
      el?.scrollIntoView({ behavior: "auto", block: "start" });
    }, 60);
  }, [doc, loading]); // eslint-disable-line

  // ── Highlight bookmarked text ────────────────────────────────────────────
  const paintHighlights = useCallback(
    (pageNum: number, wrapper: HTMLDivElement, textDiv: HTMLDivElement) => {
      wrapper.querySelectorAll(".pdf-bm-hl").forEach((el) => el.remove());
      const pageBms = fileBookmarks.filter((b) => b.page === pageNum);
      if (pageBms.length === 0) return;

      // pdfjs positions spans with CSS left/top + transform:scaleX(n).
      // We must read the CSS left/top directly (not offsetLeft, which is unreliable
      // with CSS transforms) and use getBoundingClientRect for width/height.
      const spans = Array.from(
        textDiv.querySelectorAll(
          "span[role=presentation], span:not(.pdf-search-mark)",
        ),
      ) as HTMLElement[];
      if (spans.length === 0) {
        // fallback: all spans
        const allSpans = Array.from(
          textDiv.querySelectorAll("span"),
        ) as HTMLElement[];
        if (allSpans.length === 0) return;
      }
      const allSpans = Array.from(
        textDiv.querySelectorAll("span"),
      ) as HTMLElement[];
      if (allSpans.length === 0) return;

      // Build flat text + per-span position info using getBoundingClientRect
      // relative to the textDiv (which is positioned at inset:0 of wrapper).
      const textDivRect = textDiv.getBoundingClientRect();

      let flatText = "";
      const spanMeta: {
        start: number;
        end: number;
        el: HTMLElement;
        x: number;
        y: number;
        w: number;
        h: number;
      }[] = [];

      for (const span of allSpans) {
        const t = span.textContent ?? "";
        if (!t) continue;
        const r = span.getBoundingClientRect();
        spanMeta.push({
          start: flatText.length,
          end: flatText.length + t.length,
          el: span,
          x: r.left - textDivRect.left,
          y: r.top - textDivRect.top,
          w: r.width,
          h: r.height || 14,
        });
        flatText += t;
      }

      // ── Normalise helper: collapse all whitespace runs to single space ──────
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();

      // Build a normalised flat string that maps back to original char positions.
      // normMap[i] = index in flatText of the i-th char of normFlat
      let normFlat = "";
      const normMap: number[] = []; // normFlat index → flatText index
      let i = 0;
      while (i < flatText.length) {
        const ch = flatText[i];
        if (/\s/.test(ch)) {
          // Collapse any run of whitespace to one space
          normFlat += " ";
          normMap.push(i);
          while (i < flatText.length && /\s/.test(flatText[i])) i++;
        } else {
          normFlat += ch;
          normMap.push(i);
          i++;
        }
      }

      for (const bm of pageBms) {
        if (!bm.selectedText) continue;
        const color = bm.highlightColor ?? "#f6c90e";
        const normSel = norm(bm.selectedText);
        const normIdx = normFlat.indexOf(normSel);
        if (normIdx === -1) continue;
        const normEnd = normIdx + normSel.length;

        // Map normalised range back to flatText range
        const flatStart = normMap[normIdx];
        const flatEnd = normMap[Math.min(normEnd, normMap.length - 1)] + 1;

        const hitSpans = spanMeta.filter(
          (s) => s.end > flatStart && s.start < flatEnd,
        );
        for (const hit of hitSpans) {
          const hl = document.createElement("div");
          hl.className = "pdf-bm-hl";
          hl.dataset.note = bm.message || "";
          // For partial span hits (first/last span), shrink the highlight width proportionally
          let x = hit.x,
            w = hit.w;
          if (hit.start < flatStart) {
            // First span: trim from the left
            const charW = hit.w / (hit.end - hit.start);
            const skipChars = flatStart - hit.start;
            x += charW * skipChars;
            w -= charW * skipChars;
          }
          if (hit.end > flatEnd) {
            // Last span: trim from the right
            const charW = hit.w / (hit.end - hit.start);
            const extraChars = hit.end - flatEnd;
            w -= charW * extraChars;
          }
          hl.style.cssText = `
          left:${x}px;
          top:${hit.y}px;
          width:${Math.max(4, w)}px;
          height:${hit.h + 2}px;
          background:${color}44;
          border-bottom:2px solid ${color};
        `;
          wrapper.appendChild(hl);
        }
      }
    },
    [fileBookmarks],
  );

  useEffect(() => {
    if (!doc) return;
    wrapperRefs.current.forEach((wrapper, pageNum) => {
      const textDiv = textLayerRefs.current.get(pageNum);
      if (textDiv && renderedPages.current.has(pageNum)) {
        paintHighlights(pageNum, wrapper, textDiv);
      }
    });
  }, [fileBookmarks, doc, paintHighlights]);

  // ── Text selection: latched on pointerup, NOT on selectionchange ──────────
  // selectionchange fires when a modal opens/closes and clears the selection.
  // We latch on pointerup so the selection is captured before any click handler
  // dismisses or replaces it. We only clear the latch after the user explicitly
  // saves or closes the bookmark modal.
  useEffect(() => {
    const onPointerUp = () => {
      // Give the browser a tick to finalise the selection
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const text = sel.toString().trim();
        if (!text) return;
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node instanceof Element ? node : node.parentElement;
        const pageEl = el?.closest("[data-page]") as HTMLElement | null;
        if (!pageEl) return;
        const page = parseInt(pageEl.dataset.page ?? "0");
        if (!page) return;
        const context = Array.from(
          pageEl.querySelectorAll(".pdf-text-layer span"),
        )
          .map((s) => s.textContent ?? "")
          .join("")
          .slice(0, 300);
        const latched: LatchedSelection = { text, page, context };
        latchedSelRef.current = latched;
        setLatchedSel(latched);
      });
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, []);

  // ── Bookmark navigation: ] next [ prev ─────────────────────────────────────
  const [bmNavIdx, setBmNavIdx] = useState(0);

  const navigateBookmark = useCallback(
    (delta: 1 | -1) => {
      if (fileBookmarks.length === 0) return;
      const next =
        (bmNavIdx + delta + fileBookmarks.length) % fileBookmarks.length;
      setBmNavIdx(next);
      const bm = fileBookmarks[next];
      if (!bm) return;
      if (bm.page) goToPage(bm.page);
      // Flash the highlight overlay for this bookmark
      setTimeout(() => {
        const wrapper = wrapperRefs.current.get(bm.page ?? 0);
        if (!wrapper) return;
        const hls = wrapper.querySelectorAll<HTMLElement>(".pdf-bm-hl");
        for (const hl of hls) {
          if (hl.dataset.note === (bm.message ?? "") || hls.length === 1) {
            hl.style.outline = "2px solid " + (bm.highlightColor ?? "#f6c90e");
            setTimeout(() => {
              hl.style.outline = "";
            }, 900);
            break;
          }
        }
      }, 350);
    },
    [fileBookmarks, bmNavIdx, goToPage],
  );

  // ── Bookmark hover tooltip ───────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{
    note: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const hl = target.closest(".pdf-bm-hl") as HTMLElement | null;
      if (hl && hl.dataset.note) {
        setTooltip({ note: hl.dataset.note, x: e.clientX, y: e.clientY });
      } else {
        setTooltip(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback(
    async (q: string) => {
      const d = docRef.current;
      if (!d || !q.trim()) {
        setSearchHits([]);
        return;
      }

      // Clear previous marks
      document.querySelectorAll(".pdf-search-mark").forEach((el) => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(
            document.createTextNode(el.textContent ?? ""),
            el,
          );
          parent.normalize();
        }
      });

      const hits: Array<{
        page: number;
        spanIdx: number;
        matchStart: number;
        matchLen: number;
      }> = [];
      const lq = q.toLowerCase();

      for (let pn = 1; pn <= d.numPages; pn++) {
        const textDiv = textLayerRefs.current.get(pn);
        if (!textDiv) continue;
        const spans = Array.from(
          textDiv.querySelectorAll("span"),
        ) as HTMLElement[];
        let flat = "";
        const spanMap: { start: number; end: number; idx: number }[] = [];
        for (let i = 0; i < spans.length; i++) {
          const t = spans[i].textContent ?? "";
          spanMap.push({
            start: flat.length,
            end: flat.length + t.length,
            idx: i,
          });
          flat += t;
        }
        const lf = flat.toLowerCase();
        let pos = lf.indexOf(lq);
        while (pos !== -1) {
          const matchEnd = pos + lq.length;
          const overlapping = spanMap.filter(
            (s) => s.end > pos && s.start < matchEnd,
          );
          for (const hit of overlapping) {
            hits.push({
              page: pn,
              spanIdx: hit.idx,
              matchStart: pos - hit.start,
              matchLen: lq.length,
            });
          }
          pos = lf.indexOf(lq, pos + 1);
        }
      }

      setSearchHits(hits);
      setSearchPos(0);
      if (hits.length > 0) {
        applySearchHighlight(hits, 0);
        goToPage(hits[0].page);
      }
    },
    [goToPage],
  );

  const applySearchHighlight = (hits: typeof searchHits, pos: number) => {
    // Restore all spans first (remove old marks)
    document.querySelectorAll(".pdf-search-mark").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
        parent.normalize();
      }
    });

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const textDiv = textLayerRefs.current.get(hit.page);
      if (!textDiv) continue;
      const spans = Array.from(
        textDiv.querySelectorAll("span"),
      ) as HTMLElement[];
      const span = spans[hit.spanIdx];
      if (!span) continue;

      // Find the raw text node (skip existing marks)
      const text = span.textContent ?? "";
      const start = Math.max(0, hit.matchStart);
      const end = Math.min(text.length, start + hit.matchLen);
      if (start >= end) continue;

      // Clear and rebuild: before | mark | after
      span.textContent = "";
      if (start > 0)
        span.appendChild(document.createTextNode(text.slice(0, start)));
      const mark = document.createElement("mark");
      mark.className = "pdf-search-mark" + (i === pos ? " current" : "");
      mark.textContent = text.slice(start, end);
      span.appendChild(mark);
      if (end < text.length)
        span.appendChild(document.createTextNode(text.slice(end)));
    }
  };

  const moveSearch = useCallback(
    (delta: 1 | -1) => {
      if (searchHits.length === 0) return;
      const next = (searchPos + delta + searchHits.length) % searchHits.length;
      setSearchPos(next);
      applySearchHighlight(searchHits, next);
      goToPage(searchHits[next].page);
    },
    [searchHits, searchPos, goToPage],
  ); // eslint-disable-line

  const clearSearch = () => {
    document.querySelectorAll(".pdf-search-mark").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
        parent.normalize();
      }
    });
    setSearchHits([]);
  };

  // ── Keyboard handler ──────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch((v) => {
          if (!v) setTimeout(() => searchRef.current?.focus(), 30);
          return true;
        });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (showSearch && inInput) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSearch(false);
          setSearchQuery("");
          clearSearch();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          moveSearch(e.shiftKey ? -1 : 1);
        }
        return;
      }
      if (inInput) return;

      const d = docRef.current;
      const cont = containerRef.current;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          cont?.scrollBy({ top: 80, behavior: "smooth" });
          e.preventDefault();
          break;
        case "k":
        case "ArrowUp":
          cont?.scrollBy({ top: -80, behavior: "smooth" });
          e.preventDefault();
          break;
        // h/l — horizontal scroll for when page overflows the x-axis at high zoom
        case "h":
        case "ArrowLeft":
          cont?.scrollBy({ left: -80, behavior: "smooth" });
          e.preventDefault();
          break;
        case "l":
        case "ArrowRight":
          cont?.scrollBy({ left: 80, behavior: "smooth" });
          e.preventDefault();
          break;
        case "d":
          cont?.scrollBy({ top: window.innerHeight / 2, behavior: "smooth" });
          e.preventDefault();
          break;
        case "u":
          cont?.scrollBy({ top: -window.innerHeight / 2, behavior: "smooth" });
          e.preventDefault();
          break;
        case " ":
          cont?.scrollBy({ top: window.innerHeight, behavior: "smooth" });
          e.preventDefault();
          break;
        case "n":
          if (d) {
            goToPage(tabRef.current.page + 1);
            e.preventDefault();
          }
          break;
        case "N":
          if (d) {
            goToPage(tabRef.current.page - 1);
            e.preventDefault();
          }
          break;
        case "g":
          goToPage(1);
          e.preventDefault();
          break;
        case "G":
          if (d) {
            goToPage(d.numPages);
            e.preventDefault();
          }
          break;
        case "+":
        case "=":
          updatePdfZoom(tab.id, Math.min(tab.zoom + 0.2, 5));
          e.preventDefault();
          break;
        case "-":
          updatePdfZoom(tab.id, Math.max(tab.zoom - 0.2, 0.2));
          e.preventDefault();
          break;
        case "0":
          updatePdfZoom(tab.id, 1);
          e.preventDefault();
          break;
        case "a":
          cycleFitMode();
          e.preventDefault();
          break;
        case "p":
          setShowJump(true);
          e.preventDefault();
          break;
        case "/":
          setShowSearch((v) => {
            if (!v) setTimeout(() => searchRef.current?.focus(), 30);
            return true;
          });
          e.preventDefault();
          break;
        // "b" = open bookmark list (add / local / global) via global QuickModal
        case "b":
          window.dispatchEvent(new CustomEvent("folio:open-bookmarks"));
          e.preventDefault();
          break;
        // "m" = open add-bookmark modal with current selection
        case "m":
          setShowBmAdd(true);
          e.preventDefault();
          break;
        case "]":
          navigateBookmark(1);
          e.preventDefault();
          break;
        case "[":
          navigateBookmark(-1);
          e.preventDefault();
          break;
        case "i":
          setDarkInvert((v) => !v);
          e.preventDefault();
          break;
        case "Escape":
          setShowSearch(false);
          setShowJump(false);
          clearSearch();
          break;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doc, tab, goToPage, updatePdfZoom, showSearch, moveSearch]); // eslint-disable-line

  // ── Early returns ─────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="pdf-loading">
        <div className="pdf-spinner" />
        <span>Loading…</span>
      </div>
    );
  if (error)
    return (
      <div className="pdf-error">
        <span>⚠ {error}</span>
      </div>
    );
  if (!doc) return null;

  const pageNums = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const pageGroups =
    tab.layout === "double"
      ? pageNums.reduce<number[][]>((a, n, i) => {
          if (i % 2 === 0) a.push([n]);
          else a[a.length - 1].push(n);
          return a;
        }, [])
      : pageNums.map((n) => [n]);

  return (
    <div className="pdf-wrapper">
      {/* ── Toolbar ── */}
      <div className="pdf-toolbar">
        <button
          className="pdf-tool-btn"
          onClick={() => goToPage(tab.page - 1)}
          disabled={tab.page <= 1}
          title="Prev (N)"
        >
          ‹
        </button>
        <span className="pdf-page-info">
          <input
            className="pdf-page-input"
            type="number"
            value={tab.page}
            min={1}
            max={doc.numPages}
            onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
            onFocus={(e) => e.target.select()}
          />
          <span className="pdf-page-sep">/ {doc.numPages}</span>
        </span>
        <button
          className="pdf-tool-btn"
          onClick={() => goToPage(tab.page + 1)}
          disabled={tab.page >= doc.numPages}
          title="Next (n)"
        >
          ›
        </button>
        <div className="pdf-toolbar-sep" />
        <button
          className="pdf-tool-btn"
          onClick={() => updatePdfZoom(tab.id, Math.max(tab.zoom - 0.2, 0.2))}
          title="Zoom out (-)"
        >
          −
        </button>
        <span className="pdf-zoom-label">{Math.round(tab.zoom * 100)}%</span>
        <button
          className="pdf-tool-btn"
          onClick={() => updatePdfZoom(tab.id, Math.min(tab.zoom + 0.2, 5))}
          title="Zoom in (+)"
        >
          +
        </button>
        <button
          className="pdf-tool-btn"
          onClick={() => updatePdfZoom(tab.id, 1)}
          title="Reset (0)"
        >
          ⊡
        </button>
        <button
          className={`pdf-tool-btn ${fitMode !== "off" ? "active" : ""}`}
          onClick={cycleFitMode}
          title={`Auto-fit: ${fitMode} — click to cycle (a)`}
        >
          {fitMode === "width" ? "⟺" : fitMode === "page" ? "⊠" : "⟷"}
        </button>
        {fitMode !== "off" && <span className="pdf-fit-label">{fitMode}</span>}
        <div className="pdf-toolbar-sep" />
        <button
          className={`pdf-tool-btn ${tab.layout === "single" ? "active" : ""}`}
          onClick={() => updatePdfLayout(tab.id, "single")}
          title="Single page"
        >
          ▬
        </button>
        <button
          className={`pdf-tool-btn ${tab.layout === "double" ? "active" : ""}`}
          onClick={() => updatePdfLayout(tab.id, "double")}
          title="Double page"
        >
          ▬▬
        </button>
        <div className="pdf-toolbar-sep" />
        <button
          className="pdf-tool-btn"
          onClick={() => updatePdfPageRotation(tab.id, tab.page, 90)}
          title="Rotate CW"
        >
          ↻
        </button>
        <button
          className="pdf-tool-btn"
          onClick={() => updatePdfPageRotation(tab.id, tab.page, -90)}
          title="Rotate CCW"
        >
          ↺
        </button>
        <div className="pdf-toolbar-sep" />
        <button
          className={`pdf-tool-btn ${shouldInvert ? "active" : ""}`}
          onClick={() => setDarkInvert((v) => !v)}
          title="Dark invert (i)"
        >
          ◑
        </button>
        <div className="pdf-toolbar-sep" />
        <button
          className="pdf-tool-btn"
          onClick={() => {
            setShowSearch(true);
            setTimeout(() => searchRef.current?.focus(), 30);
          }}
          title="Search (/ or Ctrl+F)"
        >
          🔍
        </button>
        <button
          className="pdf-tool-btn"
          onClick={() => setShowJump(true)}
          title="Jump (p)"
        >
          ⌕
        </button>
        <button
          className="pdf-tool-btn"
          onClick={() => setShowBmAdd(true)}
          title="Bookmark selection (m)"
        >
          ⊕
        </button>
      </div>

      {/* ── Search bar ── */}
      {showSearch && (
        <div className="pdf-search-bar">
          <span className="pdf-search-icon">🔍</span>
          <input
            ref={searchRef}
            className="pdf-search-input"
            placeholder="Search in PDF…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              doSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowSearch(false);
                setSearchQuery("");
                clearSearch();
              }
              if (e.key === "Enter") moveSearch(e.shiftKey ? -1 : 1);
            }}
            autoFocus
          />
          {searchHits.length > 0 && (
            <span className="pdf-search-count">
              {searchPos + 1}/{searchHits.length}
            </span>
          )}
          {searchQuery && searchHits.length === 0 && (
            <span className="pdf-search-count pdf-search-none">No matches</span>
          )}
          <button className="pdf-search-nav" onClick={() => moveSearch(-1)}>
            ↑
          </button>
          <button className="pdf-search-nav" onClick={() => moveSearch(1)}>
            ↓
          </button>
          <button
            className="pdf-search-close"
            onClick={() => {
              setShowSearch(false);
              setSearchQuery("");
              clearSearch();
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Pages ── */}
      <div className="pdf-scroll" ref={containerRef}>
        {pageGroups.map((group, gi) => (
          <div key={gi} className={`pdf-page-group ${tab.layout}`}>
            {group.map((pageNum) => {
              const ps = pageStateRef.current.get(pageNum);
              const w = ps?.width ?? PLACEHOLDER_W;
              const h = ps?.height ?? Math.round(PLACEHOLDER_W * 1.414);
              return (
                <div
                  key={pageNum}
                  data-page={pageNum}
                  ref={(el) => {
                    if (el)
                      wrapperRefs.current.set(pageNum, el as HTMLDivElement);
                    else wrapperRefs.current.delete(pageNum);
                  }}
                  className="pdf-page-wrapper"
                  style={{
                    width: `${w}px`,
                    height: `${h}px`,
                    filter: shouldInvert
                      ? "invert(0.88) sepia(0.2) hue-rotate(180deg)"
                      : undefined,
                  }}
                >
                  <canvas
                    className="pdf-canvas"
                    ref={(el) => {
                      if (el) canvasRefs.current.set(pageNum, el);
                      else canvasRefs.current.delete(pageNum);
                    }}
                  />
                  <div
                    className="pdf-text-layer"
                    ref={(el) => {
                      if (el)
                        textLayerRefs.current.set(
                          pageNum,
                          el as HTMLDivElement,
                        );
                      else textLayerRefs.current.delete(pageNum);
                    }}
                  />
                  {settings.showPageNumbers && (
                    <div className="pdf-page-num">{pageNum}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Modals ── */}
      {/* ── Bookmark hover tooltip ── */}
      {tooltip && tooltip.note && (
        <div
          className="pdf-bm-tooltip"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 8,
            position: "fixed",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          {tooltip.note}
        </div>
      )}

      {showJump && (
        <PdfJumpModal
          doc={doc}
          toc={toc}
          bookmarks={bookmarks.filter((b) => b.filePath === tab.filePath)}
          currentPage={tab.page}
          totalPages={doc.numPages}
          onGoPage={(n) => {
            goToPage(n);
            setShowJump(false);
          }}
          onClose={() => setShowJump(false)}
        />
      )}
      {showBmAdd && (
        <BookmarkModal
          tab={tab}
          currentPage={latchedSel?.page ?? tab.page}
          selectedText={latchedSel?.text}
          textContext={latchedSel?.context}
          onSave={(msg, color, scope) => {
            addBookmark({
              filePath: tab.filePath,
              fileName: tab.fileName,
              fileType: "pdf",
              scope: scope ?? "local",
              page: latchedSel?.page ?? tab.page,
              selectedText: latchedSel?.text,
              textContext: latchedSel?.context,
              highlightColor: color,
              message: msg,
              preview: latchedSel?.text
                ? `"${latchedSel.text.slice(0, 60)}"`
                : `Page ${tab.page}`,
              pageHeading: toc
                .filter((t) => t.page <= (latchedSel?.page ?? tab.page))
                .slice(-1)[0]?.title,
            });
            // Clear latch after save
            latchedSelRef.current = null;
            setLatchedSel(null);
            setShowBmAdd(false);
          }}
          onClose={() => setShowBmAdd(false)}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function flattenOutline(
  doc: PDFDocumentProxy,
  items: any[],
  level: number,
): Promise<TocItem[]> {
  const result: TocItem[] = [];
  for (const item of items ?? []) {
    let page = 1;
    try {
      if (item.dest) {
        const dest =
          typeof item.dest === "string"
            ? await doc.getDestination(item.dest)
            : item.dest;
        if (dest) {
          const idx = await doc.getPageIndex(dest[0]);
          page = idx + 1;
        }
      }
    } catch {}
    result.push({ title: item.title ?? "(untitled)", page, level });
    if (item.items?.length)
      result.push(...(await flattenOutline(doc, item.items, level + 1)));
  }
  return result;
}
