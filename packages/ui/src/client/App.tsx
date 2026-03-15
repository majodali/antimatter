import { useEffect, useState, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/theme-provider';
import { AuthGate } from './components/AuthGate';
import { MainLayout } from './components/layout/MainLayout';
import { TestRunnerPage } from './components/tests/TestRunnerPage';
import { ActivityLogPage } from './components/activity/ActivityLogPage';
import { ProjectPicker } from './components/projects/ProjectPicker';
import { Toaster } from './components/ui/toaster';
import { TestTabModal } from './components/tests/TestTabModal';
import { useProjectStore } from './stores/projectStore';
import { setAutomationHandler } from './stores/terminalStore';
import { workspaceConnection } from './lib/workspace-connection';
import { setProjectIdGetter } from './lib/storePersist';
import { isLockedByOther, acquireLock } from './lib/tab-lock';

// Inject per-tab project ID getter so Zustand persistence reads from
// the in-memory store (per-tab) instead of shared localStorage.
setProjectIdGetter(() => useProjectStore.getState().currentProjectId);

function ProjectGate() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const clearProject = useProjectStore((s) => s.clearProject);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const [isTestMode, setIsTestMode] = useState(false);
  const initializedRef = useRef(false);

  // Fetch fresh project list on mount so the localStorage cache is up-to-date.
  // Without this, tabs opened via URL param (e.g. test tabs) may not find
  // the project in their local projects array, breaking Header display.
  useEffect(() => { loadProjects(); }, []);

  // Read ?project= and ?testMode= URL parameters on first render
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const projectParam = params.get('project');
    const testMode = params.get('testMode') === 'true';

    if (projectParam && projectParam !== currentProjectId) {
      selectProject(projectParam);
    } else if (currentProjectId) {
      // Project loaded from localStorage — acquire lock or clear if taken
      if (isLockedByOther(currentProjectId)) {
        clearProject();
      } else {
        acquireLock(currentProjectId);
      }
    }
    if (testMode) {
      setIsTestMode(true);
    }
  }, []);

  // Initialize test executor when in test mode and project is loaded
  useEffect(() => {
    if (!isTestMode || !currentProjectId) return;

    // Dynamically import test executor to avoid bundling it in normal flow
    let cleanup: (() => void) | undefined;
    import('./lib/test-executor.js').then(({ TestExecutor }) => {
      const executor = new TestExecutor(currentProjectId);

      // Wait for app to be fully rendered AND project list loaded, then signal ready.
      // The project must be in the store's projects array so Header renders correctly.
      const checkReady = setInterval(() => {
        const readyEl = document.querySelector('[data-testid="main-layout"]');
        const { projects, currentProjectId: pid } = useProjectStore.getState();
        const projectLoaded = !pid || projects.some((p) => p.id === pid);
        if (readyEl && projectLoaded) {
          clearInterval(checkReady);
          executor.signalReady();
        }
      }, 200);

      cleanup = () => {
        clearInterval(checkReady);
        executor.dispose();
      };
    });

    return () => cleanup?.();
  }, [isTestMode, currentProjectId]);

  // Initialize automation handler for browser-side commands via WebSocket relay
  useEffect(() => {
    if (!currentProjectId) return;

    let handler: { dispose(): void } | undefined;
    import('./lib/automation-handler.js').then(({ AutomationHandler }) => {
      handler = new AutomationHandler(() => workspaceConnection.getWebSocket());
      setAutomationHandler(handler as any);
    });

    return () => {
      handler?.dispose();
      setAutomationHandler(null);
    };
  }, [currentProjectId]);

  if (!currentProjectId) {
    return <ProjectPicker />;
  }

  return <MainLayout />;
}

function App() {
  return (
    <AuthGate>
      <Router>
        <ThemeProvider defaultTheme="dark" storageKey="antimatter-theme">
          <Routes>
            <Route path="/tests" element={<TestRunnerPage />} />
            <Route path="/logs" element={<ActivityLogPage />} />
            <Route path="/*" element={<ProjectGate />} />
          </Routes>
          <Toaster />
          <TestTabModal />
        </ThemeProvider>
      </Router>
    </AuthGate>
  );
}

export default App;
