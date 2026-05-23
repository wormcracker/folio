import React, { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { ExportModal } from "./ExportModal";

export function TitleBar() {
  const { theme, toggleTheme, toggleSidebar, getActiveTab } = useAppStore();
  const [showExport, setShowExport] = useState(false);
  const activeTab = getActiveTab();

  return (
    <>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
          <button className="icon-btn" onClick={toggleSidebar} title="Toggle Sidebar (⌘\)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="3" height="12" rx="1"/>
              <rect x="6" y="2" width="9" height="2" rx="1"/>
              <rect x="6" y="7" width="9" height="2" rx="1"/>
              <rect x="6" y="12" width="9" height="2" rx="1"/>
            </svg>
          </button>
          <span className="app-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="2" width="13" height="17" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M7 7h9M7 11h6M7 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <rect x="8" y="5" width="13" height="17" rx="2" fill="var(--bg2)" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M12 10h5M12 14h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Folio
          </span>
        </div>

        <div className="titlebar-right">
          {activeTab && (
            <button
              className="icon-btn titlebar-export-btn"
              onClick={() => setShowExport(true)}
              title="Export with highlights"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
              </svg>
              <span className="titlebar-export-label">Export</span>
            </button>
          )}
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 1a5 5 0 1 1 0-10A5 5 0 0 1 8 13zm0-11a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 1zm0 13a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 14zM2.05 2.05a.5.5 0 0 1 .707 0l.707.707a.5.5 0 0 1-.707.707L2.05 2.757a.5.5 0 0 1 0-.707zm11.9 11.9a.5.5 0 0 1 .707 0l.707.707a.5.5 0 0 1-.707.707l-.707-.707a.5.5 0 0 1 0-.707zM15 8a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1A.5.5 0 0 1 15 8zM1 8a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 1 8z"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </>
  );
}
