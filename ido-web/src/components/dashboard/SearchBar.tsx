import { useState } from 'react';

interface SearchBarProps {
  page: 'inbox' | 'history';
  onSearch: (query: string) => void;
  onClose: () => void;
}

export function SearchBar({ page, onSearch, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('');

  return (
    <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-1.5">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-secondary flex-shrink-0">
        <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onSearch(e.target.value); }}
        placeholder={`Search ${page}…`}
        autoFocus
        className="flex-1 bg-transparent text-body text-text placeholder:text-secondary outline-none"
      />
      <button onClick={onClose} className="text-secondary hover:text-primary p-1">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
