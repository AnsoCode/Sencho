import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Login({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(username, password);

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
                {isLoading ? 'Logging in...' : 'Login'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
