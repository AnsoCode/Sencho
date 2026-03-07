import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RefreshCw, Download, Trash2, Search, Filter } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LogEntry {
    stackName: string;
    containerName: string;
    source: string;
    level: string;
    message: string;
    timestampStr: string;
    timestampMs: number;
}

export function GlobalObservabilityView() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedStacks, setSelectedStacks] = useState<string[]>([]);
    const [streamFilter, setStreamFilter] = useState<'ALL' | 'STDOUT' | 'STDERR'>('ALL');
    const [clearedAt, setClearedAt] = useState<number>(0);

    const fetchData = async () => {
        setLoading(true);
        try {
            const logsRes = await fetch('/api/logs/global');
            if (logsRes.ok) {
                setLogs(await logsRes.json());
            }
        } catch (error) {
            console.error('Failed to fetch global logs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, []);

    const uniqueStacks = useMemo(() => {
        const stacks = new Set(logs.map(l => l.stackName));
        return Array.from(stacks).sort();
    }, [logs]);

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

    const handleDownload = () => {
        if (filteredLogs.length === 0) return;
        const blob = new Blob([filteredLogs.map(l => `${l.timestampStr} [${l.stackName} | ${l.containerName}] ${l.level}: ${l.message}`).join('\n')], { type: 'text/plain;charset=utf-8' });
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
        <div className="flex flex-col h-full bg-background text-foreground overflow-hidden p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Global Logs</h1>
                    <p className="text-muted-foreground mt-1">Centralized log viewer across all containers.</p>
                </div>
                <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm" onClick={handleClearLogs}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownload} disabled={filteredLogs.length === 0}>
                        <Download className="w-4 h-4 mr-2" />
                        Download
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            <Card className="flex-1 flex flex-col overflow-hidden min-h-[400px] border-muted">
                {/* Action Bar */}
                <CardHeader className="py-3 px-4 border-b bg-muted/30">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search logs..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-9">
                                        <Filter className="w-4 h-4 mr-2" />
                                        Stacks ({selectedStacks.length === 0 ? 'All' : selectedStacks.length})
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    {uniqueStacks.map(stack => (
                                        <DropdownMenuCheckboxItem
                                            key={stack}
                                            checked={selectedStacks.includes(stack)}
                                            onCheckedChange={() => handleStackToggle(stack)}
                                        >
                                            {stack}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                    {uniqueStacks.length === 0 && (
                                        <div className="px-2 py-1.5 text-sm text-muted-foreground">No stacks found</div>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <Select value={streamFilter} onValueChange={(val: any) => setStreamFilter(val)}>
                                <SelectTrigger className="w-[120px] h-9">
                                    <SelectValue placeholder="Stream" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Streams</SelectItem>
                                    <SelectItem value="STDOUT">STDOUT</SelectItem>
                                    <SelectItem value="STDERR">STDERR</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>

                {/* Terminal Window */}
                <CardContent className="p-0 overflow-hidden bg-[#0A0A0A] text-gray-300 flex-1 flex flex-col relative">
                    {loading && logs.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                            <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                        </div>
                    )}
                    <ScrollArea className="flex-1 p-4">
                        {filteredLogs.length > 0 ? (
                            filteredLogs.map((log, idx) => (
                                <div key={idx} className="mb-1 leading-relaxed whitespace-pre-wrap break-all hover:bg-white/5 px-2 py-0.5 rounded -mx-2 font-mono text-xs">
                                    <span className="text-gray-500 mr-2">{log.timestampStr}</span>
                                    <span className="text-blue-400 font-semibold mr-2">[{log.stackName} | {log.containerName}]</span>
                                    <span className={`mr-2 font-bold ${log.level === 'ERROR' ? 'text-red-500' : log.level === 'WARN' ? 'text-yellow-500' : 'text-green-500'}`}>{log.level}:</span>
                                    <span className={log.source === 'STDERR' ? 'text-red-300' : 'text-gray-300'}>{log.message}</span>
                                </div>
                            ))
                        ) : (
                            <div className="text-gray-500 italic p-4 text-center mt-10">
                                {logs.length === 0 ? "No active logs found." : "No logs match the current filters."}
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
