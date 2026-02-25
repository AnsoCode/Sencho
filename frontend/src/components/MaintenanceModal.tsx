import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from './ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { apiFetch } from '@/lib/api';
import { Trash2, AlertTriangle, MonitorX, PackageMinus, Network } from 'lucide-react';

interface MaintenanceModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ContainerInfo {
    Id: string;
    Names: string[];
    State: string;
    Status: string;
    Image: string;
}

export default function MaintenanceModal({ isOpen, onClose }: MaintenanceModalProps) {
    const [activeTab, setActiveTab] = useState<'ghosts' | 'system'>('ghosts');

    // Ghost Hunter state
    const [orphans, setOrphans] = useState<Record<string, ContainerInfo[]>>({});
    const [isLoadingOrphans, setIsLoadingOrphans] = useState(false);
    const [selectedOrphans, setSelectedOrphans] = useState<string[]>([]);
    const [isPurging, setIsPurging] = useState(false);

    // System Cleanup state
    const [isPruning, setIsPruning] = useState(false);
    const [pruneResult, setPruneResult] = useState<{ message: string; stdout: string; stderr: string } | null>(null);

    useEffect(() => {
        if (isOpen && activeTab === 'ghosts') {
            fetchOrphans();
        } else {
            setPruneResult(null); // Reset when tab changes
        }
    }, [isOpen, activeTab]);

    const fetchOrphans = async () => {
        setIsLoadingOrphans(true);
        try {
            const res = await apiFetch('/system/orphans');
            const data = await res.json();
            setOrphans(data);
            setSelectedOrphans([]);
        } catch (error) {
            console.error('Failed to fetch orphans:', error);
        } finally {
            setIsLoadingOrphans(false);
        }
    };

    const toggleOrphanSelection = (containerId: string) => {
        setSelectedOrphans(prev =>
            prev.includes(containerId)
                ? prev.filter(id => id !== containerId)
                : [...prev, containerId]
        );
    };

    const selectAllOrphans = () => {
        const allIds = Object.values(orphans).flat().map(c => c.Id);
        if (selectedOrphans.length === allIds.length) {
            setSelectedOrphans([]);
        } else {
            setSelectedOrphans(allIds);
        }
    };

    const purgeSelectedOrphans = async () => {
        if (selectedOrphans.length === 0) return;

        if (!confirm(`Are you sure you want to forcefully remove ${selectedOrphans.length} ghost container(s) ? `)) {
            return;
        }

        setIsPurging(true);
        try {
            const res = await apiFetch('/system/prune/orphans', {
                method: 'POST',
                body: JSON.stringify({ containerIds: selectedOrphans })
            });
            if (!res.ok) throw new Error('Purge failed');

            await fetchOrphans(); // Refresh the list
        } catch (error) {
            console.error('Failed to purge orphans:', error);
            alert('Failed to purge selected containers.');
        } finally {
            setIsPurging(false);
        }
    };

    const pruneSystem = async (target: 'containers' | 'images' | 'networks') => {
        if (!confirm(`Are you sure you want to prune all unused ${target}? This cannot be undone.`)) {
            return;
        }

        setIsPruning(true);
        setPruneResult(null);
        try {
            const res = await apiFetch('/system/prune/system', {
                method: 'POST',
                body: JSON.stringify({ target })
            });
            const data = await res.json();
            setPruneResult(data);
        } catch (error) {
            console.error(`Failed to prune ${target}: `, error);
            alert(`Failed to prune ${target}.`);
        } finally {
            setIsPruning(false);
        }
    };

    const totalOrphansCount = Object.values(orphans).flat().length;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-yellow-500" />
                        System Janitor
                    </DialogTitle>
                    <DialogDescription>
                        Clean up orphaned containers and perform generic system maintenance.
                    </DialogDescription>
                </DialogHeader>

                <Tabs
                    value={activeTab}
                    onValueChange={(val) => setActiveTab(val as 'ghosts' | 'system')}
                    className="flex-1 flex flex-col min-h-0 mt-4"
                >
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="ghosts">Ghost Hunter</TabsTrigger>
                        <TabsTrigger value="system">System Cleanup</TabsTrigger>
                    </TabsList>

                    <TabsContent value="ghosts" className="flex-1 overflow-auto flex flex-col mt-4 border rounded-lg p-4 bg-muted/20">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                Detected Orphan Stacks <Badge variant="secondary">{totalOrphansCount}</Badge>
                            </h3>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={fetchOrphans}
                                    disabled={isLoadingOrphans}
                                >
                                    Refresh
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={purgeSelectedOrphans}
                                    disabled={selectedOrphans.length === 0 || isPurging}
                                >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    {isPurging ? 'Purging...' : `Purge Selected(${selectedOrphans.length})`}
                                </Button>
                            </div>
                        </div>

                        {isLoadingOrphans ? (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground">
                                Hunting for ghosts...
                            </div>
                        ) : totalOrphansCount === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                                <MonitorX className="w-12 h-12 mb-2 opacity-50" />
                                <p>No orphaned containers detected.</p>
                                <p className="text-xs mt-1">Your system is clean!</p>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto">
                                <div className="mb-2 flex items-center gap-2 px-2">
                                    <input
                                        type="checkbox"
                                        onChange={selectAllOrphans}
                                        checked={selectedOrphans.length === totalOrphansCount && totalOrphansCount > 0}
                                        className="rounded border-gray-300 focus:ring-primary"
                                    />
                                    <span className="text-sm font-medium">Select All</span>
                                </div>

                                {Object.entries(orphans).map(([project, containers]) => (
                                    <div key={project} className="mb-6 last:mb-0 bg-card rounded-lg border shadow-sm overflow-hidden">
                                        <div className="bg-muted px-4 py-2 border-b font-medium text-sm flex items-center gap-2">
                                            <span className="w-3 h-3 rounded-full bg-red-500/80"></span>
                                            Project: {project}
                                        </div>
                                        <div className="divide-y">
                                            {containers.map(container => (
                                                <div key={container.Id} className="flex items-center gap-4 p-3 hover:bg-muted/50 transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedOrphans.includes(container.Id)}
                                                        onChange={() => toggleOrphanSelection(container.Id)}
                                                        className="rounded border-gray-300"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-sm font-semibold truncate">
                                                                {container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12)}
                                                            </span>
                                                            <Badge variant={container.State === 'running' ? 'default' : 'secondary'} className="text-[10px] h-4">
                                                                {container.State}
                                                            </Badge>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground truncate mt-1">
                                                            Image: {container.Image}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="system" className="flex-1 mt-4 p-4 border rounded-lg bg-card">
                        <h3 className="text-lg font-semibold mb-6">Global Docker Pruning</h3>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                            <Button
                                variant="outline"
                                className="h-24 flex flex-col items-center justify-center gap-2"
                                onClick={() => pruneSystem('containers')}
                                disabled={isPruning}
                            >
                                <MonitorX className="w-6 h-6 text-orange-500" />
                                <div className="text-center">
                                    <div className="font-bold">Prune Containers</div>
                                    <div className="text-xs text-muted-foreground font-normal">Removes all stopped containers</div>
                                </div>
                            </Button>

                            <Button
                                variant="outline"
                                className="h-24 flex flex-col items-center justify-center gap-2"
                                onClick={() => pruneSystem('images')}
                                disabled={isPruning}
                            >
                                <PackageMinus className="w-6 h-6 text-blue-500" />
                                <div className="text-center">
                                    <div className="font-bold">Prune Images</div>
                                    <div className="text-xs text-muted-foreground font-normal">Removes unused & dangling images</div>
                                </div>
                            </Button>

                            <Button
                                variant="outline"
                                className="h-24 flex flex-col items-center justify-center gap-2"
                                onClick={() => pruneSystem('networks')}
                                disabled={isPruning}
                            >
                                <Network className="w-6 h-6 text-green-500" />
                                <div className="text-center">
                                    <div className="font-bold">Prune Networks</div>
                                    <div className="text-xs text-muted-foreground font-normal">Removes all unused networks</div>
                                </div>
                            </Button>
                        </div>

                        {pruneResult && (
                            <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-x-auto whitespace-pre-wrap">
                                <div className="font-bold mb-2">Result:</div>
                                <div className="text-green-600 dark:text-green-400">{pruneResult.message}</div>
                                {pruneResult.stdout && <div className="mt-2 text-foreground">{pruneResult.stdout}</div>}
                                {pruneResult.stderr && <div className="mt-2 text-red-500">{pruneResult.stderr}</div>}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
