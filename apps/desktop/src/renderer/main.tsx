import '@basalt/ui/styles.css';
import 'katex/dist/katex.min.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearance } from './lib/appearance';

applyAppearance();

createRoot(document.getElementById('root')!).render(<App />);
