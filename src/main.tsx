import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Journal typography (OFL): Bodoni Moda for the masthead, Noto Serif SC for Chinese headlines
import '@fontsource/bodoni-moda/latin-400.css';
import '@fontsource/bodoni-moda/latin-700.css';
import '@fontsource/bodoni-moda/latin-400-italic.css';
import '@fontsource/noto-serif-sc/600.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
