import React from "react";
import { useAppStore, Tab } from "../stores/appStore";

const MD_ICON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/>
  </svg>
);

const PDF_ICON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zM9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/>
    <path d="M4.5 12.5h2v-1h-2v1zm0-2h3v-1h-3v1zm0-2h2v-1h-2v1z" fill="var(--red)"/>
  </svg>
);

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useAppStore();
  if (tabs.length === 0) return null;
  return (
    <div className="tabbar">
      {tabs.map((tab: Tab) => (
        <div key={tab.id} className={`tab ${tab.id === activeTabId ? "tab-active" : ""}`}
          onClick={() => setActiveTab(tab.id)} title={tab.filePath}>
          <span className="tab-icon">{tab.type === "pdf" ? PDF_ICON : MD_ICON}</span>
          <span className="tab-name">{tab.fileName}</span>
          <button className="tab-close" onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}>×</button>
        </div>
      ))}
    </div>
  );
}
