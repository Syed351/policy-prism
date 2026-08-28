import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthUser, Permission, can as canFor } from '@policy-prism/shared';
import { api, ApiClientError, getToken, setToken } from '@/api/client';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Restore the session on first paint if a token is already stored.
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    // A hung request must not trap the app on a loading screen forever.
    const controller = new AbortController();
    // Generous: a sleeping free-tier container can take 30s to wake, and
    // aborting early used to look identical to a rejected token.
    const timeout = setTimeout(() => controller.abort(), 30_000);

    api
      .get<{ user: AuthUser }>('/api/auth/me', undefined, controller.signal)
      .then(({ data }) => {
        if (!cancelled) setUser(data.user);
      })
      .catch((err: unknown) => {
        // Only a 401 means the token is bad. A timeout, a network drop or a
        // 500 says nothing about the session - discarding it on those logged
        // people out for a slow response, which is what made a hard refresh
        // bounce to the sign-in page.
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) {
          setToken(null);
          if (!cancelled) setUser(null);
          return;
        }

        // Transient failure: keep the token and let the user retry. The router
        // still sends them to sign-in for this render, but their session
        // survives a reload.
        // eslint-disable-next-line no-console
        console.warn('[auth] session check failed, keeping the token:', (err as Error).message);
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // The API client announces an expired session rather than navigating away.
  // Clearing the user here lets the router move to sign-in as a normal render,
  // so a transient failure cannot yank someone out of what they were doing.
  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('pp:session-expired', onExpired);
    return () => window.removeEventListener('pp:session-expired', onExpired);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const { data } = await api.post<{ user: AuthUser; token: string }>('/api/auth/login', {
          email,
          password,
        });
        setToken(data.token);
        setUser(data.user);
        queryClient.clear();
      } catch (err) {
        const message = err instanceof ApiClientError ? err.message : 'Sign-in failed';
        setError(message);
        throw err;
      }
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* the token is being discarded either way */
    }
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      signIn,
      signOut,
      can: (permission: Permission) => canFor(user?.role ?? null, permission),
    }),
    [user, loading, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Two-letter avatar initials, as the prototype rendered them. */
export const initials = (name: string): string =>
  String(name || '')
    .split(/\s+/)
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
