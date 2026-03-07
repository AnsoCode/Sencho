import { useEffect, useState, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RefreshCw, Activity, Terminal } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Metric {
    id: number;
    container_id: string;
    stack_name: string;
    cpu_percent: number;
    memory_mb: number;
    net_rx_mb: number;
    net_tx_mb: number;
    timestamp: number;
}

interface LogEntry {
    stackName: string;
    containerName: string;
    level: string;
    message: string;
    timestamp: number;
}

export function GlobalObservabilityView() {
    const [metrics, setMetrics] = useState<Metric[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [selectedStack, setSelectedStack] = useState<string>('all');
    const [selectedLevel, setSelectedLevel] = useState<string>('all');

    const fetchData = async () => {
        setLoading(true);
        try {
            const [metricsRes, logsRes] = await Promise.all([
                fetch('/api/metrics/historical'),
                fetch('/api/logs/global')
            ]);

            if (metricsRes.ok) {
                setMetrics(await metricsRes.json());
            }
            if (logsRes.ok) {
                setLogs(await logsRes.json());
            }
        } catch (error) {
            console.error('Failed to fetch observability data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000); // 30s auto-refresh
        return () => clearInterval(interval);
    }, []);

    // Aggregate metrics by timestamp (minute buckets) for the chart
    const chartData = useMemo(() => {
        const buckets: Record<string, { time: string; timestamp: number; cpu: number; ram: number }> = {};

        metrics.forEach(m => {
            // Bucket by minute (ignoring seconds)
            const date = new Date(m.timestamp);
            date.setSeconds(0, 0);
            const key = date.getTime() + '';

            if (!buckets[key]) {
                buckets[key] = {
                    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    timestamp: date.getTime(),
                    cpu: 0,
                    ram: 0
                };
            }
            buckets[key].cpu += m.cpu_percent;
            buckets[key].ram += m.memory_mb;
        });

        return Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
    }, [metrics]);

    const chartConfig = {
        cpu: { label: 'CPU Usage (%)', color: 'var(--chart-1)' },
        ram: { label: 'RAM Usage (MB)', color: 'var(--chart-2)' },
    };

    // Filter logs
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            if (selectedStack !== 'all' && log.stackName !== selectedStack) return false;
            if (selectedLevel !== 'all' && log.level !== selectedLevel) return false;
            return true;
        });
    }, [logs, selectedStack, selectedLevel]);

    const uniqueStacks = useMemo(() => {
        const stacks = new Set(logs.map(l => l.stackName));
        return Array.from(stacks).sort();
    }, [logs]);

    return (
        <div className="flex flex-col h-full bg-background text-foreground overflow-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Global Observability</h1>
                    <p className="text-muted-foreground mt-1">24-hour historical metrics and centralized logging.</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <Activity className="w-5 h-5 text-primary" />
                            <span>Aggregate CPU Usage</span>
                        </CardTitle>
                        <CardDescription>Total CPU percentage across all containers.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        {chartData.length > 0 ? (
                            <ChartContainer config={chartConfig} className="w-full h-full">
                                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="time" minTickGap={30} tickMargin={8} />
                                    <YAxis tickFormatter={(val) => `${val}%`} />
                                    <ChartTooltip content={<ChartTooltipContent />} />
                                    <Area
                                        type="monotone"
                                        dataKey="cpu"
                                        stroke="var(--color-cpu)"
                                        fill="var(--color-cpu)"
                                        fillOpacity={0.4}
                                    />
                                </AreaChart>
                            </ChartContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                No historical CPU data available.
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <Activity className="w-5 h-5 text-primary" />
                            <span>Aggregate Memory Usage</span>
                        </CardTitle>
                        <CardDescription>Total Memory (MB) allocated across all containers.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        {chartData.length > 0 ? (
                            <ChartContainer config={chartConfig} className="w-full h-full">
                                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="time" minTickGap={30} tickMargin={8} />
                                    <YAxis tickFormatter={(val) => `${val}MB`} />
                                    <ChartTooltip content={<ChartTooltipContent />} />
                                    <Area
                                        type="monotone"
                                        dataKey="ram"
                                        stroke="var(--color-ram)"
                                        fill="var(--color-ram)"
                                        fillOpacity={0.4}
                                    />
                                </AreaChart>
                            </ChartContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                No historical Memory data available.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Global Logs Section */}
            <Card className="flex-1 flex flex-col overflow-hidden min-h-[400px]">
                <CardHeader className="py-4 border-b">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                        <CardTitle className="flex items-center space-x-2">
                            <Terminal className="w-5 h-5 text-primary" />
                            <span>Unified Global Logs</span>
                        </CardTitle>

                        <div className="flex items-center space-x-4">
                            <Select value={selectedStack} onValueChange={setSelectedStack}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Filter by Stack" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Stacks</SelectItem>
                                    {uniqueStacks.map(s => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="Log Level" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Levels</SelectItem>
                                    <SelectItem value="INFO">INFO</SelectItem>
                                    <SelectItem value="WARN">WARN</SelectItem>
                                    <SelectItem value="ERROR">ERROR</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 overflow-hidden bg-black text-gray-300 flex-1 flex flex-col">
                    <ScrollArea className="flex-1 p-4 font-mono text-xs sm:text-sm">
                        {filteredLogs.length > 0 ? (
                            filteredLogs.map((log, idx) => (
                                <div key={idx} className="mb-1 leading-relaxed whitespace-pre-wrap break-all hover:bg-white/5 px-2 py-0.5 rounded -mx-2">
                                    <span className="text-gray-500 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                    <span className="text-blue-400 font-semibold mr-2">[{log.stackName}/{log.containerName}]</span>
                                    <span className={`mr-2 font-bold ${log.level === 'ERROR' ? 'text-red-500' : log.level === 'WARN' ? 'text-yellow-500' : 'text-green-500'}`}>
                                        {log.level}:
                                    </span>
                                    <span className={log.level === 'ERROR' ? 'text-red-300' : 'text-gray-300'}>{log.message}</span>
                                </div>
                            ))
                        ) : (
                            <div className="text-gray-500 italic p-4 text-center">No logs found matching criteria.</div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
