/**
 * ExportModal — export PDF/MD/TXT with highlights embedded
 *
 * Strategy:
 * - PDF: clone each page canvas, paint highlight rects on top, add notes at bottom of page
 * - MD/TXT: render markdown to HTML, inject <mark> highlights, print/export via browser print
 * - Output: Tauri save dialog → user picks destination
 */
import React, { useState, useCallback, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useAppStore, Bookmark } from "../stores/appStore";
import { readFileBinary } from "../utils/fileSystem";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

interface Props {
  onClose: () => void;
}

type ExportStatus = "idle" | "loading" | "exporting" | "done" | "error";

export function ExportModal({ onClose }: Props) {
  const { getActiveTab, bookmarks, settings } = useAppStore();
  const activeTab = getActiveTab();
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [exportDir, setExportDir] = useState(settings.exportDir ?? "");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const fileBookmarks = activeTab
    ? bookmarks.filter(b => b.filePath === activeTab.filePath && b.selectedText)
    : [];

  const handleExport = useCallback(async () => {
    if (!activeTab) return;
    setStatus("loading");
    setProgress(0);
    setErrorMsg("");

    try {
      setStatus("exporting");

      if (activeTab.type === "pdf") {
        const defaultName = activeTab.fileName.replace(/\.[^.]+$/, "") + "-highlighted.pdf";
        const pdfBytes = await exportPdf(activeTab.filePath, fileBookmarks, includeNotes, (p, msg) => {
          setProgress(p);
          setProgressMsg(msg);
        });
        // Try Tauri save dialog first, fall back to browser download
        const saved = await trySaveFile(pdfBytes, defaultName, exportDir);
        if (!saved) { setStatus("idle"); return; }
      } else {
        // MD/TXT — open print dialog (browser handles save-as)
        await exportMdAsPdf(activeTab, fileBookmarks, includeNotes, (p, msg) => {
          setProgress(p);
          setProgressMsg(msg);
        });
      }

      setStatus("done");
    } catch (e: any) {
      console.error("[Export]", e);
      setErrorMsg(e?.message ?? String(e) ?? "Export failed");
      setStatus("error");
    }
  }, [activeTab, fileBookmarks, includeNotes, exportDir]);

  if (!activeTab) {
    return (
      <div className="export-overlay" onClick={onClose}>
        <div className="export-modal" onClick={e => e.stopPropagation()}>
          <div className="export-header">
            <span className="export-title">Export</span>
            <button className="export-close" onClick={onClose}>×</button>
          </div>
          <div className="export-empty">No file open to export.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <div className="export-header">
          <span className="export-title">Export with Highlights</span>
          <button className="export-close" onClick={onClose}>×</button>
        </div>

        <div className="export-body">
          <div className="export-file-info">
            <span className="export-file-icon">{activeTab.type === "pdf" ? "📕" : "📄"}</span>
            <div>
              <div className="export-file-name">{activeTab.fileName}</div>
              <div className="export-file-sub">
                {fileBookmarks.length} highlight{fileBookmarks.length !== 1 ? "s" : ""} will be embedded
              </div>
            </div>
          </div>

          {fileBookmarks.length === 0 && (
            <div className="export-warn">
              No text bookmarks found for this file. The export will be a clean copy.
            </div>
          )}

          {fileBookmarks.length > 0 && (
            <div className="export-bm-preview">
              {fileBookmarks.slice(0, 4).map(b => (
                <div key={b.id} className="export-bm-row" style={{ borderLeftColor: b.highlightColor ?? "#f6c90e" }}>
                  <span className="export-bm-text">"{b.selectedText?.slice(0, 50)}{(b.selectedText?.length ?? 0) > 50 ? "…" : ""}"</span>
                  {b.message && <span className="export-bm-msg"> — {b.message}</span>}
                </div>
              ))}
              {fileBookmarks.length > 4 && (
                <div className="export-bm-more">+{fileBookmarks.length - 4} more</div>
              )}
            </div>
          )}

          <div className="export-options">
            <label className="export-opt">
              <input type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} />
              <span>Include notes at end of document</span>
            </label>
            <div className="export-opt-desc">
              Annotated highlights with notes will have a superscript marker, with notes listed at the end.
            </div>
          </div>

          {status === "exporting" && (
            <div className="export-progress">
              <div className="export-progress-bar">
                <div className="export-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="export-progress-msg">{progressMsg}</span>
            </div>
          )}

          {status === "done" && (
            <div className="export-success">✓ Exported successfully!</div>
          )}

          {status === "error" && (
            <div className="export-error">⚠ {errorMsg}</div>
          )}
        </div>

        <div className="export-footer">
          <button className="export-cancel" onClick={onClose}>
            {status === "done" ? "Close" : "Cancel"}
          </button>
          {status !== "done" && (
            <button
              className="export-btn"
              onClick={handleExport}
              disabled={status === "loading" || status === "exporting"}
            >
              {status === "exporting" ? "Exporting…" : "Export PDF"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Save helper: Tauri dialog with browser-download fallback ───────────────
async function trySaveFile(bytes: Uint8Array, defaultName: string, exportDir: string): Promise<boolean> {
  // Try Tauri native save dialog
  try {
    const { save } = await import("@tauri-apps/api/dialog");
    const { writeBinaryFile } = await import("@tauri-apps/api/fs");
    const savePath = await save({
      defaultPath: (exportDir ? `${exportDir}/` : "") + defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!savePath) return false;
    await writeBinaryFile(savePath, bytes);
    return true;
  } catch {
    // Fallback: browser <a download> blob URL
    try {
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 2000);
      return true;
    } catch (e2) {
      throw new Error("Could not save file: " + String(e2));
    }
  }
}

// ─── PDF Export — returns raw bytes ──────────────────────────────────────────
async function exportPdf(
  filePath: string,
  bms: Bookmark[],
  includeNotes: boolean,
  onProgress: (p: number, msg: string) => void,
): Promise<Uint8Array> {
  onProgress(5, "Loading PDF…");
  const data = await readFileBinary(filePath);
  const pdfDoc: PDFDocumentProxy = await pdfjsLib.getDocument({
    data: data.buffer.slice(0) as ArrayBuffer,
  }).promise;

  const totalPages = pdfDoc.numPages;
  const SCALE = 2; // 2x for print quality
  const jpegParts: { w: number; h: number; jpeg: Uint8Array }[] = [];

  // Build notes index: page -> list of {text, note, color, noteIdx}
  const notesIndex = new Map<number, Array<{ text: string; note: string; color: string; noteIdx: number }>>();
  let noteCounter = 0;
  if (includeNotes) {
    for (const bm of bms) {
      if (!bm.message || !bm.page) continue;
      noteCounter++;
      const arr = notesIndex.get(bm.page) ?? [];
      arr.push({ text: bm.selectedText ?? "", note: bm.message, color: bm.highlightColor ?? "#f6c90e", noteIdx: noteCounter });
      notesIndex.set(bm.page, arr);
    }
  }

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress(5 + Math.round((pageNum / totalPages) * 75), `Rendering page ${pageNum}/${totalPages}…`);

    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: SCALE });

    const canvas = document.createElement("canvas");
    canvas.width  = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    // Get text positions to find where to draw highlights
    const textContent = await page.getTextContent();
    const logicalVp = page.getViewport({ scale: 1 });

    // Paint highlight rects
    const pageBms = bms.filter(b => b.page === pageNum && b.selectedText);
    if (pageBms.length > 0) {
      // Build flat text + item positions
      let flat = "";
      const items: { str: string; x: number; y: number; w: number; h: number }[] = [];
      for (const item of (textContent.items as any[])) {
        if (!item.str) continue;
        const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
        const x  = tx[4];
        const y  = canvas.height - tx[5];
        const itemW = (item.width ?? item.str.length * 8) * SCALE;
        const itemH = (item.height ?? 12) * SCALE;
        items.push({ str: item.str, x, y: y - itemH, w: itemW, h: itemH });
        flat += item.str;
      }

      let noteIdx = 0;
      for (const bm of pageBms) {
        if (!bm.selectedText) continue;
        const color  = bm.highlightColor ?? "#f6c90e";
        const sel    = bm.selectedText;
        const idx    = flat.indexOf(sel);
        if (idx === -1) continue;

        // Find which items overlap the selection
        let charCount = 0;
        for (const item of items) {
          const start = charCount;
          const end   = charCount + item.str.length;
          if (end > idx && start < idx + sel.length) {
            // Parse color
            const r = parseInt(color.slice(1,3), 16);
            const g = parseInt(color.slice(3,5), 16);
            const b2 = parseInt(color.slice(5,7), 16);
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = `rgb(${r},${g},${b2})`;
            ctx.fillRect(item.x, item.y, item.w, item.h);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = `rgb(${r},${g},${b2})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(item.x, item.y + item.h);
            ctx.lineTo(item.x + item.w, item.y + item.h);
            ctx.stroke();

            // Note superscript marker
            if (includeNotes && bm.message) {
              noteIdx++;
              ctx.fillStyle = `rgb(${r},${g},${b2})`;
              ctx.font = `bold ${10 * SCALE}px sans-serif`;
              ctx.fillText(`[${noteIdx}]`, item.x + item.w, item.y - 2);
            }
            ctx.restore();
          }
          charCount += item.str.length;
        }
      }
    }

    // Add notes section at bottom of last page that has notes, OR append an extra notes page
    if (includeNotes && pageNum === totalPages && notesIndex.size > 0) {
      const allNotes: { page: number; text: string; note: string; noteIdx: number }[] = [];
      notesIndex.forEach((arr, pg) => arr.forEach(n => allNotes.push({ page: pg, ...n })));
      allNotes.sort((a, b) => a.noteIdx - b.noteIdx);

      const MARGIN = 40;
      const lineH  = 26 * SCALE;
      let y = canvas.height - MARGIN - allNotes.length * lineH - 30;
      if (y < canvas.height * 0.6) y = canvas.height * 0.6; // at least below 60%

      ctx.save();
      ctx.fillStyle = "rgba(240,240,240,0.9)";
      ctx.fillRect(MARGIN, y - 10, canvas.width - MARGIN*2, canvas.height - y + MARGIN);
      ctx.fillStyle = "#333";
      ctx.font = `bold ${12 * SCALE}px sans-serif`;
      ctx.fillText("Notes", MARGIN, y + 10);
      y += lineH;
      ctx.font = `${10 * SCALE}px sans-serif`;
      for (const n of allNotes) {
        const label = `[${n.noteIdx}] p.${n.page} — "${n.text.slice(0, 40)}${n.text.length > 40 ? "…" : ""}": ${n.note}`;
        ctx.fillText(label, MARGIN, y);
        y += lineH;
        if (y > canvas.height - MARGIN) break;
      }
      ctx.restore();
    }

    // Encode to JPEG
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob(b => resolve(b!), "image/jpeg", 0.92));
    const arrayBuf = await blob.arrayBuffer();
    jpegParts.push({ w: Math.round(vp.width), h: Math.round(vp.height), jpeg: new Uint8Array(arrayBuf) });
  }

  onProgress(82, "Building PDF…");

  // Minimal PDF assembly from JPEG images
  const pdfBytes = buildJpegPdf(jpegParts);

  onProgress(97, "Assembling…");
  onProgress(100, "Done!");
  return pdfBytes;
}

// ─── Minimal PDF builder (JPEG images only) ───────────────────────────────────
function buildJpegPdf(pages: { w: number; h: number; jpeg: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;

  const push = (s: string) => { const b = enc.encode(s); parts.push(b); pos += b.length; };
  const pushRaw = (b: Uint8Array) => { parts.push(b); pos += b.length; };

  push("%PDF-1.4\n");

  const catalogId  = 1;
  const pagesId    = 2;
  let nextId       = 3;

  const pageIds:    number[] = [];
  const imgIds:     number[] = [];
  const contentIds: number[] = [];

  // Write image XObjects + page streams
  for (let i = 0; i < pages.length; i++) {
    const { w, h, jpeg } = pages[i];
    const imgId     = nextId++;
    const contentId = nextId++;
    const pageId    = nextId++;
    imgIds.push(imgId);
    contentIds.push(contentId);
    pageIds.push(pageId);

    // Image XObject
    offsets[imgId] = pos;
    push(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    pushRaw(jpeg);
    push(`\nendstream\nendobj\n`);

    // Content stream: scale image to page
    const stream = `q ${w} 0 0 ${h} 0 0 cm /Img Do Q`;
    const streamBytes = enc.encode(stream);
    offsets[contentId] = pos;
    push(`${contentId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
    pushRaw(streamBytes);
    push(`\nendstream\nendobj\n`);

    // Page object
    offsets[pageId] = pos;
    push(`${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${contentId} 0 R /Resources << /XObject << /Img ${imgId} 0 R >> >> >>\nendobj\n`);
  }

  // Pages dict
  offsets[pagesId] = pos;
  push(`${pagesId} 0 obj\n<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);

  // Catalog
  offsets[catalogId] = pos;
  push(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);

  // xref
  const xrefPos = pos;
  const maxId = nextId;
  push(`xref\n0 ${maxId}\n0000000000 65535 f \n`);
  for (let id = 1; id < maxId; id++) {
    push((offsets[id] ?? 0).toString().padStart(10, "0") + " 00000 n \n");
  }
  push(`trailer\n<< /Size ${maxId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  // Concatenate
  const total = parts.reduce((s, b) => s + b.length, 0);
  const out   = new Uint8Array(total);
  let offset  = 0;
  for (const b of parts) { out.set(b, offset); offset += b.length; }
  return out;
}

// ─── Markdown export (HTML → print PDF) ─────────────────────────────────────
async function exportMdAsPdf(
  tab: any,
  bms: Bookmark[],
  includeNotes: boolean,
  onProgress: (p: number, msg: string) => void,
): Promise<void> {
  onProgress(10, "Preparing document…");

  let html = tab.content as string;
  // Apply highlights: wrap matched text in <mark>
  for (const bm of bms) {
    if (!bm.selectedText) continue;
    const color = bm.highlightColor ?? "#f6c90e";
    const escaped = bm.selectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    html = html.replace(re, `<mark style="background:${color}55;border-bottom:2px solid ${color};border-radius:2px;" title="${bm.message ?? ""}">${bm.selectedText}</mark>`);
  }

  if (includeNotes) {
    const noted = bms.filter(b => b.message);
    if (noted.length > 0) {
      html += "\n\n---\n\n**Notes**\n\n";
      noted.forEach((b, i) => {
        html += `${i+1}. **"${b.selectedText?.slice(0, 60) ?? ""}"** — ${b.message}\n`;
      });
    }
  }

  onProgress(40, "Building document…");

  const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${tab.fileName}</title><style>
    body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;line-height:1.6;color:#111;}
    mark{padding:1px 0;border-radius:2px;}
    pre{background:#f5f5f5;padding:16px;border-radius:6px;overflow-x:auto;font-size:13px;}
    code{background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:13px;}
    img{max-width:100%;}
    @media print{body{margin:20px;}@page{margin:20mm;}}
  </style></head><body>${html}</body></html>`;

  onProgress(70, "Saving…");

  // Strategy 1: try Tauri save → Tauri writeBinaryFile
  try {
    const { save } = await import("@tauri-apps/api/dialog");
    const { writeTextFile } = await import("@tauri-apps/api/fs");
    const defaultName = tab.fileName.replace(/\.[^.]+$/, "") + "-highlighted.html";
    const savePath = await save({
      defaultPath: defaultName,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (savePath) {
      await writeTextFile(savePath, docHtml);
      onProgress(100, "Done!");
      return;
    }
  } catch { /* fall through */ }

  // Strategy 2: blob download (always works in Tauri WebView and browser)
  const blob = new Blob([docHtml], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = tab.fileName.replace(/\.[^.]+$/, "") + "-highlighted.html";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
  onProgress(100, "Done! Check your Downloads folder.");
}
