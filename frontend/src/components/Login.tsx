import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SSOProvider {
  provider: string;
  displayName: string;
  type: 'ldap' | 'oidc';
}

function getProviderIcon(provider: string) {
  switch (provider) {
    case 'oidc_google':
      return (
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
      );
    case 'oidc_github':
      return (
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
      );
    case 'oidc_okta':
      return (
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.389 0 0 5.389 0 12s5.389 12 12 12 12-5.389 12-12S18.611 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z" />
        </svg>
      );
    default:
      return null;
  }
}

export function Login({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { login, ssoLdapLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<'local' | 'ldap'>('local');
  const [ssoProviders, setSsoProviders] = useState<SSOProvider[]>([]);

  useEffect(() => {
    fetch('/api/auth/sso/providers', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((providers: SSOProvider[]) => setSsoProviders(providers))
      .catch(() => {});

    // Check for SSO error in URL params
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get('sso_error');
    if (ssoError) {
      setError(ssoError);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const hasLdap = ssoProviders.some(p => p.type === 'ldap');
  const oidcProviders = ssoProviders.filter(p => p.type === 'oidc');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = loginMode === 'ldap' && ssoLdapLogin
      ? await ssoLdapLogin(username, password)
      : await login(username, password);

    if (!result.success) {
      setError(result.error || 'Login failed');
    }

    setIsLoading(false);
  };

  return (
    <div className={cn("grid min-h-svh md:grid-cols-2", className)} {...props}>
      {/* ── Left: Branding Panel (desktop only) ── */}
      <div className="relative hidden md:flex flex-col items-center justify-center bg-zinc-950 overflow-hidden">
        {/* Dot grid texture */}
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.7) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Branding content */}
        <div className="relative z-10 flex flex-col items-center gap-6 px-12">
          <img
            src="/sencho-logo-dark.png"
            alt="Sencho"
            className="w-28 h-28"
            draggable={false}
          />
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white tracking-tight">Sencho</h1>
            <p className="text-base text-zinc-400 mt-2">Docker Compose Management</p>
          </div>
        </div>

        {/* Brand accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-brand" />
      </div>

      {/* ── Right: Form Panel ── */}
      <div className="flex flex-col items-center justify-center bg-background px-6 py-12">
        {/* Mobile logo header */}
        <div className="flex items-center gap-2.5 mb-10 md:hidden">
          <img src="/sencho-logo-light.png" alt="Sencho" className="w-8 h-8 dark:hidden" draggable={false} />
          <img src="/sencho-logo-dark.png" alt="Sencho" className="w-8 h-8 hidden dark:block" draggable={false} />
          <span className="text-lg font-semibold tracking-tight">Sencho</span>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to your Sencho instance
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="admin"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <div className="text-sm text-red-500 text-center">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading
                  ? 'Logging in...'
                  : loginMode === 'ldap'
                    ? 'Sign in with LDAP'
                    : 'Login'
                }
              </Button>
              {hasLdap && (
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground text-center transition-colors"
                  onClick={() => setLoginMode(loginMode === 'local' ? 'ldap' : 'local')}
                >
                  {loginMode === 'local' ? 'Sign in with LDAP instead' : 'Sign in with password instead'}
                </button>
              )}
            </div>
          </form>

          {oidcProviders.length > 0 && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {oidcProviders.map(p => (
                  <Button
                    key={p.provider}
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      window.location.href = `/api/auth/sso/oidc/${p.provider}/authorize`;
                    }}
                  >
                    {getProviderIcon(p.provider)}
                    {p.displayName}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
