import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

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
): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const usedSlugs = new Map<string, number>();

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

  const rawHtml = marked.parse(content) as string;

  const html = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: [
      "id", "data-relative", "data-src", "data-file-href",
      "data-base-path", "data-code", "data-href", "rel", "loading", "type",
    ],
    ADD_TAGS: ["iframe"],
    FORCE_BODY: false,
  });

  return { html, headings };
}
