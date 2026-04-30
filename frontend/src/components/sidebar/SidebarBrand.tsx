interface SidebarBrandProps {
  isDarkMode: boolean;
}

export function SidebarBrand({ isDarkMode }: SidebarBrandProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-glass-border">
      <img
        src={isDarkMode ? '/sencho-logo-dark.png' : '/sencho-logo-light.png'}
        alt="Sencho Logo"
        className="w-7 h-7 shrink-0"
      />
      <div className="flex flex-col leading-none">
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-stat-subtitle">
          SENCHO · v{__APP_VERSION__}
        </span>
        <span className="font-serif italic text-[17px] text-foreground mt-0.5">Sencho</span>
      </div>
    </div>
  );
}
