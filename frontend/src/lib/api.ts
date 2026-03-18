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
    // Clear auth state and redirect to login
    window.location.href = '/';
    throw new Error('Unauthorized');
  }

  return response;
}

export { API_BASE };
