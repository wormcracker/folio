import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocumentProxy } from "pdfjs-dist";

interface Props {
  doc: PDFDocumentProxy | null;
  currentPage: number;
  onPageClick: (n: number) => void;
}

export function PdfThumbnails({ doc, currentPage, onPageClick }: Props) {
  const [rendered, setRendered] = useState<Set<number>>(new Set());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doc) return;
    observerRef.current?.disconnect();
    setRendered(new Set());

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const pageNum = parseInt((entry.target as HTMLElement).dataset.thumb ?? "0");
          if (!pageNum) return;
          setRendered((prev) => {
            if (prev.has(pageNum)) return prev;
            renderThumb(doc, pageNum);
            return new Set([...prev, pageNum]);
          });
        });
      },
      { root: listRef.current, rootMargin: "150px", threshold: 0.01 }
    );

    observerRef.current = observer;
    listRef.current?.querySelectorAll("[data-thumb]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [doc]);

  // b: scroll the active thumbnail into view when page changes from main viewer
  useEffect(() => {
    const el = itemRefs.current.get(currentPage);
    if (el && listRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentPage]);

  // b: also listen for the custom event fired by PdfViewer on scroll
  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent).detail?.page as number;
      if (!page) return;
      const el = itemRefs.current.get(page);
      if (el && listRef.current) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    window.addEventListener("pdf-page-change", handler);
    return () => window.removeEventListener("pdf-page-change", handler);
  }, []);

  const renderThumb = async (pdfDoc: PDFDocumentProxy, pageNum: number) => {
    const canvas = canvasRefs.current.get(pageNum);
    if (!canvas) return;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.3 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {}
  };

  if (!doc) return <div className="thumb-empty">No PDF loaded</div>;

  return (
    <div className="thumb-list" ref={listRef}>
      {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((pageNum) => (
        <div
          key={pageNum}
          data-thumb={pageNum}
          ref={(el) => { if (el) itemRefs.current.set(pageNum, el); else itemRefs.current.delete(pageNum); }}
          className={`thumb-item ${pageNum === currentPage ? "active" : ""}`}
          onClick={() => onPageClick(pageNum)}
        >
          <div className="thumb-canvas-wrap">
            <canvas
              ref={(el) => { if (el) canvasRefs.current.set(pageNum, el); else canvasRefs.current.delete(pageNum); }}
            />
          </div>
          <span className="thumb-label">{pageNum}</span>
        </div>
      ))}
    </div>
  );
}
