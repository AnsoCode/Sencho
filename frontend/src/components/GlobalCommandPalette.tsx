import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { Search } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useNodes, type Node } from '@/context/NodeContext';
import { cn } from '@/lib/utils';
import {
    useCrossNodeStackSearch,
    type StackHit,
    type StackStatus,
} from '@/hooks/useCrossNodeStackSearch';
import type { TopBarNavItem } from './TopBar';

const MAX_STACK_HITS = 50;

const statusDot: Record<StackStatus, string> = {
    running: 'bg-success',
    exited: 'bg-muted-foreground',
    unknown: 'bg-muted-foreground/60',
};

interface PaletteState {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
}

const PaletteContext = createContext<PaletteState | null>(null);

export function GlobalCommandPaletteProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                // Let cmdk's own Ctrl+K handling take precedence when focus is already inside a palette
                const target = e.target as HTMLElement | null;
                if (target?.closest('[cmdk-root]')) return;
                e.preventDefault();
                setOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const value = useMemo<PaletteState>(
        () => ({ open, setOpen, toggle: () => setOpen(prev => !prev) }),
        [open],
    );

    return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

function usePaletteState(): PaletteState {
    const ctx = useContext(PaletteContext);
    if (!ctx) throw new Error('usePaletteState must be used within GlobalCommandPaletteProvider');
    return ctx;
}

export function GlobalCommandPaletteTrigger() {
    const { setOpen } = usePaletteState();
    return (
        <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open search (Ctrl+K)"
            title="Search (Ctrl+K)"
            className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg',
                'text-foreground/80 hover:bg-accent hover:text-foreground transition-colors',
            )}
        >
            <Search className="h-4 w-4" strokeWidth={1.5} />
        </button>
    );
}

interface GlobalCommandPaletteProps {
    navItems: TopBarNavItem[];
    onNavigate: (value: string) => void;
    onSelectStack: (node: Node, filename: string) => void;
}

export function GlobalCommandPalette({ navItems, onNavigate, onSelectStack }: GlobalCommandPaletteProps) {
    const { open, setOpen } = usePaletteState();
    const { nodes, activeNode, setActiveNode } = useNodes();
    const [query, setQuery] = useState('');

    const { hits: remoteHits, loading: stacksLoading } = useCrossNodeStackSearch({
        query,
        enabled: open,
    });
    const stackHits = useMemo(() => remoteHits.slice(0, MAX_STACK_HITS), [remoteHits]);

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
    }, [setOpen]);

    const handleSelectNav = useCallback((value: string) => {
        handleOpenChange(false);
        onNavigate(value);
    }, [handleOpenChange, onNavigate]);

    const handleSelectNode = useCallback((node: Node) => {
        handleOpenChange(false);
        setActiveNode(node);
    }, [handleOpenChange, setActiveNode]);

    const handleSelectStack = useCallback((hit: StackHit) => {
        const node = nodes.find(n => n.id === hit.nodeId);
        if (!node) return;
        handleOpenChange(false);
        onSelectStack(node, hit.file);
    }, [handleOpenChange, nodes, onSelectStack]);

    const visibleNodes = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return nodes;
        return nodes.filter(n => n.name.toLowerCase().includes(q));
    }, [nodes, query]);

    return (
        <CommandDialog open={open} onOpenChange={handleOpenChange}>
            <VisuallyHidden>
                <DialogTitle>Search</DialogTitle>
                <DialogDescription>Jump to a page, node, or stack</DialogDescription>
            </VisuallyHidden>
            <CommandInput
                placeholder="Search the app..."
                value={query}
                onValueChange={setQuery}
            />
            <CommandList>
                <CommandEmpty>
                    <span aria-live="polite">
                        {stacksLoading ? 'Searching...' : 'No results.'}
                    </span>
                </CommandEmpty>

                <CommandGroup heading="Pages">
                    {navItems.map(({ value, label, icon: Icon }) => (
                        <CommandItem
                            key={`nav-${value}`}
                            value={`nav ${label} ${value}`}
                            onSelect={() => handleSelectNav(value)}
                        >
                            <Icon className="h-4 w-4" strokeWidth={1.5} />
                            <span>{label}</span>
                        </CommandItem>
                    ))}
                </CommandGroup>

                {visibleNodes.length > 0 && (
                    <CommandGroup heading="Nodes">
                        {visibleNodes.map(node => {
                            const isActive = node.id === activeNode?.id;
                            const offline = node.status === 'offline';
                            return (
                                <CommandItem
                                    key={`node-${node.id}`}
                                    value={`node ${node.name}`}
                                    onSelect={() => handleSelectNode(node)}
                                    disabled={offline}
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            'h-2 w-2 rounded-full',
                                            offline ? 'bg-muted-foreground' : 'bg-success',
                                        )}
                                    />
                                    <span className="flex-1">{node.name}</span>
                                    {isActive && (
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stat-subtitle">
                                            Active
                                        </span>
                                    )}
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>
                )}

                {stackHits.length > 0 && (
                    <CommandGroup heading="Stacks">
                        {stackHits.map(hit => (
                            <CommandItem
                                key={`stack-${hit.nodeId}-${hit.file}`}
                                value={`stack ${hit.file} ${hit.nodeName}`}
                                onSelect={() => handleSelectStack(hit)}
                            >
                                <span aria-hidden className={cn('h-2 w-2 rounded-full', statusDot[hit.status])} />
                                <span className="flex-1 truncate">{hit.file}</span>
                                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stat-subtitle">
                                    {hit.nodeName}
                                </span>
                            </CommandItem>
                        ))}
                        {remoteHits.length > MAX_STACK_HITS && (
                            <div className="px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-stat-subtitle">
                                Showing first {MAX_STACK_HITS} of {remoteHits.length}
                            </div>
                        )}
                    </CommandGroup>
                )}
            </CommandList>
        </CommandDialog>
    );
}
