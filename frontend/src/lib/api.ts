const API_BASE = '/api';

export interface ApiFetchOptions extends RequestInit {
  /** When true, omits the x-node-id header so the request always targets
   *  the local node regardless of which node is currently active in the UI. */
  localOnly?: boolean;
}

export async function apiFetch(
  endpoint: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const { localOnly, ...fetchOptions } = options;
  const url = `${API_BASE}${endpoint}`;
  const activeNodeId = localOnly ? null : localStorage.getItem('sencho-active-node');

  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(activeNodeId ? { 'x-node-id': activeNodeId } : {}),
      ...fetchOptions.headers,
    },
  };

  const response = await fetch(url, { ...defaultOptions, ...fetchOptions });

  if (response.status === 401) {
    // Signal auth failure to AuthContext without a hard page reload
    window.dispatchEvent(new Event('sencho-unauthorized'));
    throw new Error('Unauthorized');
  }

  // Intercept 404 Node Not Found responses and force context refresh
  if (response.status === 404) {
    try {
      const clone = response.clone();
      const errData = await clone.json();
      if (errData.error && errData.error.includes('not found') && errData.error.includes('Node')) {
        window.dispatchEvent(new Event('node-not-found'));
      }
    } catch (e) {
      // Ignore JSON parse errors, caller handles standard 404s
    }
  }

  return response;
}

export { API_BASE };
