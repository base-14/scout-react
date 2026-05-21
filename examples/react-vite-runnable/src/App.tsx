import { useState } from 'react';
import Scout from '@base-14/scout-react';
import { useScout } from '@base-14/scout-react/react';
export function App() {
    const scout = useScout();
    const [count, setCount] = useState(0);
    const [page, setPage] = useState<'home' | 'details'>('home');
    return (<div data-testid="root" style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>scout-react example</h1>
      <p>session: <code data-testid="session-id">{Scout.sessionId}</code></p>

      <nav>
        <button data-testid="nav-home" aria-label="navigate-home" onClick={() => {
            history.pushState({}, '', '/home');
            setPage('home');
        }}>
          Home
        </button>
        <button data-testid="nav-details" aria-label="navigate-details" onClick={() => {
            history.pushState({}, '', '/details');
            setPage('details');
        }}>
          Details
        </button>
      </nav>

      <section style={{ marginTop: 24 }}>
        {page === 'home' ? (<Home count={count} onIncrement={() => setCount(count + 1)}/>) : (<Details />)}
      </section>

      <hr style={{ margin: '24px 0' }}/>

      <h2>actions</h2>
      <button data-testid="log-event" aria-label="log-event" onClick={() => scout.logEvent('demo_event', { source: 'button', n: count })}>
        Scout.logEvent
      </button>
      <button data-testid="log-info" aria-label="log-info" onClick={() => scout.logInfo('user clicked log info', { count })}>
        Scout.logInfo
      </button>
      <button data-testid="report-error" aria-label="report-error" onClick={() => scout.reportError(new Error('synthetic handled error'))}>
        Scout.reportError
      </button>
      <button data-testid="throw" aria-label="throw" onClick={() => {
            throw new Error('uncaught render-cycle error');
        }}>
        Throw uncaught
      </button>
      <button data-testid="fetch" aria-label="fetch" onClick={() => {
            void fetch('http://127.0.0.1:5173/index.html').catch(() => { });
        }}>
        fetch first-party
      </button>
      <button data-testid="set-user" aria-label="set-user" onClick={() => scout.setUser('user-42', { plan: 'pro' })}>
        setUser
      </button>
      <button data-testid="long-task" aria-label="long-task" onClick={() => {
            const end = performance.now() + 250;
            while (performance.now() < end) {
            }
        }}>
        Trigger long task
      </button>
    </div>);
}
function Home({ count, onIncrement }: {
    count: number;
    onIncrement: () => void;
}) {
    return (<div>
      <h2>Home</h2>
      <button data-testid="increment" aria-label="increment-counter" onClick={onIncrement}>
        increment ({count})
      </button>
    </div>);
}
function Details() {
    return (<div>
      <h2>Details</h2>
      <p>Static content. Navigating here emits a screen_view span.</p>
    </div>);
}
