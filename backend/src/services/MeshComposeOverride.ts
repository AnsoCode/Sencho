import * as YAML from 'yaml';

/**
 * Sencho Mesh Compose override generator.
 *
 * Produces a YAML override applied with `docker compose -f compose.yml -f
 * mesh.override.yml up` that injects cross-node alias entries into each
 * opted-in service's /etc/hosts. The aliases resolve to the host gateway
 * (`host-gateway`), which is where the local Sencho Mesh sidecar listens
 * (host network mode). The user's source compose file is never mutated; the
 * override lives in Sencho's data dir.
 */

export interface MeshAlias {
    /** `<service>.<stack>.<nodeName>.sencho` */
    host: string;
}

export interface MeshOverrideInput {
    /** Service names from the user's compose file (the override echoes them). */
    services: string[];
    /** Aliases this stack should be able to resolve. Order is normalized in output. */
    aliases: MeshAlias[];
}

/**
 * Returns a YAML string suitable for `-f mesh.override.yml`. Stable output
 * ordering so file content does not churn between deploys.
 */
export function generateOverrideYaml(input: MeshOverrideInput): string {
    const sortedServices = [...input.services].sort();
    const sortedAliases = [...input.aliases].sort((a, b) => a.host.localeCompare(b.host));

    if (sortedAliases.length === 0) {
        const services: Record<string, unknown> = {};
        for (const svc of sortedServices) services[svc] = {};
        return YAML.stringify({ services }, { lineWidth: 0 });
    }

    const extraHostsList = sortedAliases.map((a) => `${a.host}:host-gateway`);

    const services: Record<string, unknown> = {};
    for (const svc of sortedServices) {
        services[svc] = { extra_hosts: extraHostsList };
    }

    return YAML.stringify({ services }, { lineWidth: 0 });
}

/**
 * Build alias hostnames for every opted-in service across the fleet. Pure
 * helper consumed by MeshService and the override generator.
 */
export function buildAliasHosts(opts: {
    nodeName: string;
    stackName: string;
    services: Array<{ service: string; ports: number[] }>;
}): string[] {
    return opts.services.map((s) => `${s.service}.${opts.stackName}.${opts.nodeName}.sencho`);
}
