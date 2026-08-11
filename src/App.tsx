import React, { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "./stores/appStore";
import { handleCLIOpen } from "./utils/cliOpen";
import {
  openFileDialog, openFolderDialog, readFileContent, readDirMd,
  getFileName, isMarkdownFile, isPdfFile,
} from "./utils/fileSystem";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { MarkdownViewer } from "./components/MarkdownViewer";
import { PdfViewer } from "./components/PdfViewer";
import { Welcome } from "./components/Welcome";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SettingsModal } from "./components/SettingsModal";
import { Heading } from "./utils/markdownParser";

export default function App() {
  const {
    activeTabId, theme, toggleSidebar, toggleTheme,
    addTab, removeTab, getActiveTab, recentFiles, removeRecentFile,
    setOpenFolder, setFolderFiles, activateNextTab, activatePrevTab,
    setSidebarOpen,
  } = useAppStore();

  const [headings, setHeadings] = useState<Heading[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | undefined>();

  const activeTab = getActiveTab();

  // CLI polling
  useEffect(() => {
    const run = () => handleCLIOpen(addTab, setOpenFolder, setFolderFiles).catch(console.error);
    run();
    const t = setInterval(run, 2000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line

  // Apply theme
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  // Auto-load the containing directory of whichever file is active — on initial
  // open, when opening a new file, when switching tabs, when following an
  // internal link, and when navigating back/forward through tabs (Shift+J/K).
  // The sidebar's "files" panel always mirrors the active file's folder.
  useEffect(() => {
    if (!activeTab) return;
    const filePath = activeTab.filePath;
    const lastSlash = filePath.lastIndexOf("/");
    if (lastSlash <= 0) return;
    const dir = filePath.slice(0, lastSlash);
    const { openFolder: currentFolder } = useAppStore.getState();
    if (currentFolder === dir) return;
    let cancelled = false;
    (async () => {
      try {
        const files = await readDirMd(dir);
        if (cancelled) return;
        setOpenFolder(dir);
        setFolderFiles(files);
      } catch {
        // Directory may be unreadable (e.g. sandboxed path) — leave sidebar as-is.
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab?.filePath, setOpenFolder, setFolderFiles]);

  // App-level drag & drop
  useEffect(() => {
    const onOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer?.files ?? [])) {
        const fp = (file as any).path as string | undefined;
        if (!fp) continue;
        try {
          if (isPdfFile(fp)) {
            addTab({ type: "pdf", filePath: fp, fileName: getFileName(fp), page: 1, zoom: 1.2, layout: "single" });
          } else if (isMarkdownFile(fp)) {
            const content = await readFileContent(fp);
            addTab({ type: "md", filePath: fp, fileName: getFileName(fp), content });
          }
        } catch {}
      }
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragover", onOver); window.removeEventListener("drop", onDrop); };
  }, [addTab]);

  const handleOpenFile = useCallback(async () => {
    const path = await openFileDialog();
    if (!path) return;
    if (isPdfFile(path)) {
      addTab({ type: "pdf", filePath: path, fileName: getFileName(path), page: 1, zoom: 1.2, layout: "single" });
    } else {
      const content = await readFileContent(path);
      addTab({ type: "md", filePath: path, fileName: getFileName(path), content });
    }
  }, [addTab]);

  const handleOpenFolder = useCallback(async (folderPath?: string) => {
    const path = folderPath ?? await openFolderDialog();
    if (!path) return;
    setOpenFolder(path);
    const files = await readDirMd(path);
    setFolderFiles(files);
    useAppStore.getState().setSidebarOpen(true);
  }, [setOpenFolder, setFolderFiles]);

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      const recent = useAppStore.getState().recentFiles.find(r => r.path === path);
      if (isPdfFile(path)) {
        addTab({ type: "pdf", filePath: path, fileName: getFileName(path), page: recent?.lastPage ?? 1, zoom: 1.2, layout: "single" });
      } else {
        const content = await readFileContent(path);
        addTab({ type: "md", filePath: path, fileName: getFileName(path), content });
        if (recent?.lastHeadingId) {
          setTimeout(() => (window as any).__scrollToHeading?.(recent.lastHeadingId), 300);
        } else if (recent?.lastScrollY) {
          setTimeout(() => {
            const el = document.querySelector(".md-container") as HTMLElement | null;
            if (el) el.scrollTop = recent.lastScrollY!;
          }, 300);
        }
      }
    } catch {}
  }, [addTab]);

  // Tauri menu events
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    listen("menu://open-file", handleOpenFile).then((u) => unsubs.push(u));
    listen("menu://open-folder", () => handleOpenFolder()).then((u) => unsubs.push(u));
    listen("menu://new-tab", handleOpenFile).then((u) => unsubs.push(u));
    listen("menu://close-tab", () => { if (activeTabId) removeTab(activeTabId); }).then((u) => unsubs.push(u));
    listen("menu://toggle-sidebar", () => toggleSidebar()).then((u) => unsubs.push(u));
    listen("menu://toggle-theme", () => toggleTheme()).then((u) => unsubs.push(u));
    listen("menu://shortcuts", () => setShowShortcuts(true)).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [activeTabId, handleOpenFile, handleOpenFolder, removeTab, toggleSidebar, toggleTheme]);

  // Global keyboard shortcuts (non-conflicting — f/r/b handled in Sidebar)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "q") return;

      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((v) => !v);
        return;
      }

      if (e.metaKey) {
        if (["h", "m"].includes(e.key)) return;
        if (e.key === "o" && !e.shiftKey) { e.preventDefault(); handleOpenFile(); return; }
        if (e.key === "O" && e.shiftKey)  { e.preventDefault(); handleOpenFolder(); return; }
        if (e.key === "w") { e.preventDefault(); if (activeTabId) removeTab(activeTabId); return; }
        if (e.key === "\\") { e.preventDefault(); toggleSidebar(); return; }
        return;
      }

      if (isEditable) return;

      if (e.shiftKey && e.key === "J") { e.preventDefault(); activatePrevTab(); return; }
      if (e.shiftKey && e.key === "K") { e.preventDefault(); activateNextTab(); return; }

      // 1/2/3/4: sidebar tab numbers — toggle if already on that tab
      const { setSidebarTab, setSidebarOpen, sidebarActiveTab, sidebarOpen } = useAppStore.getState();
      const toggleSidebarTab = (tab: "toc" | "files" | "bookmarks" | "recent") => {
        if (sidebarOpen && sidebarActiveTab === tab) { setSidebarOpen(false); }
        else { setSidebarTab(tab); }
      };
      if (e.key === "1") { e.preventDefault(); toggleSidebarTab("toc"); return; }
      if (e.key === "2") { e.preventDefault(); toggleSidebarTab("files"); return; }
      if (e.key === "3") { e.preventDefault(); toggleSidebarTab("bookmarks"); return; }
      if (e.key === "4") { e.preventDefault(); toggleSidebarTab("recent"); return; }

      if (e.key === "?") { e.preventDefault(); setShowShortcuts((v) => !v); return; }
      if (e.key === "Escape") {
        setShowShortcuts(false);
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, activeTab, handleOpenFile, handleOpenFolder, removeTab, toggleSidebar, headings, activateNextTab, activatePrevTab, setSidebarOpen]);

  const handleHeadingClick = useCallback((id: string) => {
    (window as any).__scrollToHeading?.(id);
  }, []);

  return (
    <div className="app" data-theme={theme}>
      <TitleBar />
      <TabBar />
      <div className="main-layout">
        <Sidebar
          headings={headings}
          onHeadingClick={handleHeadingClick}
          activeHeadingId={activeHeadingId}
        />
        <main className="content-area">
          {!activeTab && (
            <Welcome
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              recentFiles={recentFiles}
              onOpenRecent={handleOpenRecent}
              onRemoveRecent={removeRecentFile}
            />
          )}
          {activeTab?.type === "md" && (
            <MarkdownViewer
              key={activeTab.id}
              content={activeTab.content}
              filePath={activeTab.filePath}
              tabId={activeTab.id}
              onHeadingsChange={setHeadings}
              onActiveHeadingChange={setActiveHeadingId}
              initialScrollY={activeTab.scrollY}
            />
          )}
          {activeTab?.type === "pdf" && (
            <PdfViewer key={activeTab.id} tab={activeTab} />
          )}
        </main>
      </div>
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
