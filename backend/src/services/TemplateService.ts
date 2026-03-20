import axios from 'axios';
import { DatabaseService } from './DatabaseService';


export interface TemplateEnv {
    name: string;
    label?: string;
    default?: string;
}

export interface TemplateVolume {
    container: string;
    bind?: string;
    readonly?: boolean;
}

export interface Template {
    type?: number;
    title: string;
    description: string;
    logo?: string;
    image?: string;
    ports?: string[];
    volumes?: TemplateVolume[] | string[];
    env?: TemplateEnv[];
    categories?: string[];
    platform?: string;
    github_url?: string;
    docs_url?: string;
    architectures?: string[];
    stars?: number;
    repository?: {
        url: string;
        stackfile: string;
    };
}

export interface TemplatesResponse {
    version: string;
    templates: Template[];
}

export class TemplateService {
    private cachedTemplates: Template[] = [];
    private lastFetchTime: number = 0;
    private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

    public async getTemplates(): Promise<Template[]> {
        const now = Date.now();
        if (this.cachedTemplates.length > 0 && now - this.lastFetchTime < this.CACHE_DURATION_MS) {
            return this.cachedTemplates;
        }

        try {
            const settings = DatabaseService.getInstance().getGlobalSettings();
            // Default to a reliable LSIO Portainer v2 template registry if not set
            const registryUrl = settings.template_registry_url || 'https://api.linuxserver.io/api/v1/images?include_config=true';

            const response = await axios.get<any>(registryUrl);

            if (registryUrl.includes('api.linuxserver.io')) {
                // Official LSIO API Schema Mapping
                const lsioApps = response.data?.data?.repositories?.linuxserver || [];

                this.cachedTemplates = Object.values(lsioApps).map((app: any) => {
                    return {
                        type: 1,
                        title: app.name,
                        description: app.description || '',
                        logo: app.logo || `https://raw.githubusercontent.com/linuxserver/docker-templates/master/linuxserver.io/img/${app.name}-logo.png`,
                        image: `lscr.io/linuxserver/${app.name}:latest`,
                        github_url: app.github,
                        docs_url: app.readme,
                        architectures: app.arch,
                        stars: app.stars,
                        // Map configs if available, otherwise default to empty arrays
                        ports: (app.config?.ports || []).map((p: any) => `${p.external || p.internal}:${p.internal}/${p.protocol || 'tcp'}`),
                        volumes: (app.config?.volumes || []).map((v: any) => {
                            const folderName = v.path.split('/').filter(Boolean).pop() || 'data';
                            return {
                                container: v.path,
                                bind: `./${folderName}` // Proactively create a clean relative path
                            };
                        }),
                        env: (app.config?.environment || []).map((e: any) => ({
                            name: e.name,
                            label: e.desc || e.name,
                            default: e.default || ''
                        }))
                    };
                });
            } else {
                // Legacy Portainer v2 Format (Fallback for custom registries)
                this.cachedTemplates = (response.data.templates || []).filter((t: Template) => !!t.image && t.type === 1);
            }

            this.lastFetchTime = now;
            return this.cachedTemplates;
        } catch (error) {
            console.error('Failed to fetch templates', error);
            if (this.cachedTemplates.length > 0) {
                return this.cachedTemplates;
            }
            throw new Error('Could not fetch templates from registry');
        }
    }

    public generateComposeFromTemplate(template: Template): string {
        let yaml = `services:\n  app:\n`;

        if (template.image) {
            yaml += `    image: ${template.image}\n`;
        }

        yaml += `    restart: unless-stopped\n`;

        if (template.ports && template.ports.length > 0) {
            yaml += `    ports:\n`;
            for (const port of template.ports) {
                yaml += `      - "${port}"\n`;
            }
        }

        if (template.volumes && template.volumes.length > 0) {
            yaml += `    volumes:\n`;
            for (const vol of template.volumes) {
                let hostPath = '';
                let containerPath = '';
                let options = '';

                if (typeof vol === 'string') {
                    const parts = vol.split(':');
                    if (parts.length === 1) {
                        yaml += `      - ${vol}\n`;
                        continue;
                    }
                    hostPath = parts[0];
                    containerPath = parts[1];
                    options = parts.slice(2).join(':');
                    if (options) options = `:${options}`;
                } else if (vol.container) {
                    containerPath = vol.container;
                    const containerFolder = containerPath.split('/').filter(Boolean).pop() || 'data';
                    hostPath = vol.bind ? vol.bind : `./${containerFolder}`;
                    options = vol.readonly ? ':ro' : '';
                } else {
                    continue;
                }


                yaml += `      - ${hostPath}:${containerPath}${options}\n`;
            }
        }

        yaml += `    env_file:\n      - .env\n`;

        return yaml;
    }

    public generateEnvString(envVars: Record<string, string>): string {
        return Object.entries(envVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
    }
}

export const templateService = new TemplateService();
