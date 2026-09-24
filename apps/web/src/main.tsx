import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import './styles.css';

const APP_VIEWPORT_HEIGHT_PROPERTY = '--app-viewport-height';

function syncAppViewportHeight(): void {
  const innerHeight = window.innerHeight;
  const visualViewportHeight = window.visualViewport?.height ?? 0;
  const viewportHeight = innerHeight > 0 ? innerHeight : visualViewportHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;

  document.documentElement.style.setProperty(APP_VIEWPORT_HEIGHT_PROPERTY, `${viewportHeight}px`);
}

syncAppViewportHeight();
window.addEventListener('resize', syncAppViewportHeight);
window.visualViewport?.addEventListener('resize', syncAppViewportHeight);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
