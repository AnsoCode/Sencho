import { useState, useEffect, useCallback, Fragment } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export function AuditLogView() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [searchFilter, setSearchFilter] = useState('');
    const [methodFilter, setMethodFilter] = useState('all');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const limit = 50;

    const buildFilterParams = useCallback(() => {
        const params = new URLSearchParams();
        if (searchFilter) params.set('search', searchFilter);
        if (methodFilter !== 'all') params.set('method', methodFilter);
        if (fromDate) params.set('from', String(new Date(fromDate).getTime()));
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
        } catch {
            // Silently fail - non-critical view
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
        if (code >= 400 && code < 500) return 'text-yellow-500';
        if (code >= 500) return 'text-red-500';
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
        } catch {
            toast.error('Export failed.');
        }
    };

    return (
        <div className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ScrollText className="w-5 h-5" />
                            <CardTitle>Audit Log</CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Download className="w-4 h-4 mr-2" />
                                        Export
                                        <ChevronDown className="w-3 h-3 ml-1" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleExport('json')}>Export as JSON</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
                                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
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
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search actions, paths, users..."
                                value={searchFilter}
                                onChange={(e) => { setSearchFilter(e.target.value); setPage(1); }}
                                className="pl-8"
                            />
                        </div>
                        <Select value={methodFilter} onValueChange={(v) => { setMethodFilter(v); setPage(1); }}>
                            <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder="Method" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Methods</SelectItem>
                                <SelectItem value="POST">POST</SelectItem>
                                <SelectItem value="PUT">PUT</SelectItem>
                                <SelectItem value="DELETE">DELETE</SelectItem>
                                <SelectItem value="PATCH">PATCH</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            type="date"
                            value={fromDate}
                            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                            className="w-[150px]"
                            placeholder="From"
                        />
                        <Input
                            type="date"
                            value={toDate}
                            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                            className="w-[150px]"
                            placeholder="To"
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
                                                <TableCell className="text-xs text-muted-foreground font-mono">
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
                                                <TableCell className={`text-sm font-mono ${statusColor(entry.status_code)}`}>
                                                    {entry.status_code}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
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
                                                                <span className="font-mono text-xs">{entry.ip_address || '-'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground text-xs block">Node ID</span>
                                                                <span className="font-mono text-xs">{entry.node_id ?? 'Local'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground text-xs block">Entry ID</span>
                                                                <span className="font-mono text-xs">#{entry.id}</span>
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
                            <p className="text-sm text-muted-foreground">
                                Page {page} of {totalPages}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                                    <ChevronLeft className="w-4 h-4" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
