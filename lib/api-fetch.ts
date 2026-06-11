/**
 * Wraps fetch and calls onUnauthorized on 401 responses (typically a redirect
 * to /login). Demo sessions are real authenticated sessions, so they get the
 * same treatment — a 401 means the session is gone.
 */
export function createApiFetch(onUnauthorized: () => void) {
  return async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (res.status === 401) {
      onUnauthorized();
    }
    return res;
  };
}
