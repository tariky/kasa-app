// Mora biti prvi: pod Tauri-jem pravi `window.api` prije nego ga ekrani koriste.
import './tauri/api';
import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { primijeniSacuvanuSkalu } from './lib/skala';

// Prvi poziv u backend: pozivi idu redom, pa je zoom primijenjen prije nego
// ekrani dobiju podatke.
primijeniSacuvanuSkalu().catch(() => undefined);

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
