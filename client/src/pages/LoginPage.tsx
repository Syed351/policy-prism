import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PRODUCT_DISCLAIMER, STATES } from '@policy-prism/shared';
import { api, ApiClientError, setToken } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';

const DEMO_ACCOUNTS = [
  { email: 'admin@policyprism.demo', role: 'Compliance manager', can: 'edit, review, profile, run, export' },
  { email: 'reviewer@policyprism.demo', role: 'Compliance reviewer', can: 'review, run, export' },
  { email: 'analyst@policyprism.demo', role: 'Policy analyst', can: 'edit, profile, run, export' },
  { email: 'auditor@policyprism.demo', role: 'Auditor (read only)', can: 'export' },
];

const DEMO_PASSWORD = 'PolicyPrism!2026';

export default function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@policyprism.demo');
  const [password, setPassword] = useState(() =>
    new URLSearchParams(window.location.search).get('token') ? '' : DEMO_PASSWORD,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A token in the URL means the user followed the emailed link.
  const cameFromEmail = !!new URLSearchParams(window.location.search).get('token');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset'>(() =>
    new URLSearchParams(window.location.search).get('token') ? 'reset' : 'signin',
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [facilityName, setFacilityName] = useState('');
  const [state, setState] = useState('OH');
  const [fullName, setFullName] = useState('');
  const [resetToken, setResetToken] = useState(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
  );

  // Never render nothing: a blank screen is indistinguishable from a crash.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2.5 text-ink-3">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-ink" />
          <span className="text-[13px]">Checking your session&hellip;</span>
        </div>
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;

  const go = (next: typeof mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPreviewUrl(null);
    setShowPassword(false);

    // The demo credentials are sign-in conveniences. Carrying them into
    // sign-up or reset is confusing, and that address already exists.
    if (next === 'signup') {
      setEmail('');
      setPassword('');
    } else if (next === 'forgot') {
      setPassword('');
    } else if (next === 'reset') {
      // Never carry a previous password into the new-password field.
      setPassword('');
    } else if (next === 'signin') {
      setEmail(DEMO_ACCOUNTS[0].email);
      setPassword(DEMO_PASSWORD);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        navigate('/dashboard');
      } else if (mode === 'signup') {
        const { data } = await api.post<{ token: string }>('/api/auth/signup', {
          organizationName,
          facilityName,
          state,
          name: fullName,
          email: email.trim(),
          password,
        });
        setToken(data.token);
        // A new organisation starts empty, so land on the facility profile.
        window.location.assign('/facility');
      } else if (mode === 'forgot') {
        const { data } = await api.post<{
          devToken?: string;
          previewUrl?: string;
          message: string;
        }>('/api/auth/forgot-password', { email: email.trim() });
        setNotice(data.message);
        setPreviewUrl(data.previewUrl ?? null);
        if (data.devToken) {
          setResetToken(data.devToken);
          go('reset');
        }
      } else {
        await api.post('/api/auth/reset-password', { token: resetToken, password });
        setResetToken('');
        window.history.replaceState(null, '', '/login');
        go('signin');
        setEmail('');
        setNotice('Password updated. Sign in with your new password.');
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : mode === 'signin'
            ? 'Sign-in failed'
            : 'Request failed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-8">
      <div className="w-[min(420px,100%)]">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2 22 20H2L12 2Z" stroke="#1B6048" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M12 2v18" stroke="#1B6048" strokeWidth="1.2" opacity=".6" />
          </svg>
          <b className="text-[17px] font-semibold tracking-[-0.01em]">Policy Prism</b>
        </div>

        <div className="rounded-lg border border-line bg-panel px-7 pb-6 pt-7 shadow-gate">
          <h2 className="text-[17px]">
            {mode === 'signin'
              ? 'Sign in'
              : mode === 'signup'
                ? 'Create an organization'
                : mode === 'forgot'
                  ? 'Reset your password'
                  : 'Choose a new password'}
          </h2>
          <p className="mb-5 mt-1 text-xs2 text-ink-3">
            {mode === 'signin'
              ? 'Policy coverage assessment for your facility\u2019s regulatory obligations.'
              : mode === 'signup'
                ? 'Creates a new organization with its own facility, libraries and analysis history. To join an existing organization, ask its compliance manager to add you.'
                : mode === 'forgot'
                  ? 'Enter the address on your account and a reset link will be issued.'
                  : cameFromEmail
                    ? 'Pick a new password for your account.'
                    : 'Paste the reset token and choose a new password.'}
          </p>

          {notice && (
            <div className="mb-3.5 rounded border-l-2 border-seal bg-seal-bg px-3 py-2.5 text-xs2 text-[#155039]">
              {notice}
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block font-medium underline"
                >
                  Open the email &rarr;
                </a>
              )}
            </div>
          )}

          {error && (
            <div className="mb-3.5 rounded border-l-2 border-flag bg-flag-bg px-3 py-2.5 text-xs2 text-[#7C2B1B]">
              {error}
            </div>
          )}

          <form onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <>
                <div className="pp-field mb-3.5">
                  <label htmlFor="org">Organization name</label>
                  <input
                    id="org"
                    className="pp-input"
                    placeholder="Riverbend Health System"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    required
                  />
                </div>
                <div className="pp-field mb-3.5">
                  <label htmlFor="fac">First facility</label>
                  <input
                    id="fac"
                    className="pp-input"
                    placeholder="Riverbend Regional Medical Center"
                    value={facilityName}
                    onChange={(e) => setFacilityName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                  <div className="pp-field mb-3.5">
                    <label htmlFor="fullname">Your name</label>
                    <input
                      id="fullname"
                      className="pp-input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="pp-field mb-3.5">
                    <label htmlFor="state">State</label>
                    <select
                      id="state"
                      className="pp-select"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                    >
                      {STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {mode === 'reset' && (
              <div className={`pp-field mb-3.5 ${cameFromEmail ? 'hidden' : ''}`}>
                <label htmlFor="token">Reset token</label>
                <input
                  id="token"
                  className="pp-input font-mono text-[12px]"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  required
                />
              </div>
            )}

            <div className={`pp-field mb-3.5 ${mode === 'reset' ? 'hidden' : ''}`}>
              <label htmlFor="email">{mode === 'signup' ? 'Your work email' : 'Email'}</label>
              <input
                id="email"
                type="email"
                autoComplete={mode === 'signup' ? 'email' : 'username'}
                className="pp-input"
                placeholder={mode === 'signup' ? 'you@yourhospital.org' : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className={`pp-field mb-3.5 ${mode === 'forgot' ? 'hidden' : ''}`}>
              <label htmlFor="password">{mode === 'signin' ? 'Password' : 'New password'}</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="pp-input pr-16"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[12px] text-ink-3 hover:bg-panel-2 hover:text-ink"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {mode !== 'signin' && (
                <p className="mt-1 text-tiny text-ink-3">
                  At least 10 characters, including a letter and a number.
                </p>
              )}
            </div>

            <button type="submit" className="pp-btn pp-btn-primary mt-1 w-full py-2.5" disabled={busy}>
              {busy
                ? 'Working\u2026'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create organization'
                    : mode === 'forgot'
                      ? 'Send reset link'
                      : 'Update password'}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            {mode === 'signin' ? (
              <>
                <button type="button" className="text-ink-2 hover:underline" onClick={() => go('forgot')}>
                  Forgot password?
                </button>
                <button type="button" className="text-ink-2 hover:underline" onClick={() => go('signup')}>
                  Create an account
                </button>
              </>
            ) : (
              <button type="button" className="text-ink-2 hover:underline" onClick={() => go('signin')}>
                &larr; Back to sign in
              </button>
            )}
          </div>

          {mode === 'signin' && (
          <div className="mt-6 border-t border-line-2 pt-4">
            <div className="pp-label mb-1.5">Demo accounts</div>
            <p className="mb-2 text-tiny text-ink-3">
              Password for all four: <code className="font-mono text-ink">{DEMO_PASSWORD}</code>
            </p>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                }}
                className="flex w-full items-baseline justify-between gap-3 border-b border-line-2 py-2 text-left last:border-b-0 hover:bg-panel-2"
              >
                <code className="font-mono text-[12px] text-ink">{a.email.split('@')[0]}</code>
                <span className="flex-1 text-xs2 text-ink-3">{a.role}</span>
                <span className="text-[10.5px] text-ink-3">use</span>
              </button>
            ))}
          </div>
          )}
        </div>

        <p className="mx-auto mt-4 max-w-[420px] text-center text-tiny text-ink-3">{PRODUCT_DISCLAIMER}</p>
      </div>
    </div>
  );
}
