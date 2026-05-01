interface SidebarBrandProps {
  isDarkMode: boolean;
}

export function SidebarBrand({ isDarkMode }: SidebarBrandProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-glass-border">
      <img
        src={isDarkMode ? '/sencho-logo-dark.png' : '/sencho-logo-light.png'}
        alt="Sencho Logo"
        className="w-7 h-7 shrink-0"
      />
      <div className="flex flex-col leading-none">
        <span className="font-mono text-[10px] leading-3 tracking-[0.18em] uppercase text-stat-subtitle">
          SENCHO · v{__APP_VERSION__}
        </span>
        <span className="font-display italic text-[22px] leading-none text-foreground mt-0.5">Sencho</span>
      </div>
    </div>
  );
}
