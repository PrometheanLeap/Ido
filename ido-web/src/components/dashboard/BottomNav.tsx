interface BottomNavProps {
  page: 'inbox' | 'history';
  showSearch: boolean;
  onInbox: () => void;
  onToggleSearch: () => void;
  onHistory: () => void;
}

export function BottomNav({ page, showSearch, onInbox, onToggleSearch, onHistory }: BottomNavProps) {
  const navButton = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string) => (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center py-2 press ${active ? 'text-primary' : 'text-secondary hover:text-primary'}`}
    >
      <span className={`flex flex-col items-center rounded-2xl px-3 py-1 transition-all duration-200 ${active ? 'bg-primary/12' : ''}`}>
        {icon}
        <span className="text-label mt-0.5">{label}</span>
      </span>
    </button>
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 bg-base/90 backdrop-blur border-t border-border">
      <div className="max-w-2xl mx-auto flex">
        {navButton(page === 'inbox', onInbox,
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2 8L10 13L18 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>, 'Inbox')}

        {navButton(showSearch, onToggleSearch,
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>, 'Search')}

        {navButton(page === 'history', onHistory,
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.3" />
            <line x1="10" y1="5.5" x2="10" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="10" y1="10" x2="13" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>, 'History')}
      </div>
    </nav>
  );
}
