import React, { useEffect } from "react";

interface Props { onClose: () => void; }

const SECTIONS = [
  {
    title: "Navigation",
    items: [
      { key: "j / k", desc: "Scroll down / up" },
      { key: "d / u", desc: "Half page down / up" },
      { key: "Space", desc: "Full page down" },
      { key: "g / G", desc: "Top / bottom of document" },
      { key: "n / N", desc: "Next / previous page (PDF only)" },
      { key: "Shift+J / K", desc: "Next / previous tab" },
    ],
  },
  {
    title: "Quick Access Modals",
    items: [
      { key: "f", desc: "TOC picker (MD heading search) / PDF page thumbnails" },
      { key: "r", desc: "Recent files quick picker" },
      { key: "b", desc: "Bookmarks modal (add / local / global)" },
    ],
  },
  {
    title: "Sidebar Panels",
    items: [
      { key: "1", desc: "TOC / Thumbnails panel" },
      { key: "2", desc: "File browser panel" },
      { key: "3", desc: "Bookmarks panel" },
      { key: "4", desc: "Recent files panel" },
      { key: "⌘\\", desc: "Toggle sidebar" },
    ],
  },
  {
    title: "Bookmarks & Highlights",
    items: [
      { key: "m", desc: "Add bookmark (select text first for text bookmark)" },
      { key: "b → Add", desc: "Open add bookmark dialog via quick modal" },
      { key: "b → Local", desc: "Browse bookmarks for current file" },
      { key: "b → Global", desc: "Browse all bookmarks across files" },
    ],
  },
  {
    title: "PDF",
    items: [
      { key: "/ or p", desc: "Jump to page / TOC / bookmarks modal" },
      { key: "+ / -", desc: "Zoom in / out" },
      { key: "0", desc: "Reset zoom to 100%" },
      { key: "a", desc: "Toggle auto-fit to width" },
      { key: "i", desc: "Toggle dark mode invert" },
      { key: "↻ / ↺ toolbar", desc: "Rotate current page clockwise / counter-clockwise" },
      { key: "Ctrl+F", desc: "Search text in PDF" },
    ],
  },
  {
    title: "Markdown",
    items: [
      { key: "Ctrl+F", desc: "Find in document" },
    ],
  },
  {
    title: "App",
    items: [
      { key: "⌘O", desc: "Open file" },
      { key: "⌘⇧O", desc: "Open folder" },
      { key: "⌘W", desc: "Close tab" },
      { key: "Ctrl+,", desc: "Settings" },
      { key: "?", desc: "This shortcuts help" },
    ],
  },
];

export function ShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <span className="shortcuts-title">Keyboard Shortcuts</span>
          <kbd className="shortcuts-close-hint">?</kbd>
          <button className="shortcuts-close" onClick={onClose}>×</button>
        </div>
        <div className="shortcuts-body">
          {SECTIONS.map((section) => (
            <div key={section.title} className="shortcuts-section">
              <div className="shortcuts-section-title">{section.title}</div>
              <div className="shortcuts-grid">
                {section.items.map((item) => (
                  <div key={item.key} className="shortcut-row">
                    <kbd className="shortcut-key">{item.key}</kbd>
                    <span className="shortcut-desc">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
