import { CommandInput } from '@/components/ui/command';

interface SidebarSearchProps {
  value: string;
  onValueChange: (v: string) => void;
}

function kbdHint(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+K';
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';
}

export function SidebarSearch({ value, onValueChange }: SidebarSearchProps) {
  return (
    <div className="px-4 py-2 flex-none relative">
      <CommandInput
        placeholder="Search stacks..."
        value={value}
        onValueChange={onValueChange}
        className="h-9 border-none"
      />
      <kbd className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-glass-border bg-glass-highlight px-1.5 font-mono text-[10px] text-muted-foreground">
        {kbdHint()}
      </kbd>
    </div>
  );
}
