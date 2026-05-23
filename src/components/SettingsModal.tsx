import React, { useEffect, useRef } from "react";
import { useAppStore, DEFAULT_SETTINGS, Bookmark, AppSettings } from "../stores/appStore";

interface Props { onClose: () => void; }

const HIGHLIGHT_COLORS = [
  { value: "#f6c90e", label: "Amber" },
  { value: "#4fc3f7", label: "Sky" },
  { value: "#81c784", label: "Mint" },
  { value: "#f48fb1", label: "Rose" },
  { value: "#ce93d8", label: "Violet" },
  { value: "#ffb74d", label: "Peach" },
];

interface ExportData {
  version: 1;
  exportedAt: string;
  bookmarks: Bookmark[];
  settings: AppSettings;
}

export function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, theme, toggleTheme, bookmarks, addBookmark } = useAppStore();
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === ",")) {
        e.preventDefault(); onClose();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const reset = () => updateSettings({ ...DEFAULT_SETTINGS });

  const handleExport = () => {
    const data: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      bookmarks,
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ExportData;
        if (data.version !== 1) { alert("Unsupported backup version."); return; }
        if (data.settings) updateSettings(data.settings);
        if (Array.isArray(data.bookmarks)) {
          const { bookmarks: current } = useAppStore.getState();
          const existingIds = new Set(current.map((b) => b.id));
          let imported = 0;
          for (const bm of data.bookmarks) {
            if (!existingIds.has(bm.id)) {
              // addBookmark strips id/createdAt, so re-add them directly
              useAppStore.setState((s) => ({
                bookmarks: [...s.bookmarks, { ...bm, scope: bm.scope ?? "local" }],
              }));
              imported++;
            }
          }
          alert(`Import complete: ${imported} bookmarks imported, settings restored.`);
        }
      } catch {
        alert("Invalid backup file. Please select a valid Folio JSON backup.");
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = "";
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <span className="settings-hint"><kbd>Ctrl</kbd><kbd>,</kbd></span>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-body">
          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Theme</span>
                <span className="settings-desc">Light or dark interface</span>
              </div>
              <div className="settings-control">
                <button className={`settings-toggle ${theme === "dark" ? "active" : ""}`} onClick={() => toggleTheme()}>
                  {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span>PDF Dark Mode</span>
                <span className="settings-desc">Invert PDF pages in dark theme (toggle with <kbd>i</kbd>)</span>
              </div>
              <div className="settings-control">
                <label className="settings-switch">
                  <input type="checkbox" checked={settings.pdfDarkMode} onChange={(e) => updateSettings({ pdfDarkMode: e.target.checked })} />
                  <span className="settings-switch-track" />
                </label>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Show Page Numbers</span>
                <span className="settings-desc">Display page number badge below each PDF page</span>
              </div>
              <div className="settings-control">
                <label className="settings-switch">
                  <input type="checkbox" checked={settings.showPageNumbers} onChange={(e) => updateSettings({ showPageNumbers: e.target.checked })} />
                  <span className="settings-switch-track" />
                </label>
              </div>
            </div>
          </div>

          {/* Auto-fit */}
          <div className="settings-section">
            <div className="settings-section-title">Display / Fit</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Auto-fit PDF</span>
                <span className="settings-desc">Scale PDF to fill width automatically (toolbar ⟷ or press <kbd>a</kbd>)</span>
              </div>
              <div className="settings-control">
                <label className="settings-switch">
                  <input type="checkbox" checked={settings.autoFitPdf} onChange={(e) => updateSettings({ autoFitPdf: e.target.checked })} />
                  <span className="settings-switch-track" />
                </label>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Auto-fit Markdown</span>
                <span className="settings-desc">Expand markdown content to fill available width</span>
              </div>
              <div className="settings-control">
                <label className="settings-switch">
                  <input type="checkbox" checked={settings.autoFitMd} onChange={(e) => updateSettings({ autoFitMd: e.target.checked })} />
                  <span className="settings-switch-track" />
                </label>
              </div>
            </div>
          </div>

          {/* Bookmarks */}
          <div className="settings-section">
            <div className="settings-section-title">Bookmarks</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Default Highlight Color</span>
                <span className="settings-desc">Color used when creating new text bookmarks</span>
              </div>
              <div className="settings-control">
                <div className="settings-color-row">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button key={c.value} className={`bm-color-swatch ${settings.defaultHighlightColor === c.value ? "active" : ""}`}
                      style={{ background: c.value }} title={c.label} onClick={() => updateSettings({ defaultHighlightColor: c.value })} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* PDF */}
          <div className="settings-section">
            <div className="settings-section-title">PDF Defaults</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Default Zoom</span>
                <span className="settings-desc">Starting zoom level for new PDFs</span>
              </div>
              <div className="settings-control">
                <select className="settings-select" value={settings.defaultPdfZoom} onChange={(e) => updateSettings({ defaultPdfZoom: parseFloat(e.target.value) })}>
                  <option value={0.5}>50%</option>
                  <option value={0.75}>75%</option>
                  <option value={1.0}>100%</option>
                  <option value={1.2}>120%</option>
                  <option value={1.5}>150%</option>
                  <option value={2.0}>200%</option>
                </select>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Default Layout</span>
                <span className="settings-desc">Single or double page view</span>
              </div>
              <div className="settings-control">
                <select className="settings-select" value={settings.defaultPdfLayout} onChange={(e) => updateSettings({ defaultPdfLayout: e.target.value as "single" | "double" })}>
                  <option value="single">Single</option>
                  <option value="double">Double</option>
                </select>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="settings-section">
            <div className="settings-section-title">Navigation</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Smooth Scrolling</span>
                <span className="settings-desc">Animate scroll when jumping to pages</span>
              </div>
              <div className="settings-control">
                <label className="settings-switch">
                  <input type="checkbox" checked={settings.smoothScrolling} onChange={(e) => updateSettings({ smoothScrolling: e.target.checked })} />
                  <span className="settings-switch-track" />
                </label>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Sidebar Default Tab</span>
                <span className="settings-desc">Which sidebar panel opens on launch</span>
              </div>
              <div className="settings-control">
                <select className="settings-select" value={settings.sidebarDefaultTab} onChange={(e) => updateSettings({ sidebarDefaultTab: e.target.value as any })}>
                  <option value="toc">Contents / Thumbnails</option>
                  <option value="files">Files</option>
                  <option value="bookmarks">Bookmarks</option>
                  <option value="recent">Recent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Export / Import */}
          <div className="settings-section">
            <div className="settings-section-title">Export / Import</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Export Backup</span>
                <span className="settings-desc">Save all bookmarks and settings to a JSON file</span>
              </div>
              <div className="settings-control">
                <button className="settings-export-btn" onClick={handleExport}>
                  ↓ Export
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Import Backup</span>
                <span className="settings-desc">Restore bookmarks and settings from a JSON backup</span>
              </div>
              <div className="settings-control">
                <button className="settings-export-btn" onClick={() => importRef.current?.click()}>
                  ↑ Import
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleImport}
                />
              </div>
            </div>
          </div>

          {/* Export directory */}
          <div className="settings-section">
            <div className="settings-section-title">Export</div>
            <div className="settings-row">
              <div className="settings-label">
                <span>Default Export Directory</span>
                <span className="settings-desc">Where exported PDFs are saved by default (leave blank to always prompt)</span>
              </div>
              <div className="settings-control">
                <input
                  className="settings-text-input"
                  placeholder="/Users/you/Documents/exports"
                  value={settings.exportDir ?? ""}
                  onChange={(e) => updateSettings({ exportDir: e.target.value })}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          {/* Key Bindings */}
          <div className="settings-section">
            <div className="settings-section-title">Key Bindings</div>
            <div className="settings-kb-grid">
              {KB_MAP.map((row) => (
                <div key={row.key} className="settings-kb-row">
                  <kbd className="settings-kb-key">{row.key}</kbd>
                  <span className="settings-kb-desc">{row.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-reset" onClick={reset}>Reset to defaults</button>
          <button className="settings-done" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

const KB_MAP = [
  { key: "Shift+J / K", desc: "Next / previous tab" },
  { key: "1 / 2 / 3 / 4", desc: "Sidebar: TOC / Files / Bookmarks / Recent" },
  { key: "f", desc: "Quick TOC (MD heading picker; PDF thumbnail modal)" },
  { key: "b", desc: "Quick bookmarks modal (add / local / global)" },
  { key: "r", desc: "Quick recent files modal" },
  { key: "Ctrl+,", desc: "Open settings" },
  { key: "?", desc: "Keyboard shortcuts help" },
  { key: "⌘O", desc: "Open file" },
  { key: "⌘W", desc: "Close tab" },
  { key: "⌘\\", desc: "Toggle sidebar" },
  { key: "j / k", desc: "Scroll down / up" },
  { key: "d / u", desc: "Half page down / up" },
  { key: "Space", desc: "Full page down" },
  { key: "g / G", desc: "Top / bottom" },
  { key: "n / N (PDF)", desc: "Next / previous page" },
  { key: "Ctrl+F", desc: "Find in document (PDF & MD)" },
  { key: "m", desc: "Bookmark selection (select text first)" },
  { key: "i (PDF)", desc: "Toggle dark invert" },
  { key: "a", desc: "Toggle auto-fit width (PDF)" },
  { key: "/ or p (PDF)", desc: "Page · TOC · Bookmarks modal" },
  { key: "↻ / ↺ (PDF)", desc: "Rotate page clockwise / counter-clockwise" },
  { key: "+ / -", desc: "Zoom in / out (PDF)" },
  { key: "0", desc: "Reset zoom (PDF)" },
];
