#!/usr/bin/env node
/**
 * Generates minimal placeholder PNG icons for Tauri.
 * Run: node scripts/gen-icons.js
 * Real icons can be replaced later.
 */

const fs = require('fs');
const path = require('path');

// Minimal 1x1 transparent PNG (base64)
// We'll create simple colored squares as placeholder
const { createCanvas } = (() => {
  try { return require('canvas'); } catch { return null; }
})() ?? {};

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Minimal valid PNG bytes for a 32x32 solid colored image
// We use a pre-made minimal PNG as fallback
function minimalPng(size) {
  // This creates a very small valid PNG using raw bytes
  // For production, use proper icons
  const { execSync } = require('child_process');
  try {
    execSync(`python3 -c "
import struct, zlib, sys

def make_png(width, height, r, g, b):
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        crc = zlib.crc32(name + data) & 0xffffffff
        return c + struct.pack('>I', crc)
    
    sig = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    
    raw = []
    for y in range(height):
        row = b'\\x00' + bytes([r, g, b] * width)
        raw.append(row)
    
    compressed = zlib.compress(b''.join(raw))
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')
    
    return sig + ihdr + idat + iend

data = make_png(${size}, ${size}, 88, 166, 255)
sys.stdout.buffer.write(data)
" > "${iconsDir}/${size}x${size}.png"
    `, { stdio: 'pipe' });
    console.log(`✓ Generated ${size}x${size}.png`);
  } catch (e) {
    // Fallback: copy a blank png
    console.log(`⚠ Could not generate ${size}x${size}.png (python3 required). Using placeholder.`);
    // Write a hardcoded minimal PNG bytes
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e00000000c4944415478016360f8cf000000020001e221bc330000000049454e44ae426082',
      'hex'
    );
    fs.writeFileSync(path.join(iconsDir, `${size}x${size}.png`), pngBytes);
  }
}

const sizes = [32, 128];
sizes.forEach(minimalPng);

// 128@2x is just a copy of 128
try {
  fs.copyFileSync(
    path.join(iconsDir, '128x128.png'),
    path.join(iconsDir, '128x128@2x.png')
  );
  console.log('✓ Generated 128x128@2x.png');
} catch {}

// icon.ico — minimal ICO (just copy the 32x32 png for now, tauri accepts png)
try {
  fs.copyFileSync(path.join(iconsDir, '32x32.png'), path.join(iconsDir, 'icon.ico'));
  console.log('✓ Generated icon.ico (placeholder)');
} catch {}

// icon.icns — tauri will generate this from the pngs during build
// Create a stub
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), Buffer.alloc(0));
console.log('✓ Created icon.icns stub');

console.log('\nDone! Replace src-tauri/icons/ with real icons for production.');
