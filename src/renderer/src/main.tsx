import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/aptana.css';

const params = new URLSearchParams(window.location.search);
const isDesktopIslandWindow = params.get('windowMode') === 'desktop-island';

const MainApp = lazy(() => import('./App').then((m) => ({ default: m.App })));
const DesktopIslandRoot = lazy(() =>
  import('./components/DesktopFloatingIslandApp').then((m) => ({
    default: m.DesktopFloatingIslandApp
  }))
);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {isDesktopIslandWindow ? <DesktopIslandRoot /> : <MainApp />}
    </Suspense>
  </React.StrictMode>
);
