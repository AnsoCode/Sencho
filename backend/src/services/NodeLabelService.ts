import { DatabaseService, type BlueprintSelector, type Node } from './DatabaseService';

export const MAX_NODE_LABELS = 50;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const MAX_LABEL_LENGTH = 40;

export interface NodeLabelValidationError {
    error: string;
    code: 'invalid_format' | 'too_long' | 'empty' | 'too_many';
}

export class NodeLabelService {
    private static instance: NodeLabelService | null = null;

    static getInstance(): NodeLabelService {
        if (!NodeLabelService.instance) {
            NodeLabelService.instance = new NodeLabelService();
        }
        return NodeLabelService.instance;
    }

    private constructor() { /* singleton */ }

    listAll(): Record<number, string[]> {
        return DatabaseService.getInstance().getNodeLabelsMap();
    }

    listForNode(nodeId: number): string[] {
        return DatabaseService.getInstance().listNodeLabels(nodeId).map(r => r.label);
    }

    listDistinct(): string[] {
        return DatabaseService.getInstance().listDistinctNodeLabels();
    }

    validate(rawLabel: string): NodeLabelValidationError | null {
        const label = rawLabel.trim();
        if (!label) return { error: 'label must not be empty', code: 'empty' };
        if (label.length > MAX_LABEL_LENGTH) return { error: `label must be ${MAX_LABEL_LENGTH} characters or fewer`, code: 'too_long' };
        if (!LABEL_PATTERN.test(label)) return { error: 'label may contain letters, digits, dot, dash, underscore', code: 'invalid_format' };
        return null;
    }

    addLabel(nodeId: number, rawLabel: string): { ok: true; label: string } | { ok: false; error: NodeLabelValidationError } {
        const validationError = this.validate(rawLabel);
        if (validationError) return { ok: false, error: validationError };
        const label = rawLabel.trim();
        const db = DatabaseService.getInstance();
        const existing = db.listNodeLabels(nodeId);
        if (existing.length >= MAX_NODE_LABELS && !existing.some(r => r.label === label)) {
            return { ok: false, error: { error: `nodes can have at most ${MAX_NODE_LABELS} labels`, code: 'too_many' } };
        }
        db.addNodeLabel(nodeId, label);
        return { ok: true, label };
    }

    removeLabel(nodeId: number, label: string): boolean {
        return DatabaseService.getInstance().removeNodeLabel(nodeId, label);
    }

    matchSelector(selector: BlueprintSelector, nodes: Node[]): Node[] {
        if (selector.type === 'nodes') {
            const ids = new Set(selector.ids);
            return nodes.filter(n => ids.has(n.id));
        }
        if (selector.type === 'labels') {
            const allRequired = (selector.all ?? []).filter(s => s.length > 0);
            const anyRequired = (selector.any ?? []).filter(s => s.length > 0);
            if (allRequired.length === 0 && anyRequired.length === 0) return [];
            const labelsByNode = DatabaseService.getInstance().getNodeLabelsMap();
            return nodes.filter(node => {
                const nodeLabels = new Set(labelsByNode[node.id] ?? []);
                if (allRequired.length > 0 && !allRequired.every(l => nodeLabels.has(l))) return false;
                if (anyRequired.length > 0 && !anyRequired.some(l => nodeLabels.has(l))) return false;
                return true;
            });
        }
        return [];
    }
}
