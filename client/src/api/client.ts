import type { ApiResponse } from '@policy-prism/shared';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'pp_token';
const BRANCH_KEY = 'pp_branch';

/** The branch every request operates on. Validated server-side. */
export function getBranchId(): number | null {
  try {
    const v = localStorage.getItem(BRANCH_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setBranchId(id: number | null): void {
  try {
    if (id) localStorage.setItem(BRANCH_KEY, String(id));
    else localStorage.removeItem(BRANCH_KEY);
  } catch {
    /* storage unavailable - the session falls back to the home branch */
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(BRANCH_KEY);
    }
  } catch {
    /* storage unavailable - the session just will not persist across reloads */
  }
}

/** Thrown for every non-2xx response, carrying the server's message. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Multipart payload; when set, `body` is ignored. */
  form?: FormData;
  signal?: AbortSignal;
}

/**
 * Resolves a path against the API base exactly once. Every request goes through
 * here, so a path can never pick up the prefix twice - including when
 * VITE_API_URL is set to a relative path such as `/backend`.
 */
function resolve(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return BASE && withSlash.startsWith(`${BASE}/`) ? withSlash : `${BASE}${withSlash}`;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = resolve(path);
  if (!params) return url;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => search.append(k, String(x)));
    else search.set(k, String(v));
  });
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const branch = getBranchId();
  if (branch) headers['X-Branch-Id'] = String(branch);

  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(resolve(path), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    });
  } catch (err) {
    throw new ApiClientError(0, 'Could not reach the server. Is the API running?', 'NETWORK', String(err));
  }

  if (res.status === 204) return { data: undefined as T };

  let payload: ApiResponse<T>;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(res.status, `Unexpected response from the server (${res.status})`, 'BAD_RESPONSE');
  }

  if (!res.ok || payload.success === false) {
    const error = payload.success === false ? payload.error : { message: `Request failed (${res.status})` };

    // A 401 means the session is over. Rather than navigating away from here -
    // a hard redirect fires even on a transient failure and throws the user out
    // mid-task - announce it and let the auth provider clear its state. React
    // Router then moves to the sign-in page as part of the normal render.
    //
    // The session probe is exempt: it is allowed to fail quietly while the app
    // works out whether anyone is signed in.
    if (res.status === 401) {
      const isSessionProbe = /\/api\/auth\/(me|login)$/.test(path.split('?')[0]);
      if (!isSessionProbe) {
        setToken(null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('pp:session-expired'));
        }
      }
    }
    // A stored branch that no longer exists would make every request fail;
    // drop it so the next one falls back to the user's home profile.
    if (res.status === 403 && /branch|organisation|organization/i.test(error.message)) {
      setBranchId(null);
    }
    throw new ApiClientError(res.status, error.message, error.code ?? 'ERROR', (error as { details?: unknown }).details);
  }

  return { data: payload.data, meta: payload.meta };
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal) =>
    request<T>(buildUrl(path, params), { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};

/** Data-only helper for the common case. */
export const fetchData = async <T>(path: string, params?: Record<string, unknown>): Promise<T> =>
  (await api.get<T>(path, params)).data;

/**
 * Triggers a real file download from the API. The server sets the filename in
 * Content-Disposition; we honour it so the file lands with the right name.
 */
export async function downloadFile(path: string, params?: Record<string, unknown>): Promise<string> {
  const token = getToken();
  // The server has no idea what timezone the reader is in; without this a
  // report generated at 2pm local is stamped with the server's UTC time.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  params = { ...(params ?? {}), tz };
  const branch = getBranchId();
  const res = await fetch(buildUrl(path, params), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branch ? { 'X-Branch-Id': String(branch) } : {}),
    },
  });

  if (!res.ok) {
    // Same session handling as request(): a rejected token is a dead token.
    if (res.status === 401) setToken(null);
    let message = `Export failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiResponse<unknown>;
      if (body.success === false) message = body.error.message;
    } catch {
      /* keep the generic message */
    }
    throw new ApiClientError(res.status, message);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const name = match?.[1] ?? 'policy-prism-export';

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}
