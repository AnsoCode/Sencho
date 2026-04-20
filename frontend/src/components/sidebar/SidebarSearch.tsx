import { CommandInput } from '@/components/ui/command';

interface SidebarSearchProps {
  value: string;
  onValueChange: (v: string) => void;
}

export function SidebarSearch({ value, onValueChange }: SidebarSearchProps) {
  return (
    <div className="px-4 py-2 flex-none">
      <CommandInput
        placeholder="Search stacks..."
        value={value}
        onValueChange={onValueChange}
        className="h-9 border-none"
      />
    </div>
  );
}
