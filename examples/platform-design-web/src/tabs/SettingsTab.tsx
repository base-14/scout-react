import { useState } from 'react';
const ROWS: Array<{
    key: string;
    label: string;
    sub?: string;
}> = [
    { key: 'autoplay', label: 'Autoplay', sub: 'Play the next song automatically' },
    { key: 'wifi', label: 'WiFi only downloads', sub: 'Conserve mobile data' },
    { key: 'beta', label: 'Beta features', sub: 'Try experimental things' },
    { key: 'notifications', label: 'Push notifications' },
];
export function SettingsTab() {
    const [state, setState] = useState<Record<string, boolean>>({
        autoplay: true,
        wifi: false,
        beta: false,
        notifications: true,
    });
    return (<div className="card">
      {ROWS.map((row) => (<div className="list-row" key={row.key}>
          <span className="material-icons">tune</span>
          <div className="grow">
            <div className="title">{row.label}</div>
            {row.sub && <div className="subtitle">{row.sub}</div>}
          </div>
          <div className={`switch ${state[row.key] ? 'on' : ''}`} role="switch" aria-checked={state[row.key]} aria-label={`Toggle ${row.label}`} onClick={() => setState((s) => ({ ...s, [row.key]: !s[row.key] }))}/>
        </div>))}
    </div>);
}
