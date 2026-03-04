import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Search, Rocket, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

export interface TemplateEnv {
    name: string;
    label?: string;
    default?: string;
}

export interface Template {
    type?: number;
    title: string;
    description: string;
    logo?: string;
    image?: string;
    ports?: string[];
    volumes?: any[];
    env?: TemplateEnv[];
    categories?: string[];
}

interface TemplatesViewProps {
    onDeploySuccess: (stackName: string) => void;
}

export function TemplatesView({ onDeploySuccess }: TemplatesViewProps) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [stackName, setStackName] = useState('');
    const [envVars, setEnvVars] = useState<Record<string, string>>({});
    const [isDeploying, setIsDeploying] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            const res = await fetch('/api/templates');
            if (!res.ok) throw new Error('Failed to fetch templates');
            const data = await res.json();
            setTemplates(data || []);
        } catch (err: any) {
            toast.error(err.message || "Failed to load App Shop");
        } finally {
            setLoading(false);
        }
    };

    const handleSelectTemplate = (t: Template) => {
        setSelectedTemplate(t);
        // Init env vars with defaults
        const initEnvs: Record<string, string> = {};
        if (t.env && t.env.length > 0) {
            t.env.forEach(e => {
                initEnvs[e.name] = e.default || '';
            });
        }
        setEnvVars(initEnvs);

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
        try {
            const res = await fetch('/api/templates/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stackName: stackName.trim(),
                    template: selectedTemplate,
                    envVars
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to deploy template');

            toast.success(`${selectedTemplate?.title} deployed successfully!`);
            setIsSheetOpen(false);
            onDeploySuccess(stackName.trim());
        } catch (err: any) {
            toast.error(err.message || 'Deployment failed');
        } finally {
            setIsDeploying(false);
        }
    };

    const filtered = templates.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.categories && t.categories.join(' ').toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search templates..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

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
                                        {t.logo ? (
                                            <img src={t.logo} alt={t.title} className="w-full h-full object-contain" />
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
                                                <Badge variant="secondary" key={c} className="text-[10px] px-1.5 py-0 pb-0.5">
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
                                <p>No templates found matching "{searchQuery}"</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent className="w-full sm:max-w-md overflow-y-auto" side="right">
                    {selectedTemplate && (
                        <div className="flex flex-col h-full">
                            <SheetHeader className="mb-6 text-left">
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-16 h-16 rounded bg-white p-1 flex-shrink-0 flex items-center justify-center overflow-hidden border">
                                        {selectedTemplate.logo ? (
                                            <img src={selectedTemplate.logo} alt={selectedTemplate.title} className="w-full h-full object-contain" />
                                        ) : (
                                            <Rocket className="w-8 h-8 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div>
                                        <SheetTitle className="text-xl">{selectedTemplate.title}</SheetTitle>
                                        <SheetDescription className="line-clamp-2 mt-1">
                                            {selectedTemplate.description}
                                        </SheetDescription>
                                    </div>
                                </div>
                            </SheetHeader>

                            <div className="space-y-6 flex-1 pr-2 pb-8">
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
                            </div>

                            <SheetFooter className="pt-4 mt-auto border-t sm:justify-start">
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
                            </SheetFooter>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
