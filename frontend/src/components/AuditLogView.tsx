import { useState, useEffect, useCallback } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, Search, ScrollText, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';

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
    const [usernameFilter, setUsernameFilter] = useState('');
    const [methodFilter, setMethodFilter] = useState('all');
    const limit = 50;

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(limit) });
            if (usernameFilter) params.set('username', usernameFilter);
            if (methodFilter !== 'all') params.set('method', methodFilter);

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
    }, [page, usernameFilter, methodFilter]);

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
        if (code >= 200 && code < 300) return 'text-green-500';
        if (code >= 400 && code < 500) return 'text-yellow-500';
        if (code >= 500) return 'text-red-500';
        return 'text-muted-foreground';
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
                        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Track all mutating actions across your Sencho instance. {total > 0 && `${total} total entries.`}
                    </p>
                </CardHeader>
                <CardContent>
                    {/* Filters */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="relative flex-1 max-w-xs">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Filter by username..."
                                value={usernameFilter}
                                onChange={(e) => { setUsernameFilter(e.target.value); setPage(1); }}
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
                                        <TableRow key={entry.id}>
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
