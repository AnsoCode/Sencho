import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type AppStatus = 'loading' | 'needsSetup' | 'notAuthenticated' | 'authenticated';

interface AuthContextType {
  appStatus: AppStatus;
  isAuthenticated: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  completeSetup: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [appStatus, setAppStatus] = useState<AppStatus>('loading');

  const checkAuth = async () => {
    try {
      // First check if setup is needed
      const statusResponse = await fetch('/api/auth/status', {
        credentials: 'include',
      });
      const statusData = await statusResponse.json();
      
      if (statusData.needsSetup) {
        setAppStatus('needsSetup');
        return;
      }

      // Then check if already authenticated
      const authResponse = await fetch('/api/auth/check', {
        credentials: 'include',
      });
      
      if (authResponse.ok) {
        setAppStatus('authenticated');
      } else {
        setAppStatus('notAuthenticated');
      }
    } catch {
      setAppStatus('notAuthenticated');
    }
  };

  useEffect(() => {
    checkAuth();
    const handleUnauthorized = () => setAppStatus('notAuthenticated');
    window.addEventListener('sencho-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('sencho-unauthorized', handleUnauthorized);
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setAppStatus('authenticated');
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setAppStatus('notAuthenticated');
    }
  };

  const completeSetup = () => {
    setAppStatus('authenticated');
  };

  return (
    <AuthContext.Provider value={{ 
      appStatus, 
      isAuthenticated: appStatus === 'authenticated', 
      needsSetup: appStatus === 'needsSetup',
      login, 
      logout, 
      completeSetup,
      checkAuth 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
