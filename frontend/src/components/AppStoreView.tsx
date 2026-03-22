import { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Search, Rocket, Loader2, Info, ExternalLink, Github, Star } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from '@/lib/api';
import { useNodes } from '@/context/NodeContext';

export interface TemplateEnv {
    name: string;
    label?: string;
    default?: string;
}

interface TemplateVolume {
    container?: string;
    bind?: string;
}

export interface Template {
    type?: number;
    title: string;
    description: string;
    logo?: string;
    image?: string;
    ports?: string[];
    volumes?: TemplateVolume[];
    env?: TemplateEnv[];
    categories?: string[];
    github_url?: string;
    docs_url?: string;
    architectures?: string[];
    stars?: number;
    source?: string;
}

interface AppStoreViewProps {
    onDeploySuccess: (stackName: string) => void;
}

export function AppStoreView({ onDeploySuccess }: AppStoreViewProps) {
    const { activeNode } = useNodes();
    const [templates, setTemplates] = useState<Template[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [stackName, setStackName] = useState('');
    const [envVars, setEnvVars] = useState<Record<string, string>>({});
    const [isDeploying, setIsDeploying] = useState(false);
    const [loading, setLoading] = useState(true);

    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
    const [portVars, setPortVars] = useState<Record<string, string>>({});
    const [isDescExpanded, setIsDescExpanded] = useState(false);
    const [volVars, setVolVars] = useState<Record<string, string>>({});
    const [customEnvs, setCustomEnvs] = useState<Array<{ key: string, value: string }>>([]);
    const [newEnvKey, setNewEnvKey] = useState('');
    const [newEnvVal, setNewEnvVal] = useState('');

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            const res = await apiFetch('/templates');
            if (!res.ok) throw new Error('Failed to fetch templates');
            const data = await res.json();
            setTemplates(data || []);
        } catch (err) {
            toast.error((err as Error).message || "Failed to load App Shop");
        } finally {
            setLoading(false);
        }
    };

    const handleSelectTemplate = (t: Template) => {
        setSelectedTemplate(t);
        const localEnvs = [...(t.env || [])];
        // Inject LSIO standards if missing from the API
        if (!localEnvs.find(e => e.name === 'PUID')) localEnvs.push({ name: 'PUID', label: 'User ID (PUID)', default: '1000' });
        if (!localEnvs.find(e => e.name === 'PGID')) localEnvs.push({ name: 'PGID', label: 'Group ID (PGID)', default: '1000' });
        if (!localEnvs.find(e => e.name === 'TZ')) {
            const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            localEnvs.push({ name: 'TZ', label: 'Timezone', default: browserTz });
        }

        const initEnvs: Record<string, string> = {};
        localEnvs.forEach(e => {
            initEnvs[e.name] = e.default || '';
        });
        setEnvVars(initEnvs);
        t.env = localEnvs; // Mutate local template copy so they render

        // Initialize Volumes
        const initVols: Record<string, string> = {};
        t.volumes?.forEach((v) => {
            if (v.container) {
                initVols[v.container] = v.bind || `./${v.container.split('/').filter(Boolean).pop() || 'data'}`;
            }
        });
        setVolVars(initVols);
        setCustomEnvs([]); // Reset custom envs
        setNewEnvKey('');
        setNewEnvVal('');

        const initPorts: Record<string, string> = {};
        t.ports?.forEach(p => {
            const parts = p.split(':');
            if (parts.length > 1) {
                initPorts[p] = parts[0]; // Store just the host port for editing
            }
        });
        setPortVars(initPorts);
        setIsDescExpanded(false); // Reset description toggle

        // Auto-generate stack name from title
        const defaultName = t.title
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        setStackName(defaultName);

        setIsSheetOpen(true);
    };

    const handleDeploy = async () => {
        if (!stackName.trim()) {
            toast.error("Stack name is required");
            return;
        }
        setIsDeploying(true);

        const modifiedTemplate = { ...selectedTemplate };
        if (modifiedTemplate.ports) {
            modifiedTemplate.ports = modifiedTemplate.ports.map(p => {
                const parts = p.split(':');
                if (parts.length > 1 && portVars[p]) {
                    return `${portVars[p]}:${parts[1]}`; // Stitch the edited host port back
                }
                return p;
            });
        }

        // Process Volumes
        if (modifiedTemplate.volumes) {
            modifiedTemplate.volumes = modifiedTemplate.volumes.map((v) => {
                if (v.container && volVars[v.container] !== undefined) {
                    return { ...v, bind: volVars[v.container] };
                }
                return v;
            });
        }

        // Merge envs
        const finalEnvVars = { ...envVars };
        customEnvs.forEach(ce => {
            if (ce.key.trim()) finalEnvVars[ce.key.trim()] = ce.value;
        });

        try {
            const res = await apiFetch('/templates/deploy', {
                method: 'POST',
                body: JSON.stringify({
                    stackName: stackName.trim(),
                    template: modifiedTemplate,
                    envVars: finalEnvVars
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to deploy template');

            toast.success(`${selectedTemplate?.title} deployed successfully!`);
            setIsSheetOpen(false);
            onDeploySuccess(stackName.trim());
        } catch (err) {
            toast.error((err as Error).message || 'Deployment failed');
        } finally {
            setIsDeploying(false);
        }
    };

    const categories = useMemo(() => {
        const cats = new Set<string>();
        templates.forEach(t => t.categories?.forEach(c => cats.add(c)));
        return ['All', ...Array.from(cats).sort()];
    }, [templates]);

    const filtered = useMemo(() => templates.filter(t => {
        const matchesCategory = selectedCategory === 'All' || t.categories?.includes(selectedCategory);
        const q = searchQuery.toLowerCase();
        const matchesSearch = !q ||
            t.title.toLowerCase().includes(q) ||
            t.description?.toLowerCase().includes(q) ||
            (t.categories && t.categories.join(' ').toLowerCase().includes(q));
        return matchesCategory && matchesSearch;
    }), [templates, selectedCategory, searchQuery]);

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search App Store..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); }}
                    />
                </div>
            </div>

            {!loading && categories.length > 1 && (
                <div className="flex items-center gap-2">
                    <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1 scrollbar-none">
                        {categories.map(cat => (
                            <Button
                                key={cat}
                                variant={selectedCategory === cat ? 'default' : 'outline'}
                                size="sm"
                                className="shrink-0 h-7 text-xs px-3 rounded-full"
                                onClick={() => setSelectedCategory(cat)}
                            >
                                {cat}
                            </Button>
                        ))}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {filtered.length} app{filtered.length !== 1 ? 's' : ''}
                    </span>
                </div>
            )}

            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
                        {filtered.map((t, idx) => (
                            <Card
                                key={idx}
                                className="cursor-pointer hover:border-primary transition-colors flex flex-col overflow-hidden h-full"
                                onClick={() => handleSelectTemplate(t)}
                            >
                                <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                                    <div className="w-12 h-12 rounded bg-muted/50 p-1 flex-shrink-0 flex items-center justify-center bg-white overflow-hidden">
                                        {!imgErrors[t.title] && t.logo ? (
                                            <img src={t.logo} alt={t.title} className="w-full h-full object-contain" onError={() => setImgErrors(prev => ({ ...prev, [t.title]: true }))} />
                                        ) : (
                                            <Rocket className="w-6 h-6 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <CardTitle className="text-base truncate">{t.title}</CardTitle>
                                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1 min-h-[40px]">
                                            {t.description}
                                        </p>
                                    </div>
                                </CardHeader>
                                {t.categories && t.categories.length > 0 && (
                                    <CardContent className="pt-0 mt-auto">
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {t.categories.slice(0, 3).map(c => (
                                                <Badge
                                                    variant={selectedCategory === c ? 'default' : 'secondary'}
                                                    key={c}
                                                    className="text-[10px] px-1.5 py-0 pb-0.5 cursor-pointer"
                                                    onClick={(e) => { e.stopPropagation(); setSelectedCategory(c); }}
                                                >
                                                    {c}
                                                </Badge>
                                            ))}
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        ))}
                        {filtered.length === 0 && (
                            <div className="col-span-full py-12 text-center text-muted-foreground">
                                <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>No apps found matching "{searchQuery}"</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent className="w-full sm:max-w-md flex flex-col h-full" side="right">
                    {selectedTemplate && (
                        <div className="flex flex-col h-full">
                            <SheetHeader className="mb-6 text-left">
                                {activeNode?.type === 'remote' && (
                                    <div className="mb-2">
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            Deploying to: {activeNode.name}
                                        </Badge>
                                    </div>
                                )}
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-16 h-16 rounded bg-white p-1 flex-shrink-0 flex items-center justify-center overflow-hidden border">
                                        {!imgErrors[selectedTemplate.title] && selectedTemplate.logo ? (
                                            <img src={selectedTemplate.logo} alt={selectedTemplate.title} className="w-full h-full object-contain" onError={() => setImgErrors(prev => ({ ...prev, [selectedTemplate.title]: true }))} />
                                        ) : (
                                            <Rocket className="w-8 h-8 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div>
                                        <SheetTitle className="text-xl">{selectedTemplate.title}</SheetTitle>
                                        <div className="mt-1">
                                            <SheetDescription className={isDescExpanded ? "" : "line-clamp-3 text-sm text-muted-foreground"}>
                                                {selectedTemplate.description}
                                            </SheetDescription>
                                            <span className="text-xs text-primary cursor-pointer hover:underline mt-1 inline-block" onClick={() => setIsDescExpanded(!isDescExpanded)}>
                                                {isDescExpanded ? 'Read less' : 'Read more'}
                                            </span>
                                        </div>

                                        {(selectedTemplate.architectures || selectedTemplate.stars !== undefined || selectedTemplate.github_url || selectedTemplate.docs_url) && (
                                            <div className="mt-3 space-y-2">
                                                {selectedTemplate.architectures && selectedTemplate.architectures.length > 0 && (
                                                    <div className="flex flex-wrap gap-1">
                                                        {selectedTemplate.architectures.map(arch => (
                                                            <Badge variant="outline" key={arch} className="text-[10px] px-1.5 py-0">
                                                                {arch}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                    {selectedTemplate.stars !== undefined && (
                                                        <div className="flex items-center gap-1">
                                                            <Star className="w-3 h-3 fill-muted-foreground" />
                                                            <span>{selectedTemplate.stars}</span>
                                                        </div>
                                                    )}
                                                    {selectedTemplate.github_url && (
                                                        <a href={selectedTemplate.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
                                                            <Github className="w-3 h-3" />
                                                            <span>Source</span>
                                                        </a>
                                                    )}
                                                    {selectedTemplate.docs_url && (
                                                        <a href={selectedTemplate.docs_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
                                                            <ExternalLink className="w-3 h-3" />
                                                            <span>Docs</span>
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </SheetHeader>

                            <ScrollArea className="flex-1 pr-4 -mx-4 px-4">
                                <div className="space-y-6 pb-8">
                                    <div className="space-y-2">
                                        <Label htmlFor="stackName" className="font-semibold">
                                            Stack Name <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="stackName"
                                            value={stackName}
                                            onChange={(e) => setStackName(e.target.value)}
                                            placeholder="e.g. my-app"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            This determines the directory name and docker project name.
                                        </p>
                                    </div>

                                    {selectedTemplate.ports && selectedTemplate.ports.length > 0 && (
                                        <div className="space-y-4 pt-4 border-t">
                                            <h4 className="font-semibold">Ports (Host : Container)</h4>
                                            {selectedTemplate.ports.map((p, idx) => {
                                                const parts = p.split(':');
                                                if (parts.length < 2) return null;
                                                return (
                                                    <div key={idx} className="flex items-center space-x-2">
                                                        <Input
                                                            value={portVars[p] || ''}
                                                            onChange={(e) => setPortVars(prev => ({ ...prev, [p]: e.target.value }))}
                                                            className="w-24 text-center"
                                                        />
                                                        <span className="text-muted-foreground font-mono">: {parts[1]}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {selectedTemplate.volumes && selectedTemplate.volumes.length > 0 && (
                                        <div className="space-y-4 pt-4 border-t">
                                            <h4 className="font-semibold">Volumes (Host : Container)</h4>
                                            {selectedTemplate.volumes.map((v, idx: number) => {
                                                const containerPath = v.container;
                                                if (!containerPath) return null;
                                                return (
                                                    <div key={idx} className="space-y-1.5">
                                                        <Label className="text-xs text-muted-foreground font-mono">Container: {containerPath}</Label>
                                                        <Input
                                                            value={volVars[containerPath] !== undefined ? volVars[containerPath] : ''}
                                                            onChange={(e) => setVolVars(prev => ({ ...prev, [containerPath]: e.target.value }))}
                                                            placeholder={`/path/to/host/dir`}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {selectedTemplate.env && selectedTemplate.env.length > 0 && (
                                        <div className="space-y-4 pt-4 border-t">
                                            <h4 className="font-semibold">Environment Variables</h4>
                                            {selectedTemplate.env.map((e, idx) => (
                                                <div key={idx} className="space-y-1.5">
                                                    <Label htmlFor={`env-${e.name}`} className="text-sm">
                                                        {e.label || e.name}
                                                    </Label>
                                                    <Input
                                                        id={`env-${e.name}`}
                                                        value={envVars[e.name] !== undefined ? envVars[e.name] : ''}
                                                        onChange={(ev) => setEnvVars(prev => ({ ...prev, [e.name]: ev.target.value }))}
                                                        placeholder={e.default || `Enter value for ${e.name}`}
                                                    />
                                                    <p className="text-[10px] text-muted-foreground font-mono">
                                                        {e.name}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="space-y-4 pt-4 border-t">
                                        <h4 className="font-semibold text-sm">Add Custom Variable</h4>
                                        {customEnvs.map((ce, idx) => (
                                            <div key={idx} className="flex gap-2">
                                                <Input value={ce.key} readOnly className="w-1/3 bg-muted font-mono text-xs" />
                                                <Input value={ce.value} readOnly className="flex-1 bg-muted font-mono text-xs" />
                                                <Button variant="destructive" size="icon" onClick={() => setCustomEnvs(prev => prev.filter((_, i) => i !== idx))}>-</Button>
                                            </div>
                                        ))}
                                        <div className="flex gap-2">
                                            <Input placeholder="KEY" value={newEnvKey} onChange={e => setNewEnvKey(e.target.value)} className="w-1/3 font-mono text-xs" />
                                            <Input placeholder="VALUE" value={newEnvVal} onChange={e => setNewEnvVal(e.target.value)} className="flex-1 font-mono text-xs" />
                                            <Button variant="secondary" onClick={() => {
                                                if (newEnvKey.trim()) {
                                                    setCustomEnvs(prev => [...prev, { key: newEnvKey, value: newEnvVal }]);
                                                    setNewEnvKey('');
                                                    setNewEnvVal('');
                                                }
                                            }}>+</Button>
                                        </div>
                                    </div>
                                </div>
                            </ScrollArea>

                            <SheetFooter className="pt-4 mt-auto border-t sm:justify-start">
                                <div className="flex flex-col w-full gap-2">
                                    <Button
                                        onClick={handleDeploy}
                                        disabled={isDeploying || !stackName.trim()}
                                        className="w-full"
                                        size="lg"
                                    >
                                        {isDeploying ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                                Deploying Stack...
                                            </>
                                        ) : (
                                            <>
                                                <Rocket className="w-5 h-5 mr-2" />
                                                Deploy {selectedTemplate.title}
                                            </>
                                        )}
                                    </Button>
                                    {isDeploying && (
                                        <p className="text-center text-xs text-muted-foreground animate-pulse">
                                            This may take a few minutes for large images.
                                        </p>
                                    )}
                                </div>
                            </SheetFooter>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
