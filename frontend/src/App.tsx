import { AuthProvider, useAuth } from './context/AuthContext';
import { NodeProvider } from './context/NodeContext';
import { Login } from './components/Login';
import { Setup } from './components/Setup';
import EditorLayout from './components/EditorLayout';

function AppContent() {
  const { appStatus, isAuthenticated, needsSetup, completeSetup } = useAuth();

  if (appStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Setup className="w-full max-w-sm" onComplete={completeSetup} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Login className="w-full max-w-sm" />
      </div>
    );
  }

  return <EditorLayout />;
}

import { Toaster } from 'sonner';

function App() {
  return (
    <AuthProvider>
      <NodeProvider>
        <AppContent />
        <Toaster position="bottom-right" richColors />
      </NodeProvider>
    </AuthProvider>
  );
}

export default App;
