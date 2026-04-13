import { useState, useEffect, useCallback, Fragment } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronLeft, ChevronRight, Search, ScrollText, RefreshCw, Download, ChevronDown } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';

interface AuditEntry {
    id: number;
    timestamp: number;
    username: string;
    method: string;
    path: string;
    status_code: number;
    node_id: number | null;
    ip_address: string;
    summary: string;
}

const methodOptions = [
    { value: 'all', label: 'All Methods' },
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'PATCH', label: 'PATCH' },
];

export function AuditLogView() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [searchFilter, setSearchFilter] = useState('');
    const [methodFilter, setMethodFilter] = useState('all');
    const [fromDate, setFromDate] = useState<Date | undefined>();
    const [toDate, setToDate] = useState<Date | undefined>();
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const limit = 50;

    const buildFilterParams = useCallback(() => {
        const params = new URLSearchParams();
        if (searchFilter) params.set('search', searchFilter);
        if (methodFilter !== 'all') params.set('method', methodFilter);
        if (fromDate) {
            const start = new Date(fromDate);
            start.setHours(0, 0, 0, 0);
            params.set('from', String(start.getTime()));
        }
        if (toDate) {
            const end = new Date(toDate);
            end.setHours(23, 59, 59, 999);
            params.set('to', String(end.getTime()));
        }
        return params;
    }, [searchFilter, methodFilter, fromDate, toDate]);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params = buildFilterParams();
            params.set('page', String(page));
            params.set('limit', String(limit));

            const res = await apiFetch(`/audit-log?${params}`, { localOnly: true });
            if (res.ok) {
                const data = await res.json();
                setEntries(data.entries);
                setTotal(data.total);
            }
        } catch (err) {
            console.error('[AuditLog] Failed to fetch:', err);
        } finally {
            setLoading(false);
        }
    }, [page, buildFilterParams]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const methodBadgeVariant = (method: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
        switch (method) {
            case 'POST': return 'default';
            case 'PUT': case 'PATCH': return 'secondary';
            case 'DELETE': return 'destructive';
            default: return 'outline';
        }
    };

    const statusColor = (code: number): string => {
        if (code >= 200 && code < 300) return 'text-success';
        if (code >= 400 && code < 500) return 'text-warning';
        if (code >= 500) return 'text-destructive';
        return 'text-muted-foreground';
    };

    const handleExport = async (format: 'csv' | 'json') => {
        try {
            const params = buildFilterParams();
            params.set('format', format);
            const res = await apiFetch(`/audit-log/export?${params}`, { localOnly: true });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Export failed.');
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'json'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[AuditLog] Export failed:', err);
            toast.error('Export failed.');
        }
    };

    return (
        <div className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
            <Card className="rounded-lg border border-card-border border-t-card-border-top bg-card text-card-foreground shadow-card-bevel">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ScrollText className="w-5 h-5" strokeWidth={1.5} />
                            <CardTitle>Audit Log</CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="border-border">
                                        <Download className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                        Export
                                        <ChevronDown className="w-3 h-3 ml-1" strokeWidth={1.5} />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleExport('json')}>Export as JSON</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="outline" size="sm" className="border-border" onClick={fetchLogs} disabled={loading}>
                                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                                Refresh
                            </Button>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Track all mutating actions across your Sencho instance. {total > 0 && `${total} total entries.`}
                    </p>
                </CardHeader>
                <CardContent>
                    {/* Filters */}
                    <div className="flex items-center gap-3 mb-4 flex-wrap">
                        <div className="relative flex-1 min-w-[200px] max-w-xs">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                            <Input
                                placeholder="Search actions, paths, users..."
                                value={searchFilter}
                                onChange={(e) => { setSearchFilter(e.target.value); setPage(1); }}
                                className="pl-8"
                            />
                        </div>
                        <Combobox
                            options={methodOptions}
                            value={methodFilter}
                            onValueChange={(v) => { setMethodFilter(v || 'all'); setPage(1); }}
                            placeholder="Method"
                            className="w-[140px]"
                        />
                        <DatePicker
                            value={fromDate}
                            onChange={(d) => { setFromDate(d); setPage(1); }}
                            placeholder="From"
                            className="w-[160px]"
                        />
                        <DatePicker
                            value={toDate}
                            onChange={(d) => { setToDate(d); setPage(1); }}
                            placeholder="To"
                            className="w-[160px]"
                        />
                    </div>

                    {/* Table */}
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[170px]">Timestamp</TableHead>
                                    <TableHead className="w-[110px]">User</TableHead>
                                    <TableHead className="w-[80px]">Method</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead className="w-[70px]">Status</TableHead>
                                    <TableHead className="w-[70px]">Node</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading && entries.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            Loading...
                                        </TableCell>
                                    </TableRow>
                                ) : entries.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            No audit log entries found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    entries.map((entry) => (
                                        <Fragment key={entry.id}>
                                            <TableRow
                                                className="cursor-pointer hover:bg-muted/50"
                                                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                                            >
                                                <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                                                    {new Date(entry.timestamp).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="font-medium text-sm">
                                                    {entry.username}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={methodBadgeVariant(entry.method)} className="text-xs font-mono">
                                                        {entry.method}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {entry.summary}
                                                </TableCell>
                                                <TableCell className={`text-sm font-mono tabular-nums ${statusColor(entry.status_code)}`}>
                                                    {entry.status_code}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                                                    {entry.node_id ?? '-'}
                                                </TableCell>
                                            </TableRow>
                                            {expandedId === entry.id && (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="bg-muted/30 px-6 py-3">
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                            <div>
                                                                <span className="text-muted-foreground text-xs block">Request Path</span>
                                                                <span className="font-mono text-xs">{entry.path}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground text-xs block">IP Address</span>
                                                                <span className="font-mono text-xs tabular-nums">{entry.ip_address || '-'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground text-xs block">Node ID</span>
                                                                <span className="font-mono text-xs tabular-nums">{entry.node_id ?? 'Local'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground text-xs block">Entry ID</span>
                                                                <span className="font-mono text-xs tabular-nums">#{entry.id}</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </Fragment>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4">
                            <p className="text-sm text-muted-foreground font-mono tabular-nums">
                                Page {page} of {totalPages}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                                    <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                                    <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
