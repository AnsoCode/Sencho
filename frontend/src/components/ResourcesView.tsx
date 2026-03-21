import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Trash2, HardDrive, Network, PackageMinus, MonitorX, PieChart as ChartIcon } from 'lucide-react';
import { useNodes } from '@/context/NodeContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatBytes } from '@/lib/utils';

interface UsageData {
    reclaimableImages: number;
    reclaimableContainers: number;
    reclaimableVolumes: number;
}
interface DockerImage {
    Id: string;
    RepoTags: string[];
    Size: number;
    Containers: number;
}
interface DockerVolume {
    Name: string;
    Driver: string;
    Mountpoint: string;
}
interface DockerNetwork {
    Id: string;
    Name: string;
    Driver: string;
    Scope: string;
}
interface OrphanContainer {
    Id: string;
    Names: string[];
    State: string;
    Status: string;
    Image: string;
}

export default function ResourcesView() {
    const { activeNode } = useNodes();
    const [usage, setUsage] = useState<UsageData | null>(null);
    const [images, setImages] = useState<DockerImage[]>([]);
    const [volumes, setVolumes] = useState<DockerVolume[]>([]);
    const [networks, setNetworks] = useState<DockerNetwork[]>([]);
    const [orphans, setOrphans] = useState<Record<string, OrphanContainer[]>>({});

    const [isLoading, setIsLoading] = useState(true);
    const [isActioning, setIsActioning] = useState(false);

    // Modal states
    const [confirmPruneType, setConfirmPruneType] = useState<'containers' | 'images' | 'networks' | 'volumes' | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ type: 'images' | 'volumes' | 'networks', id: string, name?: string } | null>(null);

    // Ghost hunting state
    const [selectedOrphans, setSelectedOrphans] = useState<string[]>([]);
    const [bulkPurgeConfirm, setBulkPurgeConfirm] = useState(false);

    const fetchAllData = async () => {
        setIsLoading(true);
        try {
            const [usageRes, imagesRes, volumesRes, networksRes, orphansRes] = await Promise.all([
                apiFetch('/system/docker-df'),
                apiFetch('/system/images'),
                apiFetch('/system/volumes'),
                apiFetch('/system/networks'),
                apiFetch('/system/orphans'),
            ]);

            setUsage(await usageRes.json());
            setImages(await imagesRes.json());
            setVolumes(await volumesRes.json());
            setNetworks(await networksRes.json());
            setOrphans(await orphansRes.json());
            setSelectedOrphans([]);
        } catch (error) {
            console.error('Failed to fetch data', error);
            toast.error('Failed to load resources data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAllData();
    }, []);

    const handlePrune = async () => {
        if (!confirmPruneType) return;
        setIsActioning(true);
        try {
            const res = await apiFetch('/system/prune/system', {
                method: 'POST',
                body: JSON.stringify({ target: confirmPruneType })
            });
            const data = await res.json();
            if (data.reclaimedBytes !== undefined) {
                toast.success(`Pruned ${confirmPruneType}. Reclaimed ${formatBytes(data.reclaimedBytes)}.`);
            } else {
                toast.success(`Pruned ${confirmPruneType}.`);
            }
            await fetchAllData();
        } catch (error) {
            toast.error(`Failed to prune ${confirmPruneType}`);
        } finally {
            setIsActioning(false);
            setConfirmPruneType(null);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setIsActioning(true);
        try {
            const res = await apiFetch(`/system/${confirmDelete.type}/delete`, {
                method: 'POST',
                body: JSON.stringify({ id: confirmDelete.id })
            });
            if (!res.ok) throw new Error();
            toast.success(`Deleted ${confirmDelete.type.slice(0, -1)}`);
            await fetchAllData();
        } catch (error) {
            toast.error(`Failed to delete ${confirmDelete.type.slice(0, -1)}`);
        } finally {
            setIsActioning(false);
            setConfirmDelete(null);
        }
    };

    const toggleOrphanSelection = (containerId: string) => {
        setSelectedOrphans(prev => prev.includes(containerId) ? prev.filter(id => id !== containerId) : [...prev, containerId]);
    };

    const totalOrphansCount = Object.values(orphans).flat().length;
    const selectAllOrphans = () => {
        const allIds = Object.values(orphans).flat().map(c => c.Id);
        if (selectedOrphans.length === allIds.length) setSelectedOrphans([]);
        else setSelectedOrphans(allIds);
    };

    const handlePurgeOrphans = async () => {
        setIsActioning(true);
        try {
            const res = await apiFetch('/system/prune/orphans', {
                method: 'POST',
                body: JSON.stringify({ containerIds: selectedOrphans })
            });
            if (!res.ok) throw new Error();
            toast.success(`Purged ${selectedOrphans.length} ghost container(s)`);
            setBulkPurgeConfirm(false);
            await fetchAllData();
        } catch (error) {
            toast.error('Failed to purge selected containers.');
        } finally {
            setIsActioning(false);
        }
    };

    const chartData = [
        { name: 'Unused Images', value: usage?.reclaimableImages || 0, color: '#3b82f6' },
        { name: 'Unused Volumes', value: usage?.reclaimableVolumes || 0, color: '#a855f7' },
        { name: 'Stopped Containers', value: usage?.reclaimableContainers || 0, color: '#f97316' },
    ];

    const totalReclaimable = chartData.reduce((acc, curr) => acc + curr.value, 0);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-popover text-popover-foreground border rounded-lg shadow-md p-3 text-sm">
                    <p className="font-semibold">{payload[0].name}</p>
                    <p>{formatBytes(payload[0].value)}</p>
                </div>
            );
        }
        return null;
    };

    if (isLoading && !usage) {
        return <div className="p-6 flex justify-center items-center h-full text-muted-foreground animate-pulse">Loading resources...</div>;
    }

    return (
        <div className="p-6 h-full overflow-auto text-foreground flex flex-col gap-6">
            <div className="flex items-center gap-2">
                <HardDrive className="w-6 h-6" />
                <h1 className="text-2xl font-bold">Resources Hub</h1>
                {activeNode?.type === 'remote' && (
                    <span className="text-sm font-normal text-muted-foreground">- {activeNode.name}</span>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="col-span-1 border-border shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <ChartIcon className="w-5 h-5 text-muted-foreground" /> Reclaimable Space
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-48 flex flex-col items-center justify-center">
                        {totalReclaimable > 0 ? (
                            <ResponsiveContainer width="100%" height="80%">
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={50}
                                        stroke="none"
                                        dataKey="value"
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                                <span className="text-sm font-medium">Your system is clean</span>
                            </div>
                        )}
                        <div className="flex gap-4 text-xs font-semibold justify-center mt-2 flex-wrap">
                            {chartData.filter(d => d.value > 0).map((entry, index) => (
                                <div key={index} className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                    {entry.name}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-1 md:col-span-2 border-border shadow-sm flex flex-col">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Quick Clean</CardTitle>
                        <CardDescription>Free up disk space with bulk prune operations</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col justify-center">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <Button variant="outline" className="h-24 flex flex-col gap-2 hover:bg-muted/50 transition-colors" onClick={() => setConfirmPruneType('images')}>
                                <PackageMinus className="w-8 h-8 text-blue-500" />
                                <span className="text-xs font-semibold">Prune Unused Images</span>
                            </Button>
                            <Button variant="outline" className="h-24 flex flex-col gap-2 hover:bg-muted/50 transition-colors" onClick={() => setConfirmPruneType('volumes')}>
                                <HardDrive className="w-8 h-8 text-purple-500" />
                                <span className="text-xs font-semibold">Prune Unused Volumes</span>
                            </Button>
                            <Button variant="outline" className="h-24 flex flex-col gap-2 hover:bg-muted/50 transition-colors" onClick={() => setConfirmPruneType('networks')}>
                                <Network className="w-8 h-8 text-green-500" />
                                <span className="text-xs font-semibold">Prune Dead Networks</span>
                            </Button>
                            <Button variant="outline" className="h-24 flex flex-col gap-2 hover:bg-muted/50 transition-colors" onClick={() => setConfirmPruneType('containers')}>
                                <MonitorX className="w-8 h-8 text-orange-500" />
                                <span className="text-xs font-semibold">Purge Ghost Containers</span>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="images" className="flex-1 flex flex-col w-full rounded-lg border bg-card shadow-sm overflow-hidden min-h-[400px]">
                <div className="p-4 border-b bg-muted/20">
                    <TabsList className="grid grid-cols-4 w-full md:w-[600px]">
                        <TabsTrigger value="images">Images</TabsTrigger>
                        <TabsTrigger value="volumes">Volumes</TabsTrigger>
                        <TabsTrigger value="networks">Networks</TabsTrigger>
                        <TabsTrigger value="ghosts" className="relative">
                            Ghost Containers
                            {totalOrphansCount > 0 && (
                                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold">
                                    {totalOrphansCount}
                                </span>
                            )}
                        </TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-auto bg-background m-4 border rounded-md relative text-sm">
                    <TabsContent value="images" className="m-0 border-0 p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[120px]">ID</TableHead>
                                    <TableHead>Repository:Tag</TableHead>
                                    <TableHead>Size</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {images.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No images found.</TableCell></TableRow>
                                ) : images.map((img) => (
                                    <TableRow key={img.Id}>
                                        <TableCell className="font-mono text-xs">{img.Id.split(':')[1]?.substring(0, 12)}</TableCell>
                                        <TableCell className="font-medium">{img.RepoTags?.[0] || '<none>:<none>'}</TableCell>
                                        <TableCell>{formatBytes(img.Size)}</TableCell>
                                        <TableCell>
                                            <Badge variant={img.Containers > 0 ? "default" : "secondary"}>
                                                {img.Containers > 0 ? "In Use" : "Unused"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="hover:text-red-500 hover:bg-red-500/10" onClick={() => setConfirmDelete({ type: 'images', id: img.Id, name: img.RepoTags?.[0] })}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TabsContent>

                    <TabsContent value="volumes" className="m-0 border-0 p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Driver</TableHead>
                                    <TableHead className="hidden md:table-cell">Mountpoint</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {volumes.length === 0 ? (
                                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No volumes found.</TableCell></TableRow>
                                ) : volumes.map((vol) => (
                                    <TableRow key={vol.Name}>
                                        <TableCell className="font-mono text-xs max-w-[200px] truncate">{vol.Name}</TableCell>
                                        <TableCell><Badge variant="outline">{vol.Driver}</Badge></TableCell>
                                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground truncate max-w-[300px]">{vol.Mountpoint}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="hover:text-red-500 hover:bg-red-500/10" onClick={() => setConfirmDelete({ type: 'volumes', id: vol.Name, name: vol.Name })}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TabsContent>

                    <TabsContent value="networks" className="m-0 border-0 p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[120px]">ID</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Driver</TableHead>
                                    <TableHead>Scope</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {networks.length === 0 ? (
                                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No networks found.</TableCell></TableRow>
                                ) : networks.map((net) => (
                                    <TableRow key={net.Id}>
                                        <TableCell className="font-mono text-xs">{net.Id.substring(0, 12)}</TableCell>
                                        <TableCell className="font-medium max-w-[200px] truncate">{net.Name}</TableCell>
                                        <TableCell>{net.Driver}</TableCell>
                                        <TableCell><Badge variant="outline">{net.Scope}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="hover:text-red-500 hover:bg-red-500/10" onClick={() => setConfirmDelete({ type: 'networks', id: net.Id, name: net.Name })}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TabsContent>

                    <TabsContent value="ghosts" className="m-0 border-0 p-0 h-full flex flex-col">
                        <div className="flex justify-between items-center p-3 border-b bg-muted/10 sticky top-0 z-10">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    onChange={selectAllOrphans}
                                    checked={selectedOrphans.length === totalOrphansCount && totalOrphansCount > 0}
                                    className="rounded border-gray-300 focus:ring-primary h-4 w-4 ml-2"
                                />
                                <span className="text-sm font-medium">Select All</span>
                            </div>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setBulkPurgeConfirm(true)}
                                disabled={selectedOrphans.length === 0 || isActioning}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {isActioning ? 'Purging...' : `Purge Selected (${selectedOrphans.length})`}
                            </Button>
                        </div>

                        {totalOrphansCount === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground">
                                <MonitorX className="w-12 h-12 mb-2 opacity-50 text-green-500" />
                                <p>No orphaned containers detected.</p>
                                <p className="text-xs mt-1">Your system is clean!</p>
                            </div>
                        ) : (
                            <div className="p-4 space-y-4 pb-12">
                                {Object.entries(orphans).map(([project, containers]) => (
                                    <div key={project} className="bg-card rounded-lg border shadow-sm overflow-hidden text-sm">
                                        <div className="bg-muted px-4 py-2 border-b font-medium text-xs flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-red-500/80"></span>
                                            Project: {project}
                                        </div>
                                        <div className="divide-y">
                                            {containers.map((container: OrphanContainer) => (
                                                <div key={container.Id} className="flex items-center gap-4 p-3 hover:bg-muted/50 transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedOrphans.includes(container.Id)}
                                                        onChange={() => toggleOrphanSelection(container.Id)}
                                                        className="rounded border-gray-300 h-4 w-4"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono font-semibold truncate">
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
                </div>
            </Tabs>

            {/* Prune Bulk Action Confirm Dialog */}
            <AlertDialog open={!!confirmPruneType} onOpenChange={(open) => !open && setConfirmPruneType(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Prune {confirmPruneType}</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to prune all unused {confirmPruneType}? This action cannot be undone and will permanently free up disk space.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isActioning} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handlePrune}>
                            {isActioning ? 'Pruning...' : 'Prune'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Granular Delete Confirm Dialog */}
            <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {confirmDelete?.type.slice(0, -1)}</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <span className="font-mono font-bold text-foreground">{confirmDelete?.name || confirmDelete?.id.substring(0, 12)}</span>? This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isActioning} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
                            {isActioning ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Ghost Container Purge Confirm Dialog */}
            <AlertDialog open={bulkPurgeConfirm} onOpenChange={setBulkPurgeConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Purge Selected Ghosts</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to permanently remove the {selectedOrphans.length} selected orphan container(s)?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isActioning} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handlePurgeOrphans}>
                            {isActioning ? 'Purging...' : 'Purge'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
