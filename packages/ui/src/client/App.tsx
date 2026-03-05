import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/theme-provider';
import { AuthGate } from './components/AuthGate';
import { MainLayout } from './components/layout/MainLayout';
import { TestRunnerPage } from './components/tests/TestRunnerPage';
import { ActivityLogPage } from './components/activity/ActivityLogPage';
import { ProjectPicker } from './components/projects/ProjectPicker';
import { useProjectStore } from './stores/projectStore';

function ProjectGate() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

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
        </ThemeProvider>
      </Router>
    </AuthGate>
  );
}

export default App;
