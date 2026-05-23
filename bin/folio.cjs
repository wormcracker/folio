#!/usr/bin/env node
/**
 * folio CLI
 * Usage: folio [file.md|file.pdf|./folder] ...
 */
const { execSync, spawnSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const args = process.argv.slice(2);
const HANDOFF = path.join(os.tmpdir(), "folio-open.json");
const APP_BUNDLE = "/Applications/Folio.app";
const DEV_BIN = path.join(__dirname, "..", "src-tauri", "target", "debug", "folio");

function isRunning() {
  try { return spawnSync("pgrep", ["-x", "folio"], { encoding: "utf8" }).stdout.trim().length > 0; } catch { return false; }
}
function focus() {
  try { execSync("open -a Folio", { stdio: "ignore" }); return; } catch {}
  const bin = fs.existsSync(`${APP_BUNDLE}/Contents/MacOS/folio`) ? `${APP_BUNDLE}/Contents/MacOS/folio` : DEV_BIN;
  if (fs.existsSync(bin)) spawn(bin, [], { detached: true, stdio: "ignore" }).unref();
  else { console.error("Folio not found. Run: npm run tauri build"); process.exit(1); }
}

if (!args.length) { focus(); process.exit(0); }

const files = [], folders = [];
for (const arg of args) {
  const r = path.resolve(process.cwd(), arg);
  try {
    const s = fs.statSync(r);
    if (s.isDirectory()) folders.push(r);
    else if (s.isFile()) files.push(r);
  } catch { console.error(`folio: not found: ${arg}`); }
}

if (files.length === 0 && folders.length === 0) process.exit(1);
fs.writeFileSync(HANDOFF, JSON.stringify({ files, folders }), "utf8");
focus();
process.exit(0);
