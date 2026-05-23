#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use std::env::temp_dir;

use tauri::{
  CustomMenuItem, Menu, MenuItem, Submenu, AboutMetadata,
};

#[derive(serde::Serialize)]
struct FileEntry {
  name: String,
  path: String,
  is_dir: bool,
  extension: String,
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
  fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
  fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_dir_md(path: String) -> Result<Vec<FileEntry>, String> {
  let dir = Path::new(&path);
  if !dir.is_dir() {
    return Err("Not a directory".into());
  }

  let mut entries = Vec::new();
  collect_files(dir, &mut entries)?;
  Ok(entries)
}

fn collect_files(dir: &Path, entries: &mut Vec<FileEntry>) -> Result<(), String> {
  for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
    let p = entry.path();
    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();

    if name.starts_with('.') {
      continue;
    }

    let ext = p
      .extension()
      .unwrap_or_default()
      .to_string_lossy()
      .to_lowercase();

    if p.is_dir() {
      entries.push(FileEntry {
        name: name.clone(),
        path: p.to_string_lossy().into(),
        is_dir: true,
        extension: String::new(),
      });
      let _ = collect_files(&p, entries);
    } else if ["md", "markdown", "txt", "pdf"].contains(&ext.as_str()) {
      entries.push(FileEntry {
        name,
        path: p.to_string_lossy().into(),
        is_dir: false,
        extension: ext,
      });
    }
  }
  Ok(())
}

#[tauri::command]
fn resolve_path(base: String, relative: String) -> Result<String, String> {
  let base_path = Path::new(&base);
  let base_dir = if base_path.is_file() {
    base_path.parent().unwrap_or(Path::new("/"))
  } else {
    base_path
  };

  base_dir
    .join(&relative)
    .canonicalize()
    .map(|p| p.to_string_lossy().into())
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
  Path::new(&path).exists()
}

#[tauri::command]
fn get_home_dir() -> String {
  dirs::home_dir()
    .map(|p| p.to_string_lossy().into())
    .unwrap_or_else(|| "/".into())
}

#[tauri::command]
fn get_tmp_dir() -> String {
  temp_dir().to_string_lossy().into()
}

/* -------------------- MENU -------------------- */

fn build_menu() -> Menu {
  // ---------------- App Menu (THIS is the missing piece) ----------------
  let app_menu = Submenu::new(
    "Folio",
    Menu::new()
      .add_native_item(MenuItem::About(
        "Folio".into(),
        AboutMetadata::default(),
      ))
      .add_native_item(MenuItem::Separator)
      .add_native_item(MenuItem::Services)
      .add_native_item(MenuItem::Separator)
      .add_native_item(MenuItem::Hide)
      .add_native_item(MenuItem::HideOthers)
      .add_native_item(MenuItem::ShowAll)
      .add_native_item(MenuItem::Separator)
      .add_native_item(MenuItem::Quit),
  );

  let file = Submenu::new(
    "File",
    Menu::new()
      .add_item(CustomMenuItem::new("open_file", "Open File…").accelerator("Cmd+O"))
      .add_item(CustomMenuItem::new("open_folder", "Open Folder…").accelerator("Cmd+Shift+O"))
      .add_native_item(MenuItem::Separator)
      .add_item(CustomMenuItem::new("new_tab", "New Tab").accelerator("Cmd+T"))
      .add_item(CustomMenuItem::new("close_tab", "Close Tab").accelerator("Cmd+W"))
  );

  let edit = Submenu::new(
    "Edit",
    Menu::new()
      .add_native_item(MenuItem::Undo)
      .add_native_item(MenuItem::Redo)
      .add_native_item(MenuItem::Separator)
      .add_native_item(MenuItem::Cut)
      .add_native_item(MenuItem::Copy)
      .add_native_item(MenuItem::Paste)
      .add_native_item(MenuItem::SelectAll),
  );

  let view = Submenu::new(
    "View",
    Menu::new()
      .add_item(CustomMenuItem::new("toggle_sidebar", "Toggle Sidebar").accelerator("Cmd+\\"))
      .add_item(CustomMenuItem::new("toggle_theme", "Toggle Theme"))
      .add_native_item(MenuItem::Separator)
      .add_item(CustomMenuItem::new("preferences", "Preferences…").accelerator("Cmd+,"))
      .add_item(CustomMenuItem::new("shortcuts", "Keyboard Shortcuts")),
  );

  let window = Submenu::new(
    "Window",
    Menu::new()
      .add_native_item(MenuItem::Minimize)
      .add_native_item(MenuItem::Zoom),
  );

  Menu::new()
    // 🔴 THIS MUST BE FIRST → creates macOS app menu
    .add_submenu(app_menu)

    .add_submenu(file)
    .add_submenu(edit)
    .add_submenu(view)
    .add_submenu(window)
}

/* -------------------- MAIN -------------------- */

fn main() {
  tauri::Builder::default()
    .menu(build_menu())
    .on_menu_event(|ev| {
      let w = ev.window();

      match ev.menu_item_id() {
        "open_file" => { let _ = w.emit("menu://open-file", ()); }
        "open_folder" => { let _ = w.emit("menu://open-folder", ()); }
        "new_tab" => { let _ = w.emit("menu://new-tab", ()); }
        "close_tab" => { let _ = w.emit("menu://close-tab", ()); }
        "toggle_sidebar" => { let _ = w.emit("menu://toggle-sidebar", ()); }
        "toggle_theme" => { let _ = w.emit("menu://toggle-theme", ()); }
        "shortcuts" => { let _ = w.emit("menu://shortcuts", ()); }
        "preferences" => { let _ = w.emit("menu://preferences", ()); }
        _ => {}
      }
    })
    .invoke_handler(tauri::generate_handler![
      read_file,
      read_file_binary,
      read_dir_md,
      resolve_path,
      file_exists,
      get_home_dir,
      get_tmp_dir,
    ])
    .run(tauri::generate_context!())
    .expect("error running folio");
}
