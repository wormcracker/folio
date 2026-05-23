import React from "react";

interface WelcomeProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  recentFiles: { path: string; name: string; openedAt: number }[];
  onOpenRecent: (path: string) => void;
  onRemoveRecent?: (path: string) => void;
}

export function Welcome({ onOpenFile, onOpenFolder, recentFiles, onOpenRecent, onRemoveRecent }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="fg" x1="0" y1="0" x2="72" y2="72" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#58a6ff"/>
                <stop offset="100%" stopColor="#bc8cff"/>
              </linearGradient>
            </defs>
            <rect x="8" y="6" width="38" height="52" rx="4" fill="#161b22" stroke="url(#fg)" strokeWidth="1.5"/>
            <rect x="16" y="6" width="38" height="52" rx="4" fill="#1c2128" stroke="url(#fg)" strokeWidth="1.5"/>
            <line x1="24" y1="22" x2="46" y2="22" stroke="#58a6ff" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="24" y1="30" x2="46" y2="30" stroke="url(#fg)" strokeWidth="1.8" strokeLinecap="round" opacity="0.7"/>
            <line x1="24" y1="38" x2="36" y2="38" stroke="#bc8cff" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
            <rect x="40" y="42" width="24" height="22" rx="4" fill="#0f1117" stroke="url(#fg)" strokeWidth="1.5"/>
            <path d="M52 47 C52 43.5 55 41 58 41 C61 41 64 43.5 64 47" stroke="url(#fg)" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <circle cx="52" cy="54" r="2.5" fill="url(#fg)"/>
          </svg>
        </div>
        <h1 className="welcome-title">Folio</h1>
        <p className="welcome-subtitle">Markdown &amp; PDF reader with vim navigation</p>

        <div className="welcome-actions">
          <button className="welcome-btn welcome-btn-primary" onClick={onOpenFile}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5z"/>
            </svg>
            Open File
            <kbd>⌘O</kbd>
          </button>
          <button className="welcome-btn" onClick={onOpenFolder}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7z"/>
            </svg>
            Open Folder
            <kbd>⌘⇧O</kbd>
          </button>
        </div>

        <div className="welcome-filetypes">
          <span className="welcome-filetype">📄 Markdown</span>
          <span className="welcome-filetype-sep">·</span>
          <span className="welcome-filetype">📕 PDF</span>
          <span className="welcome-filetype-sep">·</span>
          <span className="welcome-filetype">📝 Plain text</span>
        </div>

        {recentFiles.length > 0 && (
          <div className="welcome-recent">
            <h3 className="welcome-recent-title">Recent Files</h3>
            <div className="welcome-recent-list">
              {recentFiles.slice(0, 8).map((f) => {
                const ext = f.name.split(".").pop()?.toLowerCase();
                const icon = ext === "pdf" ? "📕" : "📄";
                return (
                  <div key={f.path} className="welcome-recent-item-wrapper">
                    <button className="welcome-recent-item" onClick={() => onOpenRecent(f.path)} title={f.path}>
                      <span className="welcome-recent-icon">{icon}</span>
                      <div>
                        <div className="welcome-recent-name">{f.name}</div>
                        <div className="welcome-recent-path">{f.path}</div>
                      </div>
                    </button>
                    {onRemoveRecent && (
                      <button className="welcome-recent-delete" onClick={(e) => { e.stopPropagation(); onRemoveRecent(f.path); }}>×</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="welcome-shortcuts">
          <h3 className="welcome-shortcuts-title">Keyboard Shortcuts</h3>
          <div className="shortcuts-grid">
            <div className="shortcut"><kbd>j / k</kbd><span>Scroll down / up</span></div>
            <div className="shortcut"><kbd>d / u</kbd><span>Half page down / up</span></div>
            <div className="shortcut"><kbd>f / Space</kbd><span>Page down</span></div>
            <div className="shortcut"><kbd>G / gg</kbd><span>Bottom / top</span></div>
            <div className="shortcut"><kbd>Ctrl+F</kbd><span>Find in document</span></div>
            <div className="shortcut"><kbd>/</kbd><span>Jump to heading (MD) or page (PDF)</span></div>
            <div className="shortcut"><kbd>+ / -</kbd><span>Zoom in / out (PDF)</span></div>
            <div className="shortcut"><kbd>m</kbd><span>Add bookmark (PDF)</span></div>
            <div className="shortcut"><kbd>?</kbd><span>All shortcuts</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
