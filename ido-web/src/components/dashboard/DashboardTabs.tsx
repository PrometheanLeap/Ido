interface SurfaceTypeTab {
  type: 'form' | 'approval' | 'notification';
  count: number;
  isActive: boolean;
}

const TAB_ICONS: Record<string, React.ReactNode> = {
  form: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="2" y="1.5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="0.9"/><line x1="3.5" y1="4" x2="8.5" y2="4" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/><line x1="3.5" y1="5.8" x2="8.5" y2="5.8" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/><line x1="3.5" y1="7.6" x2="6.5" y2="7.6" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/></svg>,
  approval: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="0.9"/><path d="M4.2 6l1.2 1.2 2.4-2.4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  notification: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4 2.8a2 2 0 014 0V6a2 2 0 01-4 0V2.8z" stroke="currentColor" strokeWidth="0.9"/><path d="M2.5 6.8a3.5 3.5 0 007 0" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/><circle cx="6" cy="9.5" r="0.6" fill="currentColor"/></svg>,
};

const ACCENT_VARS: Record<string, string> = {
  form: '--color-accent-form',
  approval: '--color-accent-approval',
  notification: '--color-accent-notification',
};

interface DashboardTabsProps {
  tabs: SurfaceTypeTab[];
  onToggle: (type: string) => void;
}

export function DashboardTabs({ tabs, onToggle }: DashboardTabsProps) {
  return (
    <div className="flex gap-2 pb-1.5" role="tablist" aria-label="Surface type filter">
      {tabs.map(({ type, count, isActive }) => {
        const accentVar = ACCENT_VARS[type];
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            role="tab"
            aria-selected={isActive}
            style={{
              borderColor: `var(${accentVar})`,
              color: isActive ? `var(${accentVar})` : undefined,
              backgroundColor: isActive ? `color-mix(in srgb, var(${accentVar}) 12%, transparent)` : undefined,
              boxShadow: isActive ? `0 2px 10px color-mix(in srgb, var(${accentVar}) 15%, transparent)` : undefined,
            }}
            className={`flex-1 flex flex-col items-center px-2 py-2 rounded-xl transition-all relative border press ${
              isActive ? 'font-semibold' : 'bg-surface text-secondary'
            }`}
          >
            <span className="absolute top-1 right-1.5 opacity-70" style={{ color: `var(${accentVar})` }}>
              {TAB_ICONS[type]}
            </span>
            <span className="text-heading font-semibold leading-none tabular-nums">{count}</span>
            <span className="text-label mt-0.5">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
          </button>
        );
      })}
    </div>
  );
}
