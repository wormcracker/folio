import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import yaml from "js-yaml";

// FIX: Code copy shows raw HTML spans instead of source text.
//
// Root cause: markedHighlight patches marked so renderer.code(code, lang) receives
// the ALREADY-highlighted HTML (with <span class="hljs-..."> tags), not the raw source.
// Previous fix did encodeURIComponent(code) on the highlighted HTML — wrong.
//
// Correct fix: use a FIFO queue. The highlight() callback fires with raw code in
// document order. renderer.code() fires in the same order. So we push raw code
// into a per-language queue in highlight(), then shift() it out in renderer.code().
const rawCodeQueues = new Map<string, string[]>();

function pushRaw(lang: string, code: string) {
  const key = lang || "plain";
  const q = rawCodeQueues.get(key) ?? [];
  q.push(code);
  rawCodeQueues.set(key, q);
}

function popRaw(lang: string): string {
  const key = lang || "plain";
  const q = rawCodeQueues.get(key);
  if (!q || q.length === 0) return "";
  const code = q.shift()!;
  if (q.length === 0) rawCodeQueues.delete(key);
  return code;
}

// Single registration of markedHighlight — captures raw code into the queue
marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      pushRaw(lang, code); // raw source, captured before hljs runs
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value; // highlighted HTML returned to marked
    },
  })
);

marked.setOptions({ gfm: true, breaks: true });

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export type Frontmatter = Record<string, unknown>;

// ── YAML frontmatter ─────────────────────────────────────────────────────
// Matches a leading `---` block, e.g.:
//   ---
//   title: My Note
//   tags: [a, b]
//   ---
//   # body...
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function extractFrontmatter(content: string): { data: Frontmatter | null; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { data: null, body: content };
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Frontmatter, body: content.slice(match[0].length) };
    }
    return { data: null, body: content };
  } catch {
    // Malformed YAML — leave the block as regular markdown rather than losing content.
    return { data: null, body: content };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `<div class="md-fm-tags">${value
      .map((v) => `<span class="md-fm-tag">${escapeHtml(String(v))}</span>`)
      .join("")}</div>`;
  }
  if (value && typeof value === "object") {
    return `<code class="md-fm-code">${escapeHtml(JSON.stringify(value))}</code>`;
  }
  if (typeof value === "boolean") {
    return `<span class="md-fm-bool md-fm-bool--${value}">${value ? "true" : "false"}</span>`;
  }
  return escapeHtml(String(value));
}

function renderFrontmatter(data: Frontmatter): string {
  const rows = Object.entries(data)
    .map(
      ([key, value]) =>
        `<tr><td class="md-fm-key">${escapeHtml(key)}</td><td class="md-fm-value">${renderFrontmatterValue(value)}</td></tr>`
    )
    .join("");
  return `<div class="md-frontmatter"><table class="md-fm-table"><tbody>${rows}</tbody></table></div>`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function parseMarkdown(
  content: string,
  filePath: string,
  _onLinkClick: (href: string, filePath: string) => void
): { html: string; headings: Heading[]; frontmatter: Frontmatter | null } {
  const headings: Heading[] = [];
  const usedSlugs = new Map<string, number>();

  const { data: frontmatter, body } = extractFrontmatter(content);

  // Clear queues before each parse
  rawCodeQueues.clear();

  const renderer = new marked.Renderer();

  renderer.heading = (text, level) => {
    const rawText = text.replace(/<[^>]+>/g, "");
    let slug = slugify(rawText);
    const count = usedSlugs.get(slug) ?? 0;
    usedSlugs.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;
    headings.push({ id: slug, text: rawText, level });
    return `<h${level} id="${slug}" class="md-heading">${text}</h${level}>`;
  };

  renderer.image = (href, title, text) => {
    if (href && !href.startsWith("http") && !href.startsWith("data:")) {
      return `<img src="" alt="${text ?? ""}" title="${title ?? ""}" data-relative="true" data-src="${href}" class="md-image" loading="lazy" />`;
    }
    return `<img src="${href}" alt="${text ?? ""}" title="${title ?? ""}" class="md-image" loading="lazy" />`;
  };

  renderer.link = (href, title, text) => {
    if (!href) return text;
    const isExternal = href.startsWith("http://") || href.startsWith("https://");
    const isAnchor = href.startsWith("#");
    const safeTitle = title ? ` title="${title}"` : "";
    if (isExternal) {
      return `<a href="#"${safeTitle} class="md-link external" data-href="${href}">${text}</a>`;
    }
    if (isAnchor) {
      return `<a href="${href}"${safeTitle} class="md-link anchor">${text}</a>`;
    }
    return `<a href="#"${safeTitle} class="md-link internal" data-file-href="${href}" data-base-path="${filePath}">${text}</a>`;
  };

  renderer.code = (highlightedHtml, lang) => {
    // highlightedHtml = already-highlighted HTML from markedHighlight
    // rawCode = original source, retrieved from our FIFO queue
    const rawCode = popRaw(lang ?? "");
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const encodedRaw = encodeURIComponent(rawCode);

    return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">${language}</span>
        <button class="copy-btn" data-code="${encodedRaw}" type="button">Copy</button>
      </div>
      <pre class="hljs"><code class="hljs language-${language}">${highlightedHtml}</code></pre>
    </div>`;
  };

  marked.use({ renderer });

  const bodyHtml = marked.parse(body) as string;
  const fmHtml = frontmatter ? renderFrontmatter(frontmatter) : "";
  const rawHtml = fmHtml + bodyHtml;

  const html = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: [
      "id", "data-relative", "data-src", "data-file-href",
      "data-base-path", "data-code", "data-href", "rel", "loading", "type",
    ],
    ADD_TAGS: ["iframe"],
    FORCE_BODY: false,
  });

  return { html, headings, frontmatter };
}
