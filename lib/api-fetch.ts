/**
 * Wraps fetch and redirects to /login on 401 responses (skipped in demo mode).
 */
export function createApiFetch(isDemo: boolean, onUnauthorized: () => void) {
  return async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (res.status === 401 && !isDemo) {
      onUnauthorized();
    }
    return res;
  };
}
