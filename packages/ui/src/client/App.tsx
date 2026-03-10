import { useEffect, useState, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/theme-provider';
import { AuthGate } from './components/AuthGate';
import { MainLayout } from './components/layout/MainLayout';
import { TestRunnerPage } from './components/tests/TestRunnerPage';
import { ActivityLogPage } from './components/activity/ActivityLogPage';
import { ProjectPicker } from './components/projects/ProjectPicker';
import { Toaster } from './components/ui/toaster';
import { useProjectStore } from './stores/projectStore';

function ProjectGate() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const [isTestMode, setIsTestMode] = useState(false);
  const initializedRef = useRef(false);

  // Read ?project= and ?testMode= URL parameters on first render
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const projectParam = params.get('project');
    const testMode = params.get('testMode') === 'true';

    if (projectParam && projectParam !== currentProjectId) {
      selectProject(projectParam);
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

      // Wait for app to be fully rendered (main-layout visible), then signal ready
      const checkReady = setInterval(() => {
        const readyEl = document.querySelector('[data-testid="main-layout"]');
        if (readyEl) {
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
        </ThemeProvider>
      </Router>
    </AuthGate>
  );
}

export default App;
