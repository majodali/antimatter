import { BrowserRouter as Router } from 'react-router-dom';
import { ThemeProvider } from './components/theme-provider';
import { MainLayout } from './components/layout/MainLayout';

function App() {
  return (
    <Router>
      <ThemeProvider defaultTheme="dark" storageKey="antimatter-theme">
        <MainLayout />
      </ThemeProvider>
    </Router>
  );
}

export default App;
