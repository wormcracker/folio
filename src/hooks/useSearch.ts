import { useState, useCallback, useRef } from "react";

export function useSearch(containerRef: React.RefObject<HTMLElement>) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const matchesRef = useRef<HTMLElement[]>([]);
  const currentRef = useRef(0);

  const clearHighlights = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.querySelectorAll("mark.search-highlight").forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
      }
    });
    matchesRef.current = [];
    setMatchCount(0);
    setCurrentMatch(0);
  }, [containerRef]);

  const highlight = useCallback(
    (q: string) => {
      clearHighlights();
      if (!q || !containerRef.current) return;

      const el = containerRef.current;
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        // Skip inside code blocks from the highlight pass (already highlighted by hljs)
        const parent = (node as Text).parentElement;
        if (parent?.closest("code, pre")) continue;
        if (regex.test((node as Text).textContent ?? "")) {
          textNodes.push(node as Text);
        }
        regex.lastIndex = 0;
      }

      const marks: HTMLElement[] = [];
      for (const tn of textNodes) {
        const text = tn.textContent ?? "";
        const frag = document.createDocumentFragment();
        let last = 0;
        let m: RegExpExecArray | null;
        regex.lastIndex = 0;
        while ((m = regex.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const mark = document.createElement("mark");
          mark.className = "search-highlight";
          mark.textContent = m[0];
          frag.appendChild(mark);
          marks.push(mark);
          last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        tn.parentNode?.replaceChild(frag, tn);
      }

      matchesRef.current = marks;
      setMatchCount(marks.length);
      if (marks.length > 0) {
        currentRef.current = 0;
        setCurrentMatch(1);
        scrollToMatch(0, marks);
      }
    },
    [clearHighlights, containerRef]
  );

  const scrollToMatch = (idx: number, marks?: HTMLElement[]) => {
    const m = (marks ?? matchesRef.current)[idx];
    if (!m) return;
    matchesRef.current.forEach((el) => el.classList.remove("search-highlight-active"));
    m.classList.add("search-highlight-active");
    m.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const next = useCallback(() => {
    const n = matchesRef.current.length;
    if (!n) return;
    const next = (currentRef.current + 1) % n;
    currentRef.current = next;
    setCurrentMatch(next + 1);
    scrollToMatch(next);
  }, []);

  const prev = useCallback(() => {
    const n = matchesRef.current.length;
    if (!n) return;
    const prev = (currentRef.current - 1 + n) % n;
    currentRef.current = prev;
    setCurrentMatch(prev + 1);
    scrollToMatch(prev);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    clearHighlights();
    setQuery("");
  }, [clearHighlights]);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (!q) { clearHighlights(); return; }
      highlight(q);
    },
    [highlight, clearHighlights]
  );

  return { query, matchCount, currentMatch, isOpen, open, close, search, next, prev };
}
