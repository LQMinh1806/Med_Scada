import { useCallback } from 'react';
import { attachCsrfHeader } from '../../utils/csrf';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export default function useScadaApi({ setCurrentUser, setIsAuthenticated }) {
  return useCallback(async (path, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormDataBody =
      typeof FormData !== 'undefined' && options.body instanceof FormData;
    const providedHeaders =
      typeof Headers !== 'undefined' && options.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : (options.headers || {});

    const defaultHeaders =
      !SAFE_HTTP_METHODS.has(method) && hasBody && !isFormDataBody
        ? { 'Content-Type': 'application/json' }
        : {};

    const headers = attachCsrfHeader(method, {
      ...defaultHeaders,
      ...providedHeaders,
    });

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 401) {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
      const message = data?.message || `Request failed: ${response.status}`;
      throw new Error(message);
    }

    return data;
  }, [setCurrentUser, setIsAuthenticated]);
}
