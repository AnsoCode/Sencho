import axios from 'axios';

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
    private readonly TEMPLATES_URL = 'https://raw.githubusercontent.com/Lissy93/portainer-templates/main/templates.json';

    public async getTemplates(): Promise<Template[]> {
        const now = Date.now();
        if (this.cachedTemplates.length > 0 && now - this.lastFetchTime < this.CACHE_DURATION_MS) {
            return this.cachedTemplates;
        }

        try {
            const response = await axios.get<TemplatesResponse>(this.TEMPLATES_URL);
            // Filter out templates without images as we are generating compose files from image, ports, etc.
            this.cachedTemplates = (response.data.templates || []).filter((t: Template) => !!t.image && t.type === 1);
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
                if (typeof vol === 'string') {
                    yaml += `      - ${vol}\n`;
                } else if (vol.container) {
                    // If bind is not provided, we extract the folder name from the container path
                    const containerFolder = vol.container.split('/').pop() || 'data';
                    const localBind = vol.bind ? vol.bind.replace(/^\//, './') : `./${containerFolder}`;
                    yaml += `      - ${localBind}:${vol.container}${vol.readonly ? ':ro' : ''}\n`;
                }
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
