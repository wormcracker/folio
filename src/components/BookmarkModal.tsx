import React, { useState, useEffect, useRef } from "react";
import { Tab } from "../stores/appStore";
import { useAppStore } from "../stores/appStore";

interface Props {
  tab: Tab;
  currentPage?: number;
  headingText?: string;
  selectedText?: string;
  textContext?: string;
  onSave: (message: string, color: string, scope: "local" | "global") => void;
  onClose: () => void;
}

const HIGHLIGHT_COLORS = [
  { value: "#f6c90e", label: "Amber" },
  { value: "#4fc3f7", label: "Sky" },
  { value: "#81c784", label: "Mint" },
  { value: "#f48fb1", label: "Rose" },
  { value: "#ce93d8", label: "Violet" },
  { value: "#ffb74d", label: "Peach" },
];

type Screen = "main" | "scope";

export function BookmarkModal({ tab, currentPage, headingText, selectedText, textContext, onSave, onClose }: Props) {
  const { settings } = useAppStore();
  const [msg, setMsg] = useState("");
  const [color, setColor] = useState(settings.defaultHighlightColor ?? "#f6c90e");
  const [scope, setScope] = useState<"local" | "global">("local");
  const [screen, setScreen] = useState<Screen>("main");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSelection = !!selectedText;

  useEffect(() => {
    if (screen === "main") inputRef.current?.focus();
  }, [screen]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [msg, color, scope]); // eslint-disable-line

  const handleSave = () => {
    if (!hasSelection) {
      // No text selected — just save as page/position bookmark
      onSave(msg, color, scope);
      return;
    }
    onSave(msg, color, scope);
  };

  if (!hasSelection) {
    return (
      <div className="bm-modal-overlay" onClick={onClose}>
        <div className="bm-modal" onClick={(e) => e.stopPropagation()}>
          <div className="bm-modal-header">
            <span className="bm-modal-title">Add Bookmark</span>
            <button className="bm-modal-close" onClick={onClose}>×</button>
          </div>
          <div className="bm-modal-no-sel">
            <span className="bm-modal-no-sel-icon">📌</span>
            <p>Select some text first to create a text bookmark with highlight.</p>
            <p className="bm-modal-no-sel-hint">Or save a page position bookmark below.</p>
          </div>
          <div className="bm-modal-meta">
            <span className="bm-modal-file">{tab.fileName}</span>
            {currentPage && <span className="bm-modal-page">Page {currentPage}</span>}
            {headingText && <span className="bm-modal-heading">{headingText}</span>}
          </div>
          <textarea
            ref={inputRef}
            className="bm-modal-input"
            placeholder="Add a note… (optional)"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
          />
          <div className="bm-scope-row">
            <span className="bm-scope-label">Scope</span>
            <button
              className={`bm-scope-btn ${scope === "local" ? "active" : ""}`}
              onClick={() => setScope("local")}
              title="Local — only for this file"
            >📄 Local</button>
            <button
              className={`bm-scope-btn ${scope === "global" ? "active" : ""}`}
              onClick={() => setScope("global")}
              title="Global — visible across all files"
            >🌐 Global</button>
          </div>
          <div className="bm-modal-footer">
            <span className="bm-modal-hint"><kbd>Esc</kbd> cancel · <kbd>⌘Enter</kbd> save</span>
            <button className="bm-modal-save" onClick={handleSave}>Save Position</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bm-modal-overlay" onClick={onClose}>
      <div className="bm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bm-modal-header">
          <span className="bm-modal-title">Bookmark Selection</span>
          <button className="bm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="bm-modal-meta">
          <span className="bm-modal-file">{tab.fileName}</span>
          {currentPage && <span className="bm-modal-page">Page {currentPage}</span>}
          {headingText && <span className="bm-modal-heading">{headingText}</span>}
        </div>
        <div className="bm-modal-selection">
          <span className="bm-modal-sel-label">
            {selectedText ? "Selected text (will be highlighted)" : "No text selected — bookmark will save page/heading position only"}
          </span>
          {selectedText && (
            <div className="bm-modal-sel-text" style={{ borderLeftColor: color }}>
              "{selectedText.length > 120 ? selectedText.slice(0, 120) + "…" : selectedText}"
            </div>
          )}
        </div>
        <div className="bm-modal-colors">
          <span className="bm-modal-colors-label">Highlight</span>
          <div className="bm-modal-color-row">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                className={`bm-color-swatch ${color === c.value ? "active" : ""}`}
                style={{ background: c.value }}
                title={c.label}
                onClick={() => setColor(c.value)}
              />
            ))}
          </div>
        </div>
        <textarea
          ref={inputRef}
          className="bm-modal-input"
          placeholder="Add a note… (optional, shown on hover)"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={2}
        />
        <div className="bm-scope-row">
          <span className="bm-scope-label">Scope</span>
          <button
            className={`bm-scope-btn ${scope === "local" ? "active" : ""}`}
            onClick={() => setScope("local")}
            title="Local — only for this file"
          >📄 Local</button>
          <button
            className={`bm-scope-btn ${scope === "global" ? "active" : ""}`}
            onClick={() => setScope("global")}
            title="Global — visible across all files"
          >🌐 Global</button>
        </div>
        <div className="bm-modal-footer">
          <span className="bm-modal-hint"><kbd>Esc</kbd> cancel · <kbd>⌘Enter</kbd> save</span>
          <button className="bm-modal-save" onClick={handleSave}>Save Bookmark</button>
        </div>
      </div>
    </div>
  );
}
