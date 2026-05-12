import { Link } from 'react-router-dom';
const SONGS = [
    { id: '1', title: 'Echoes of Tomorrow', artist: 'Aurora Skies', duration: '4:12' },
    { id: '2', title: 'Midnight Lattice', artist: 'Lumen Drift', duration: '3:38' },
    { id: '3', title: 'Quiet Static', artist: 'Pale Continent', duration: '5:01' },
    { id: '4', title: 'Glasswater', artist: 'Halcyon', duration: '3:51' },
    { id: '5', title: 'Northbound', artist: 'Long Way Home', duration: '4:27' },
    { id: '6', title: 'Heat Bloom', artist: 'Velvet Tigers', duration: '2:58' },
];
export function SongsTab() {
    return (<>
      <button className="btn btn-outline" aria-label="Refresh">
        <span className="material-icons">refresh</span> Refresh
      </button>

      <div style={{ marginTop: 12 }}>
        {SONGS.map((song) => (<Link key={song.id} to={`/songs/${song.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }} aria-label={`Open ${song.title}`}>
            <h3>{song.title}</h3>
            <p>
              {song.artist} · {song.duration}
            </p>
          </Link>))}
      </div>
    </>);
}
