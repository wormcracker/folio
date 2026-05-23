import { invoke } from "@tauri-apps/api/tauri";
import { removeFile } from "@tauri-apps/api/fs";
import { useAppStore } from "../stores/appStore";
import { readFileContent, getFileName, isMarkdownFile, isPdfFile } from "./fileSystem";

type AppStore = ReturnType<typeof useAppStore.getState>;
interface Handoff { files?: string[]; folders?: string[]; }

async function getHandoffPath(): Promise<string> {
  try { return `${await invoke<string>("get_tmp_dir")}/folio-open.json`; }
  catch { return "/tmp/folio-open.json"; }
}

export async function handleCLIOpen(
  addTab: AppStore["addTab"],
  setOpenFolder: AppStore["setOpenFolder"],
  setFolderFiles: AppStore["setFolderFiles"],
) {
  try {
    const path = await getHandoffPath();
    let raw: string;
    try { raw = await invoke<string>("read_file", { path }); }
    catch { return; }

    let handoff: Handoff;
    try { handoff = JSON.parse(raw); } catch { return; }

    for (const p of handoff.files ?? []) {
      if (isPdfFile(p)) {
        addTab({ type: "pdf", filePath: p, fileName: getFileName(p), page: 1, zoom: 1.2, layout: "single" });
      } else if (isMarkdownFile(p)) {
        try {
          const content = await readFileContent(p);
          addTab({ type: "md", filePath: p, fileName: getFileName(p), content });
        } catch {}
      }
    }

    for (const dir of handoff.folders ?? []) {
      try {
        const files = await invoke<any[]>("read_dir_md", { path: dir });
        setOpenFolder(dir);
        setFolderFiles(files);
        useAppStore.getState().setSidebarOpen(true);
      } catch {}
    }

    try { await removeFile(path); } catch {}
  } catch {}
}
