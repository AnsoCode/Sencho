/** Cross-component custom event constants and typed detail interfaces. */

export const SENCHO_OPEN_LOGS_EVENT = 'sencho-open-logs';

export interface SenchoOpenLogsDetail {
  containerId: string;
  containerName: string;
}
