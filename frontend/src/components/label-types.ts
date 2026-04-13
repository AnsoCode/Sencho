export type LabelColor = 'teal' | 'blue' | 'purple' | 'rose' | 'amber' | 'green' | 'orange' | 'pink' | 'cyan' | 'slate';

export const LABEL_COLORS: LabelColor[] = ['teal', 'blue', 'purple', 'rose', 'amber', 'green', 'orange', 'pink', 'cyan', 'slate'];

export const MAX_LABELS_PER_NODE = 50;

export interface Label {
    id: number;
    node_id: number;
    name: string;
    color: LabelColor;
}
