import { useState, useEffect } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Trash2, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';

interface StackAlert {
    id?: number;
    stack_name: string;
    metric: string;
    operator: string;
    threshold: number;
    duration_mins: number;
    cooldown_mins: number;
}

interface StackAlertSheetProps {
    isOpen: boolean;
    onClose: () => void;
    stackName: string;
}

export function StackAlertSheet({ isOpen, onClose, stackName }: StackAlertSheetProps) {
    const [alerts, setAlerts] = useState<StackAlert[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // New Alert Form State
    const [metric, setMetric] = useState('cpu_percent');
    const [operator, setOperator] = useState('>');
    const [threshold, setThreshold] = useState('');
    const [duration, setDuration] = useState('5');
    const [cooldown, setCooldown] = useState('60');

    useEffect(() => {
        if (isOpen && stackName) {
            fetchAlerts();
        }
    }, [isOpen, stackName]);

    const fetchAlerts = async () => {
        try {
            const res = await apiFetch(`/alerts?stackName=${stackName}`);
            if (res.ok) {
                const data = await res.json();
                setAlerts(data);
            }
        } catch (e) {
            console.error('Failed to fetch alerts', e);
        }
    };

    const addAlert = async () => {
        if (!threshold) {
            toast.error('Please enter a threshold.');
            return;
        }

        setIsLoading(true);
        const newAlert = {
            stack_name: stackName,
            metric,
            operator,
            threshold: parseFloat(threshold),
            duration_mins: parseInt(duration, 10),
            cooldown_mins: parseInt(cooldown, 10)
        };

        try {
            const res = await apiFetch('/alerts', {
                method: 'POST',
                body: JSON.stringify(newAlert)
            });
            if (res.ok) {
                toast.success('Alert rule added.');
                setThreshold('');
                fetchAlerts();
            } else {
                toast.error('Failed to add alert rule.');
            }
        } catch (e) {
            toast.error('Network error.');
        } finally {
            setIsLoading(false);
        }
    };

    const deleteAlert = async (id: number) => {
        setIsLoading(true);
        try {
            const res = await apiFetch(`/alerts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Alert rule deleted.');
                fetchAlerts();
            } else {
                toast.error('Failed to delete alert rule.');
            }
        } catch (e) {
            toast.error('Network error.');
        } finally {
            setIsLoading(false);
        }
    };

    const metricLabels: Record<string, string> = {
        cpu_percent: 'CPU Usage (%)',
        memory_percent: 'Memory Usage (%)',
        memory_mb: 'Memory Usage (MB)',
        net_rx: 'Network In (MB)',
        net_tx: 'Network Out (MB)',
        restart_count: 'Restart Count'
    };

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="overflow-y-auto sm:max-w-[400px]">
                <SheetHeader>
                    <SheetTitle>Stack Alerts: {stackName}</SheetTitle>
                    <SheetDescription>
                        Configure metric thresholds to trigger notifications for this stack.
                    </SheetDescription>
                </SheetHeader>

                <TooltipProvider>
                    <div className="mt-6 space-y-6">
                        {/* List Existing Alerts */}
                        <div className="space-y-3">
                            <h4 className="text-sm font-semibold">Existing Rules</h4>
                            {alerts.length === 0 ? (
                                <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg text-center">
                                    No active alert rules for this stack.
                                </div>
                            ) : (
                                alerts.map(alert => (
                                    <div key={alert.id} className="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg border text-sm">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <span className="font-semibold text-foreground">
                                                    {metricLabels[alert.metric] || alert.metric} {alert.operator} {alert.threshold}
                                                </span>
                                                <div className="text-muted-foreground mt-1">
                                                    Trigger after {alert.duration_mins}m • Cooldown: {alert.cooldown_mins}m
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                                onClick={() => alert.id && deleteAlert(alert.id)}
                                                disabled={isLoading}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <hr />

                        {/* Add New Alert Form */}
                        <div className="space-y-4">
                            <h4 className="text-sm font-semibold">Add New Rule</h4>

                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label>Metric</Label>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p className="max-w-[200px] text-sm">The system resource or metric to monitor. Select from CPU, Memory, Network I/O, or Restarts.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <Select value={metric} onValueChange={setMetric}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(metricLabels).map(([val, label]) => (
                                            <SelectItem key={val} value={val}>{label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Label>Operator</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p className="max-w-[200px] text-sm">The comparison condition to trigger the alert against the threshold.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Select value={operator} onValueChange={setOperator}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value=">">Greater than</SelectItem>
                                            <SelectItem value=">=">Greater or eq</SelectItem>
                                            <SelectItem value="<">Less than</SelectItem>
                                            <SelectItem value="<=">Less or eq</SelectItem>
                                            <SelectItem value="==">Equals</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Label>Threshold</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p className="max-w-[200px] text-sm">The numerical value the metric needs to breach to trigger the conditions.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={threshold}
                                        onChange={e => {
                                            let val = e.target.value;
                                            if (val !== '' && Number(val) < 0) val = '0';
                                            setThreshold(val);
                                        }}
                                        placeholder="e.g. 90"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Label>Duration (mins)</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p className="max-w-[200px] text-sm">How long the metric must stay in breach of the threshold before sending an alert.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={duration}
                                        onChange={e => {
                                            let val = e.target.value;
                                            if (val !== '' && Number(val) < 0) val = '0';
                                            setDuration(val);
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Label>Cooldown (mins)</Label>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p className="max-w-[200px] text-sm">How long to wait before sending another alert if the stack continues to breach.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={cooldown}
                                        onChange={e => {
                                            let val = e.target.value;
                                            if (val !== '' && Number(val) < 0) val = '0';
                                            setCooldown(val);
                                        }}
                                    />
                                </div>
                            </div>

                            <Button className="w-full mt-2" onClick={addAlert} disabled={isLoading}>
                                Add Rule
                            </Button>
                        </div>
                    </div>
                </TooltipProvider>
            </SheetContent>
        </Sheet>
    );
}
