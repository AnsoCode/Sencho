const API_BASE = '/api';

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${API_BASE}${endpoint}`;
  const activeNodeId = localStorage.getItem('sencho-active-node');
  
  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(activeNodeId ? { 'x-node-id': activeNodeId } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, { ...defaultOptions, ...options });

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
