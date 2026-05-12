import React from 'react';
import { createRoot } from 'react-dom/client';
import Scout from '@base14/scout-react';
import { ScoutErrorBoundary } from '@base14/scout-react/react';
import { App } from './App';
await Scout.initialize({
    serviceName: 'scout-react-example',
    serviceVersion: '0.0.0',
    environment: 'local',
    endpoint: 'http://127.0.0.1:34318',
    secure: false,
    debug: true,
    firstPartyHosts: ['127.0.0.1', 'localhost'],
    captureConsole: true,
    metricExportIntervalMs: 1500,
    logExportScheduledDelayMs: 1000,
});
createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <ScoutErrorBoundary fallback={(e) => <pre>{e.message}</pre>}>
      <App />
    </ScoutErrorBoundary>
  </React.StrictMode>);
(globalThis as any).__SCOUT_READY__ = true;
(globalThis as any).__SCOUT_FLUSH__ = () => Scout.flush();
