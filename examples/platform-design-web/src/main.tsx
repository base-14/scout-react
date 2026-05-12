import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Scout from '@base14/scout-react';
import { ScoutErrorBoundary } from '@base14/scout-react/react';
import { App } from './App';
import './styles.css';
await Scout.initialize({
    serviceName: 'platform-design-web',
    serviceVersion: '0.1.0',
    environment: 'local',
    endpoint: 'http://127.0.0.1:34318',
    secure: false,
    firstPartyHosts: ['127.0.0.1', 'localhost'],
    metricExportIntervalMs: 2000,
    logExportScheduledDelayMs: 1000,
});
Scout.setUser('nimish-test-01', {
    email: 'nimish@base14.io',
    name: 'Nimish GJ',
    role: 'developer',
    company: 'Base14',
});
createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <ScoutErrorBoundary fallback={(e) => (<div style={{ padding: 24 }}>
          <h2>Something broke</h2>
          <pre>{e.message}</pre>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>)}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ScoutErrorBoundary>
  </React.StrictMode>);
