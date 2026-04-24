const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCsrfTokenFromCookie() {
  if (typeof document === 'undefined') return '';

  const raw = document.cookie || '';
  if (!raw) return '';

  const entries = raw.split(';');
  for (const entry of entries) {
    const [key, ...rest] = entry.split('=');
    if (!key) continue;
    if (key.trim() !== 'scada_csrf_token') continue;

    const value = rest.join('=').trim();
    if (!value) return '';

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return '';
}

export function attachCsrfHeader(method, headers = {}) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (SAFE_HTTP_METHODS.has(normalizedMethod)) return headers;

  const token = readCsrfTokenFromCookie();
  if (!token) return headers;

  return {
    ...headers,
    'X-CSRF-Token': token,
  };
}
