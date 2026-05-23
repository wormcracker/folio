import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { FolderFile } from "../stores/appStore";

export async function openFileDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: [
      { name: "Documents", extensions: ["md", "markdown", "txt", "pdf"] },
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "PDF", extensions: ["pdf"] },
    ],
  });
  return typeof result === "string" ? result : null;
}

export async function openFolderDialog(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function readFileContent(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function readFileBinary(path: string): Promise<Uint8Array> {
  const arr = await invoke<number[]>("read_file_binary", { path });
  return new Uint8Array(arr);
}

export async function readDirMd(path: string): Promise<FolderFile[]> {
  return invoke<FolderFile[]>("read_dir_md", { path });
}

export async function resolvePath(base: string, relative: string): Promise<string> {
  return invoke<string>("resolve_path", { base, relative });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

export async function getHomeDir(): Promise<string> {
  return invoke<string>("get_home_dir");
}

export function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function getFileExtension(path: string): string {
  const name = getFileName(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isMarkdownFile(path: string): boolean {
  return ["md", "markdown", "txt"].includes(getFileExtension(path));
}

export function isPdfFile(path: string): boolean {
  return getFileExtension(path) === "pdf";
}

export function isSupportedFile(path: string): boolean {
  return isMarkdownFile(path) || isPdfFile(path);
}
