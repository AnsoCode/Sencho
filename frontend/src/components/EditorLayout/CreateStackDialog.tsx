import { useState } from 'react';
import { Plus, GitBranch, FileCode2, Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '../ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '../ui/tabs';
import { springs } from '@/lib/motion';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Checkbox } from '../ui/checkbox';
import { GitSourceFields, type ApplyMode } from '../stack/GitSourceFields';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';

export interface CreateStackDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStackCreated: (stackName: string) => void | Promise<void>;
    onStacksChanged: () => void | Promise<void>;
}

export function CreateStackDialog({ open, onOpenChange, onStackCreated, onStacksChanged }: CreateStackDialogProps) {
    const [createMode, setCreateMode] = useState<'empty' | 'git' | 'docker-run'>('empty');
    const [newStackName, setNewStackName] = useState('');
    const [dockerRunInput, setDockerRunInput] = useState('');
    const [convertedYaml, setConvertedYaml] = useState<string | null>(null);
    const [isConverting, setIsConverting] = useState(false);
    const [creatingFromDockerRun, setCreatingFromDockerRun] = useState(false);
    const [gitRepoUrl, setGitRepoUrl] = useState('');
    const [gitBranch, setGitBranch] = useState('main');
    const [gitComposePath, setGitComposePath] = useState('compose.yaml');
    const [gitSyncEnv, setGitSyncEnv] = useState(false);
    const [gitAuthType, setGitAuthType] = useState<'none' | 'token'>('none');
    const [gitToken, setGitToken] = useState('');
    const [gitApplyMode, setGitApplyMode] = useState<ApplyMode>('review');
    const [gitDeployNow, setGitDeployNow] = useState(false);
    const [creatingFromGit, setCreatingFromGit] = useState(false);

    const resetCreateFromGitForm = () => {
        setNewStackName('');
        setGitRepoUrl('');
        setGitBranch('main');
        setGitComposePath('compose.yaml');
        setGitSyncEnv(false);
        setGitAuthType('none');
        setGitToken('');
        setGitApplyMode('review');
        setGitDeployNow(false);
    };

    const resetCreateFromDockerRunForm = () => {
        setDockerRunInput('');
        setConvertedYaml(null);
        setIsConverting(false);
        setCreatingFromDockerRun(false);
    };

    const handleCreateStack = async () => {
        if (!newStackName.trim()) return;
        // Send stackName directly (no .yml extension - backend creates directory)
        const stackName = newStackName.trim();
        try {
            const response = await apiFetch('/stacks', {
                method: 'POST',
                body: JSON.stringify({ stackName }),
            });
            if (!response.ok) {
                if (response.status === 409) {
                    throw new Error('Stack already exists');
                } else if (response.status === 400) {
                    throw new Error('Invalid stack name (use alphanumeric characters and hyphens only)');
                }
                throw new Error('Failed to create stack');
            }
            onOpenChange(false);
            setNewStackName('');
            await onStackCreated(stackName);
        } catch (error) {
            console.error('Failed to create stack:', error);
            toast.error((error as Error).message || 'Failed to create stack');
        }
    };

    const handleCreateStackFromGit = async () => {
        const stackName = newStackName.trim();
        if (!stackName) {
            toast.error('Stack name is required.');
            return;
        }
        if (!gitRepoUrl.trim() || !gitBranch.trim() || !gitComposePath.trim()) {
            toast.error('Repository URL, branch, and compose path are required.');
            return;
        }
        if (!/^https:\/\//i.test(gitRepoUrl.trim())) {
            toast.error('Only HTTPS repository URLs are supported.');
            return;
        }
        setCreatingFromGit(true);
        const loadingId = toast.loading(gitDeployNow ? 'Fetching, creating, and deploying...' : 'Fetching and creating stack...');
        try {
            const autoApply = gitApplyMode !== 'review';
            const autoDeploy = gitApplyMode === 'auto-deploy';
            const body: Record<string, unknown> = {
                stack_name: stackName,
                repo_url: gitRepoUrl.trim(),
                branch: gitBranch.trim(),
                compose_path: gitComposePath.trim(),
                sync_env: gitSyncEnv,
                auth_type: gitAuthType,
                auto_apply_on_webhook: autoApply,
                auto_deploy_on_apply: autoDeploy,
                deploy_now: gitDeployNow,
            };
            if (gitAuthType === 'token' && gitToken !== '') {
                body.token = gitToken;
            }
            const response = await apiFetch('/stacks/from-git', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                if (response.status === 409) {
                    throw new Error(err?.error || 'Stack already exists.');
                }
                throw new Error(err?.error || 'Failed to create stack from Git.');
            }
            const data: {
                deployed?: boolean;
                deployError?: string;
                commitSha?: string;
                warnings?: string[];
            } = await response.json();
            const shortSha = typeof data.commitSha === 'string' ? data.commitSha.slice(0, 7) : '';
            const shaSuffix = shortSha ? ` @ ${shortSha}` : '';
            if (gitDeployNow && data.deployError) {
                toast.warning(`Stack created${shaSuffix}, but deploy failed: ${data.deployError}`);
            } else if (gitDeployNow && data.deployed) {
                toast.success(`Stack created and deployed from Git${shaSuffix}.`);
            } else {
                toast.success(`Stack created from Git${shaSuffix}.`);
            }
            if (Array.isArray(data.warnings) && data.warnings.length > 0) {
                toast.warning(data.warnings.join(' '));
            }
            onOpenChange(false);
            resetCreateFromGitForm();
            await onStackCreated(stackName);
        } catch (error) {
            console.error('Failed to create stack from Git:', error);
            toast.error((error as Error)?.message || 'Failed to create stack from Git.');
        } finally {
            toast.dismiss(loadingId);
            setCreatingFromGit(false);
        }
    };

    const handleConvertDockerRun = async () => {
        const command = dockerRunInput.trim();
        if (!command) {
            toast.error('Paste a docker run command first.');
            return;
        }
        setIsConverting(true);
        try {
            const response = await apiFetch('/convert', {
                method: 'POST',
                body: JSON.stringify({ dockerRun: command }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.error || 'Could not parse command.');
            }
            if (typeof data?.yaml !== 'string' || data.yaml.length === 0) {
                throw new Error('Converter returned an empty result.');
            }
            setConvertedYaml(data.yaml);
            toast.success('Converted to compose YAML.');
        } catch (error) {
            setConvertedYaml(null);
            const err = error as { message?: string; error?: string; data?: { error?: string } };
            toast.error(
                err?.message ||
                    err?.error ||
                    err?.data?.error ||
                    'Failed to convert docker run command.',
            );
        } finally {
            setIsConverting(false);
        }
    };

    const handleCreateStackFromDockerRun = async () => {
        const stackName = newStackName.trim();
        if (!stackName) {
            toast.error('Stack name is required.');
            return;
        }
        if (!convertedYaml) {
            toast.error('Convert the command before creating the stack.');
            return;
        }
        setCreatingFromDockerRun(true);
        const loadingId = toast.loading('Creating stack from converted YAML...');
        let createdStack = false;
        try {
            const createResponse = await apiFetch('/stacks', {
                method: 'POST',
                body: JSON.stringify({ stackName }),
            });
            if (!createResponse.ok) {
                if (createResponse.status === 409) {
                    throw new Error('Stack already exists.');
                }
                if (createResponse.status === 400) {
                    throw new Error('Invalid stack name (use alphanumeric characters and hyphens only).');
                }
                throw new Error('Failed to create stack.');
            }
            createdStack = true;

            const saveResponse = await apiFetch(`/stacks/${encodeURIComponent(stackName)}`, {
                method: 'PUT',
                body: JSON.stringify({ content: convertedYaml }),
            });
            if (!saveResponse.ok) {
                // Roll back the empty stack we just created so we don't leave an orphan.
                await apiFetch(`/stacks/${encodeURIComponent(stackName)}`, { method: 'DELETE' }).catch((cleanupError) => {
                    console.error('Failed to roll back orphan stack after save failure:', cleanupError);
                });
                createdStack = false;
                throw new Error('Could not save the converted YAML. Please try again.');
            }

            toast.success(`Stack "${stackName}" created from docker run.`);
            onOpenChange(false);
            resetCreateFromDockerRunForm();
            setNewStackName('');
            await onStackCreated(stackName);
        } catch (error) {
            console.error('Failed to create stack from docker run:', error);
            const err = error as { message?: string; error?: string; data?: { error?: string } };
            toast.error(
                err?.message ||
                    err?.error ||
                    err?.data?.error ||
                    'Failed to create stack from docker run.',
            );
            // If we bailed before the createdStack flag got reset, surface that the stack still exists.
            if (createdStack) {
                await Promise.resolve(onStacksChanged()).catch(() => undefined);
            }
        } finally {
            toast.dismiss(loadingId);
            setCreatingFromDockerRun(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                onOpenChange(o);
                if (!o) {
                    setCreateMode('empty');
                    resetCreateFromGitForm();
                    resetCreateFromDockerRunForm();
                }
            }}
        >
            <DialogContent className="max-w-xl w-[95vw] p-0 gap-0">
                <DialogHeader className="px-6 pt-6 pb-3">
                    <DialogTitle>Create New Stack</DialogTitle>
                    <DialogDescription className="sr-only">
                        Create a new stack: empty, cloned from a Git repository, or converted from a docker run command.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 pb-2">
                    <Tabs value={createMode} onValueChange={(v) => setCreateMode(v as 'empty' | 'git' | 'docker-run')}>
                        <TabsList>
                            <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                                <TabsHighlightItem value="empty">
                                    <TabsTrigger value="empty">
                                        <Plus className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                                        Empty
                                    </TabsTrigger>
                                </TabsHighlightItem>
                                <TabsHighlightItem value="git">
                                    <TabsTrigger value="git">
                                        <GitBranch className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                                        From Git
                                    </TabsTrigger>
                                </TabsHighlightItem>
                                <TabsHighlightItem value="docker-run">
                                    <TabsTrigger value="docker-run">
                                        <FileCode2 className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                                        From Docker Run
                                    </TabsTrigger>
                                </TabsHighlightItem>
                            </TabsHighlight>
                        </TabsList>
                    </Tabs>
                </div>

                {createMode === 'empty' && (
                    <>
                        <div className="px-6 py-4 space-y-2">
                            <Label htmlFor="create-stack-name">Stack Name</Label>
                            <Input
                                id="create-stack-name"
                                placeholder="Stack name (e.g., myapp)"
                                value={newStackName}
                                onChange={(e) => setNewStackName(e.target.value)}
                            />
                        </div>
                        <DialogFooter className="px-6 pb-6">
                            <Button onClick={handleCreateStack}>Create</Button>
                        </DialogFooter>
                    </>
                )}
                {createMode === 'git' && (
                    <>
                        <ScrollArea className="max-h-[70vh]">
                            <div className="px-6 py-4 space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="create-git-stack-name">Stack Name</Label>
                                    <Input
                                        id="create-git-stack-name"
                                        placeholder="Stack name (e.g., myapp)"
                                        value={newStackName}
                                        onChange={(e) => setNewStackName(e.target.value)}
                                        disabled={creatingFromGit}
                                    />
                                </div>

                                <GitSourceFields
                                    variant="create"
                                    disabled={creatingFromGit}
                                    repoUrl={gitRepoUrl}
                                    branch={gitBranch}
                                    composePath={gitComposePath}
                                    syncEnv={gitSyncEnv}
                                    authType={gitAuthType}
                                    token={gitToken}
                                    hasStoredToken={false}
                                    applyMode={gitApplyMode}
                                    onRepoUrlChange={setGitRepoUrl}
                                    onBranchChange={setGitBranch}
                                    onComposePathChange={setGitComposePath}
                                    onSyncEnvChange={setGitSyncEnv}
                                    onAuthTypeChange={setGitAuthType}
                                    onTokenChange={setGitToken}
                                    onApplyModeChange={setGitApplyMode}
                                />

                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="create-git-deploy-now"
                                        checked={gitDeployNow}
                                        onCheckedChange={(c) => setGitDeployNow(c === true)}
                                        disabled={creatingFromGit}
                                    />
                                    <Label htmlFor="create-git-deploy-now" className="text-xs cursor-pointer">
                                        Deploy after create
                                    </Label>
                                </div>
                            </div>
                        </ScrollArea>
                        <DialogFooter className="px-6 py-4 border-t border-glass-border">
                            <Button onClick={handleCreateStackFromGit} disabled={creatingFromGit}>
                                {creatingFromGit ? (
                                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />Creating</>
                                ) : (
                                    <><GitBranch className="w-4 h-4 mr-1.5" strokeWidth={1.5} />Create from Git</>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                )}
                {createMode === 'docker-run' && (
                    <>
                        <ScrollArea className="max-h-[70vh]">
                            <div className="px-6 py-4 space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="create-dr-stack-name">Stack Name</Label>
                                    <Input
                                        id="create-dr-stack-name"
                                        placeholder="Stack name (e.g., myapp)"
                                        value={newStackName}
                                        onChange={(e) => setNewStackName(e.target.value)}
                                        disabled={creatingFromDockerRun}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="create-dr-command">Paste your docker run command</Label>
                                    <textarea
                                        id="create-dr-command"
                                        spellCheck={false}
                                        className="flex w-full rounded-md border border-glass-border bg-input px-3 py-2 text-sm font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[120px] resize-y"
                                        placeholder="docker run -d --name nginx -p 8080:80 nginx:latest"
                                        value={dockerRunInput}
                                        onChange={(e) => {
                                            setDockerRunInput(e.target.value);
                                            // The preview only reflects the previous command; clear it when
                                            // the input changes so the user can't create a stack from stale YAML.
                                            if (convertedYaml !== null) setConvertedYaml(null);
                                        }}
                                        disabled={creatingFromDockerRun}
                                    />
                                    <div className="flex justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleConvertDockerRun}
                                            disabled={isConverting || creatingFromDockerRun || !dockerRunInput.trim()}
                                        >
                                            {isConverting ? (
                                                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />Converting</>
                                            ) : (
                                                <><FileCode2 className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />Convert</>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                {convertedYaml !== null && (
                                    <div className="space-y-2">
                                        <Label>compose.yaml preview</Label>
                                        <ScrollArea className="max-h-[240px] rounded-md border border-card-border border-t-card-border-top bg-card shadow-card-bevel">
                                            <pre className="px-3 py-2 text-xs font-mono whitespace-pre leading-relaxed">
                                                {convertedYaml}
                                            </pre>
                                        </ScrollArea>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                        <DialogFooter className="px-6 py-4 border-t border-glass-border">
                            <Button
                                onClick={handleCreateStackFromDockerRun}
                                disabled={creatingFromDockerRun || !convertedYaml || !newStackName.trim()}
                            >
                                {creatingFromDockerRun ? (
                                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />Creating</>
                                ) : (
                                    <><Plus className="w-4 h-4 mr-1.5" strokeWidth={1.5} />Create Stack</>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
