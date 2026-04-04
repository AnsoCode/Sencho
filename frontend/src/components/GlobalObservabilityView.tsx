import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RefreshCw, Download, Trash2, Search, Filter } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useNodes } from '@/context/NodeContext';

// Max entries held in React state. Bounds SSE-mode memory growth.
const MAX_LOG_ENTRIES = 2000;
// Max rows rendered as DOM nodes at once. Prevents the renderer from
// creating thousands of DOM nodes that OOM the browser on RAM-constrained hosts.
const MAX_DISPLAY_ROWS = 300;


interface LogEntry {
    stackName: string;
    containerName: string;
    source: string;
    level: string;
    message: string;
    timestampMs: number;
    // Assigned client-side at ingestion. Gives React a stable, collision-free
    // key so the slice window can shift without touching existing DOM nodes.
    _id: number;
}

export function GlobalObservabilityView() {
    const { activeNode } = useNodes();
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [allStacks, setAllStacks] = useState<string[]>([]);

    // Settings state
    const [devMode, setDevMode] = useState(false);
    const [pollRate, setPollRate] = useState(5);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStacks, setSelectedStacks] = useState<string[]>([]);
    const [streamFilter, setStreamFilter] = useState<'ALL' | 'STDOUT' | 'STDERR'>('ALL');
    const [clearedAt, setClearedAt] = useState<number>(0);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

    // SSE throttle buffer
    const bufferRef = useRef<LogEntry[]>([]);
    // Monotonic counter for stable React keys. Incremented once per log entry
    // at ingestion so duplicate-content lines never share a key.
    const logIdRef = useRef(0);

    // Fetch settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await apiFetch('/settings');
                if (res.ok) {
                    const data = await res.json();
                    setDevMode(data.developer_mode === '1');
                    setPollRate(parseInt(data.global_logs_refresh || '5', 10));
                }
            } catch (e) {
                console.error('Failed to fetch settings:', e);
            }
        };
        fetchSettings();
    }, []);

    // Fetch definitive stack list from the filesystem, independent of log data
    useEffect(() => {
        const fetchStacks = async () => {
            try {
                const res = await apiFetch('/stacks');
                if (res.ok) {
                    const stacks: string[] = await res.json();
                    setAllStacks(stacks.sort());
                }
            } catch (err) {
                console.error('Failed to fetch stacks:', err);
            }
        };
        fetchStacks();
    }, []);

    // Data fetching: Polling (standard) vs SSE (dev mode)
    useEffect(() => {
        if (devMode) {
            // SSE mode
            const activeNodeId = localStorage.getItem('sencho-active-node') || '';
            const eventSource = new EventSource(`/api/logs/global/stream?nodeId=${activeNodeId}`);

            eventSource.onmessage = (event) => {
                try {
                    const entry: LogEntry = JSON.parse(event.data);
                    entry._id = ++logIdRef.current;
                    bufferRef.current.push(entry);
                } catch { /* ignore parse errors */ }
            };

            eventSource.onerror = () => {
                // SSE will auto-reconnect, no action needed
            };

            // 500ms throttle: flush buffer into React state
            const flushInterval = setInterval(() => {
                if (bufferRef.current.length > 0) {
                    const batch = bufferRef.current.splice(0);
                    setLogs(prev => {
                        const merged = [...prev, ...batch];
                        merged.sort((a, b) => a.timestampMs - b.timestampMs);
                        return merged.slice(-MAX_LOG_ENTRIES);
                    });
                }
            }, 500);

            setLoading(false);

            return () => {
                eventSource.close();
                clearInterval(flushInterval);
                bufferRef.current = [];
            };
        } else {
            // Standard polling mode
            const fetchData = async () => {
                setLoading(true);
                try {
                    const logsRes = await apiFetch('/logs/global');
                    if (logsRes.ok) {
                        const data: LogEntry[] = await logsRes.json();
                        // Stamp each entry with a monotonic _id at ingestion so React
                        // has a stable, collision-free key for every log line.
                        data.forEach(entry => { entry._id = ++logIdRef.current; });
                        setLogs(data);
                    }
                } catch (error) {
                    console.error('Failed to fetch global logs:', error);
                } finally {
                    setLoading(false);
                }
            };

            fetchData();
            const interval = setInterval(fetchData, pollRate * 1000);
            return () => clearInterval(interval);
        }
    }, [devMode, pollRate]);

    const handleStackToggle = (stack: string) => {
        setSelectedStacks(prev =>
            prev.includes(stack) ? prev.filter(s => s !== stack) : [...prev, stack]
        );
    };

    const handleClearLogs = () => {
        setClearedAt(Date.now());
    };

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            if (log.timestampMs < clearedAt) return false;
            if (selectedStacks.length > 0 && !selectedStacks.includes(log.stackName)) return false;
            if (streamFilter !== 'ALL' && log.source !== streamFilter) return false;
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                return log.message.toLowerCase().includes(query) ||
                    log.containerName.toLowerCase().includes(query) ||
                    log.stackName.toLowerCase().includes(query);
            }
            return true;
        });
    }, [logs, selectedStacks, streamFilter, searchQuery, clearedAt]);

    useEffect(() => {
        if (isAutoScrollEnabled && bottomRef.current) {
            // Use instant scroll to avoid stacking smooth-scroll animations on every
            // 5-second poll cycle, which wastes layout work and renderer memory.
            bottomRef.current.scrollIntoView({ behavior: 'instant' });
        }
    }, [filteredLogs, isAutoScrollEnabled]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
        setIsAutoScrollEnabled(isAtBottom);
    }, []);

    const handleDownload = () => {
        if (filteredLogs.length === 0) return;
        const blob = new Blob([filteredLogs.map(l => `[${new Date(l.timestampMs).toLocaleTimeString([], { hour12: true })}] [${l.containerName}] ${l.level}: ${l.message}`).join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sencho-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col h-full w-full bg-background text-foreground">
            {/* Permanent Toolbar */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
                {activeNode?.type === 'remote' && (
                    <div className="flex items-center gap-1.5 border border-border rounded-md px-2.5 py-1 text-xs text-muted-foreground mr-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0" />
                        {activeNode.name}
                    </div>
                )}

                <div className="relative flex items-center">
                    <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search logs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-8 text-sm w-48 bg-transparent"
                    />
                </div>

                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-sm">
                            <Filter className="w-3.5 h-3.5 mr-2" />
                            Stacks ({selectedStacks.length === 0 ? 'All' : selectedStacks.length})
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                        {allStacks.map(stack => (
                            <DropdownMenuCheckboxItem
                                key={stack}
                                checked={selectedStacks.includes(stack)}
                                onCheckedChange={() => handleStackToggle(stack)}
                            >
                                {stack}
                            </DropdownMenuCheckboxItem>
                        ))}
                        {allStacks.length === 0 && (
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">No stacks found</div>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                <Select value={streamFilter} onValueChange={(val) => setStreamFilter(val as 'ALL' | 'STDOUT' | 'STDERR')}>
                    <SelectTrigger className="w-[110px] h-8 text-sm">
                        <SelectValue placeholder="Stream" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">All Streams</SelectItem>
                        <SelectItem value="STDOUT">STDOUT</SelectItem>
                        <SelectItem value="STDERR">STDERR</SelectItem>
                    </SelectContent>
                </Select>

                <div className="flex-1" />

                {devMode && (
                    <div className="flex items-center px-2 text-xs text-success font-mono animate-pulse">
                        ● LIVE
                    </div>
                )}

                <Button variant="outline" size="sm" onClick={handleClearLogs} className="h-8 text-sm px-2">
                    <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={filteredLogs.length === 0} className="h-8 text-sm px-2">
                    <Download className="w-3.5 h-3.5" />
                </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 relative bg-background" onScroll={handleScroll}>
                {loading && logs.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
                        <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                    </div>
                )}
                {filteredLogs.length > 0 ? (
                    <>
                        {filteredLogs.length > MAX_DISPLAY_ROWS && (
                            <div className="text-muted-foreground italic text-xs text-center mb-3 py-1 border-b border-border">
                                Showing last {MAX_DISPLAY_ROWS} of {filteredLogs.length} matching entries. Use filters or clear logs to see earlier entries.
                            </div>
                        )}
                        {filteredLogs.slice(-MAX_DISPLAY_ROWS).map((log) => (
                            <div key={log._id} className="mb-1 leading-relaxed whitespace-pre-wrap break-all hover:bg-accent/50 px-2 py-0.5 rounded -mx-2 font-mono text-xs">
                                <span className="text-muted-foreground mr-2">[{new Date(log.timestampMs).toLocaleTimeString([], { hour12: true })}]</span>
                                <span className="text-info font-semibold mr-2">[{log.containerName}]</span>
                                <span className={`mr-2 font-medium ${log.level === 'ERROR' ? 'text-destructive' : log.level === 'WARN' ? 'text-warning' : 'text-success'}`}>{log.level}:</span>
                                <span className={log.source === 'STDERR' ? 'text-destructive/80' : 'text-foreground/80'}>{log.message}</span>
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </>
                ) : (
                    <div className="text-muted-foreground italic p-4 text-center mt-10">
                        {logs.length === 0 ? "No active logs found." : "No logs match the current filters."}
                    </div>
                )}
            </div>
        </div>
    );
}
