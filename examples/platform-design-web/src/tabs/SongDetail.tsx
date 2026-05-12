import { useNavigate, useParams } from 'react-router-dom';
export function SongDetail() {
    const { id } = useParams();
    const nav = useNavigate();
    return (<div className="card">
      <button className="btn btn-outline" aria-label="Back" onClick={() => nav(-1)}>
        <span className="material-icons">arrow_back</span> Back
      </button>
      <h2>Song #{id}</h2>
      <p>Nested screen. Push and pop emit screen_view + view_session.</p>
      <button className="btn" aria-label="Play song">
        <span className="material-icons">play_arrow</span> Play
      </button>
    </div>);
}
