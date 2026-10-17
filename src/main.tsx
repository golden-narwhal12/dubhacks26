import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/tokens.css';
import './ui/workspace.css';
import './services/agent';
createRoot(document.getElementById('root')!).render(<App />);
