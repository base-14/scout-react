export function DiagnosticsPanel() {
    return (<div className="card">
      <h3>Diagnostics</h3>
      <p>
        Each button triggers a real browser event. scout-react auto-captures it.
        Nothing here calls the SDK directly.
      </p>

      <div className="diag-grid">
        <button className="btn" aria-label="Fetch a 200 response" onClick={() => {
            void fetch('http://127.0.0.1:5174/vite.svg').catch(() => { });
        }}>
          fetch (200)
        </button>

        <button className="btn" aria-label="Fetch a 404 response" onClick={() => {
            void fetch('http://127.0.0.1:5174/does-not-exist').catch(() => { });
        }}>
          fetch (404)
        </button>

        <button className="btn" aria-label="Fetch a network error" onClick={() => {
            void fetch('http://127.0.0.1:9/never-listens').catch(() => { });
        }}>
          fetch (network err)
        </button>

        <button className="btn btn-danger" aria-label="Throw async uncaught" onClick={() => {
            setTimeout(() => {
                throw new Error('async uncaught error');
            }, 0);
        }}>
          throw async
        </button>

        <button className="btn btn-danger" aria-label="Throw inside render" onClick={() => {
            throw new Error('synchronous render-cycle error');
        }}>
          throw render-cycle
        </button>

        <button className="btn btn-danger" aria-label="Unhandled promise rejection" onClick={() => {
            void Promise.reject(new Error('unhandled rejection demo'));
        }}>
          unhandled rejection
        </button>

        <button className="btn btn-danger" aria-label="Run a long task" onClick={() => {
            const end = performance.now() + 250;
            while (performance.now() < end) {
            }
        }}>
          long task (250ms)
        </button>

        <button className="btn btn-danger" aria-label="Run a frozen frame" onClick={() => {
            const end = performance.now() + 800;
            while (performance.now() < end) {
            }
        }}>
          frozen frame (800ms)
        </button>

        <button className="btn btn-danger" aria-label="Simulate a crash" onClick={() => {
            location.reload();
        }}>
          simulate crash (reload)
        </button>
      </div>
    </div>);
}
