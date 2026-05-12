const ARTICLES = [
    {
        title: 'OpenTelemetry 2.x lands for JavaScript',
        excerpt: 'The browser SDK gains a stable resource API and a logs pipeline. Scout-react ships on top of it.',
    },
    {
        title: 'Why your dashboard should look the same on web and mobile',
        excerpt: 'Same attribute keys, one collector, two SDKs. Less code to maintain, fewer bugs to chase.',
    },
    {
        title: 'Crash detection without native code',
        excerpt: 'Session-marker checkpoints survive OOM kills. Works the same way on Flutter, React, and React Native.',
    },
];
export function NewsTab() {
    return (<>
      {ARTICLES.map((a, i) => (<div key={i} className="card" aria-label={`Open ${a.title}`} role="button">
          <h3>{a.title}</h3>
          <p>{a.excerpt}</p>
        </div>))}
    </>);
}
