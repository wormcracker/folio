import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Tab types ──────────────────────────────────────────────────────────────
export type TabType = "md" | "pdf";

export interface MdTab {
  id: string; type: "md";
  filePath: string; fileName: string;
  content: string; scrollY: number; searchQuery: string;
}

export interface PdfTab {
  id: string; type: "pdf";
  filePath: string; fileName: string;
  page: number; zoom: number;
  layout: "single" | "double";
  totalPages: number;
  rotation?: number; // per-page rotations map (serialized)
  pageRotations?: Record<number, number>; // page -> degrees (0,90,180,270)
}

export type Tab = MdTab | PdfTab;

// ─── Bookmarks ───────────────────────────────────────────────────────────────
export interface Bookmark {
  id: string;
  filePath: string;
  fileName: string;
  fileType: TabType;
  scope: "local" | "global"; // local = file-specific, global = app-wide
  // PDF-specific
  page?: number;
  // MD-specific
  headingId?: string;
  headingText?: string;
  lineNumber?: number;
  // Text-selection bookmark fields
  selectedText?: string;
  textContext?: string;
  pageHeading?: string;
  charOffset?: number;
  highlightColor?: string;
  // common
  message: string;
  createdAt: number;
  preview: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────
export interface AppSettings {
  pdfDarkMode: boolean;
  defaultPdfZoom: number;
  defaultPdfLayout: "single" | "double";
  sidebarDefaultTab: "toc" | "files" | "recent" | "bookmarks";
  showPageNumbers: boolean;
  smoothScrolling: boolean;
  autoFitPdf: boolean;
  autoFitMd: boolean;
  defaultHighlightColor: string;
  exportDir: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  pdfDarkMode: true,
  defaultPdfZoom: 1.2,
  defaultPdfLayout: "single",
  sidebarDefaultTab: "toc",
  showPageNumbers: true,
  smoothScrolling: true,
  autoFitPdf: false,
  autoFitMd: false,
  defaultHighlightColor: "#f6c90e",
  exportDir: "",
};

// ─── Other types ─────────────────────────────────────────────────────────────
export interface RecentFile { path: string; name: string; openedAt: number; lastPage?: number; lastHeadingId?: string; lastScrollY?: number; }
export type Theme = "dark" | "light";
export interface FolderFile { name: string; path: string; is_dir: boolean; extension: string; supported: boolean; }

// ─── Store ───────────────────────────────────────────────────────────────────
interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<MdTab, "id" | "scrollY" | "searchQuery"> | Omit<PdfTab, "id" | "totalPages">) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateMdContent: (id: string, content: string) => void;
  updateMdScroll: (id: string, scrollY: number) => void;
  updatePdfPage: (id: string, page: number) => void;
  updatePdfZoom: (id: string, zoom: number) => void;
  updatePdfLayout: (id: string, layout: "single" | "double") => void;
  updatePdfTotalPages: (id: string, totalPages: number) => void;
  updatePdfPageRotation: (id: string, page: number, rotation: number) => void;
  getActiveTab: () => Tab | null;
  activateNextTab: () => void;
  activatePrevTab: () => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarActiveTab: "toc" | "files" | "recent" | "bookmarks";
  setSidebarTab: (tab: "toc" | "files" | "recent" | "bookmarks") => void;

  theme: Theme;
  toggleTheme: () => void;

  recentFiles: RecentFile[];
  addRecentFile: (path: string, name: string, position?: { page?: number; headingId?: string; scrollY?: number }) => void;
  updateRecentPosition: (path: string, position: { page?: number; headingId?: string; scrollY?: number }) => void;
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;

  openFolder: string | null;
  folderFiles: FolderFile[];
  setOpenFolder: (path: string | null) => void;
  setFolderFiles: (files: FolderFile[]) => void;

  bookmarks: Bookmark[];
  addBookmark: (b: Omit<Bookmark, "id" | "createdAt">) => void;
  removeBookmark: (id: string) => void;
  updateBookmarkMessage: (id: string, message: string) => void;

  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

let counter = 0;
const uid = () => `t${++counter}-${Date.now()}`;
const bid = () => `b${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      tabs: [], activeTabId: null,

      addTab: (tab) => {
        const existing = get().tabs.find((t) => t.filePath === tab.filePath);
        if (existing) { set({ activeTabId: existing.id }); return; }
        const id = uid();
        const s = get().settings;
        const newTab: Tab = tab.type === "pdf"
          ? { ...tab, id, totalPages: 0, page: (tab as any).page ?? 1, zoom: (tab as any).zoom ?? s.defaultPdfZoom, layout: (tab as any).layout ?? s.defaultPdfLayout, pageRotations: {} }
          : { ...tab, id, scrollY: 0, searchQuery: "" };
        set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: id }));
        get().addRecentFile(tab.filePath, tab.fileName);
      },

      removeTab: (id) => set((s) => {
        const tabs = s.tabs.filter((t) => t.id !== id);
        let activeTabId = s.activeTabId;
        if (activeTabId === id) {
          const idx = s.tabs.findIndex((t) => t.id === id);
          activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
        }
        return { tabs, activeTabId };
      }),

      setActiveTab: (id) => set({ activeTabId: id }),
      getActiveTab: () => get().tabs.find((t) => t.id === get().activeTabId) ?? null,

      activateNextTab: () => {
        const { tabs, activeTabId } = get();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        set({ activeTabId: tabs[(idx + 1) % tabs.length].id });
      },
      activatePrevTab: () => {
        const { tabs, activeTabId } = get();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        set({ activeTabId: tabs[(idx - 1 + tabs.length) % tabs.length].id });
      },

      updateMdContent: (id, content) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, content } : t) })),
      updateMdScroll: (id, scrollY) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, scrollY } : t) })),
      updatePdfPage: (id, page) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, page } : t) })),
      updatePdfZoom: (id, zoom) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, zoom } : t) })),
      updatePdfLayout: (id, layout) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, layout } : t) })),
      updatePdfTotalPages: (id, totalPages) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, totalPages } : t) })),
      updatePdfPageRotation: (id, page, rotation) => set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== id || t.type !== "pdf") return t;
          const pageRotations = { ...(t as PdfTab).pageRotations, [page]: ((((t as PdfTab).pageRotations?.[page] ?? 0) + rotation) % 360 + 360) % 360 };
          return { ...t, pageRotations };
        })
      })),

      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      sidebarActiveTab: "toc",
      setSidebarTab: (tab) => set({ sidebarActiveTab: tab, sidebarOpen: true }),

      theme: "dark",
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

      recentFiles: [],
      addRecentFile: (path, name, position) => set((s) => ({
        recentFiles: [{ path, name, openedAt: Date.now(), lastPage: position?.page, lastHeadingId: position?.headingId, lastScrollY: position?.scrollY }, ...s.recentFiles.filter((r) => r.path !== path)].slice(0, 20),
      })),
      updateRecentPosition: (path, position) => set((s) => ({
        recentFiles: s.recentFiles.map((r) => r.path !== path ? r : { ...r, lastPage: position.page ?? r.lastPage, lastHeadingId: position.headingId ?? r.lastHeadingId, lastScrollY: position.scrollY ?? r.lastScrollY }),
      })),
      removeRecentFile: (path) => set((s) => ({ recentFiles: s.recentFiles.filter((r) => r.path !== path) })),
      clearRecentFiles: () => set({ recentFiles: [] }),

      openFolder: null, folderFiles: [],
      setOpenFolder: (path) => set({ openFolder: path }),
      setFolderFiles: (files) => set({ folderFiles: files }),

      bookmarks: [],
      addBookmark: (b) => set((s) => ({ bookmarks: [{ ...b, id: bid(), createdAt: Date.now() }, ...s.bookmarks] })),
      removeBookmark: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
      updateBookmarkMessage: (id, message) => set((s) => ({ bookmarks: s.bookmarks.map((b) => b.id === id ? { ...b, message } : b) })),

      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: "folio-storage",
      partialize: (s) => ({
        theme: s.theme,
        recentFiles: s.recentFiles,
        sidebarOpen: s.sidebarOpen,
        bookmarks: s.bookmarks,
        settings: s.settings,
      }),
    }
  )
);
