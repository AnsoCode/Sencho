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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
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
                            <Label>Metric</Label>
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
                                <Label>Operator</Label>
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
                                <Label>Threshold</Label>
                                <Input
                                    type="number"
                                    value={threshold}
                                    onChange={e => setThreshold(e.target.value)}
                                    placeholder="e.g. 90"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Duration (mins)</Label>
                                <Input
                                    type="number"
                                    value={duration}
                                    onChange={e => setDuration(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Cooldown (mins)</Label>
                                <Input
                                    type="number"
                                    value={cooldown}
                                    onChange={e => setCooldown(e.target.value)}
                                />
                            </div>
                        </div>

                        <Button className="w-full mt-2" onClick={addAlert} disabled={isLoading}>
                            Add Rule
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
