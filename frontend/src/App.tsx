import { AuthProvider, useAuth } from './context/AuthContext';
import { NodeProvider } from './context/NodeContext';
import { LicenseProvider } from './context/LicenseContext';
import { Login } from './components/Login';
import { Setup } from './components/Setup';
import EditorLayout from './components/EditorLayout';
import { MfaChallenge } from './components/MfaChallenge';

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
    return <Setup onComplete={completeSetup} />;
  }

  if (appStatus === 'mfaChallenge') {
    return <MfaChallenge />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <NodeProvider>
      <LicenseProvider>
        <EditorLayout />
      </LicenseProvider>
    </NodeProvider>
  );
}

import { ToastContainer } from './components/ui/toast';

function App() {
  return (
    <AuthProvider>
      <AppContent />
      <ToastContainer />
    </AuthProvider>
  );
}

export default App;
