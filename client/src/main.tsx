import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      // Hold data in cache so moving between tabs is instant, but always
      // refetch on mount when the data has been invalidated - otherwise a page
      // mounted after a mutation shows the pre-mutation snapshot.
      gcTime: 10 * 60_000,
      refetchOnMount: true,
      refetchOnReconnect: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        // Never retry auth or permission failures - they will not resolve.
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
    },
  },
});

const rootEl = document.getElementById('root');

if (!rootEl) {
  // The mount point is missing entirely - say so rather than failing silently.
  document.body.innerHTML =
    '<pre style="padding:24px;font:13px ui-monospace,monospace">' +
    'Policy Prism: no #root element found in index.html.' +
    '</pre>';
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <BrowserRouter>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </ToastProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
