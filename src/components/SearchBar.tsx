import React, { useEffect, useRef } from "react";

interface SearchBarProps {
  query: string;
  matchCount: number;
  currentMatch: number;
  onSearch: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({ query, matchCount, currentMatch, onSearch, onNext, onPrev, onClose }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="searchbar">
      <div className="searchbar-inner">
        <svg className="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.099zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/>
        </svg>
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.shiftKey ? onPrev() : onNext();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search... (Enter: next, Shift+Enter: prev)"
        />
        <span className="search-count">
          {matchCount > 0 ? `${currentMatch}/${matchCount}` : query ? "0/0" : ""}
        </span>
        <button className="search-nav-btn" onClick={onPrev} title="Previous (Shift+Enter)">↑</button>
        <button className="search-nav-btn" onClick={onNext} title="Next (Enter)">↓</button>
        <button className="search-close-btn" onClick={onClose} title="Close (Esc)">×</button>
      </div>
    </div>
  );
}
