import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SongsTab } from './tabs/SongsTab';
import { NewsTab } from './tabs/NewsTab';
import { ProfileTab } from './tabs/ProfileTab';
import { SettingsTab } from './tabs/SettingsTab';
import { SongDetail } from './tabs/SongDetail';
const TITLES: Record<string, string> = {
    '/songs': 'Songs',
    '/news': 'News',
    '/profile': 'Profile',
    '/settings': 'Settings',
};
export function App() {
    const location = useLocation();
    const title = TITLES[location.pathname] ??
        (location.pathname.startsWith('/songs/') ? 'Song' : 'Platform Design');
    return (<>
      <header className="app-bar">
        <span className="material-icons" aria-hidden>
          music_note
        </span>
        <h1>{title}</h1>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/songs" replace/>}/>
          <Route path="/songs" element={<SongsTab />}/>
          <Route path="/songs/:id" element={<SongDetail />}/>
          <Route path="/news" element={<NewsTab />}/>
          <Route path="/profile" element={<ProfileTab />}/>
          <Route path="/settings" element={<SettingsTab />}/>
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Primary">
        <NavLink to="/songs">
          <span className="material-icons" aria-hidden>
            music_note
          </span>
          Songs
        </NavLink>
        <NavLink to="/news">
          <span className="material-icons" aria-hidden>
            article
          </span>
          News
        </NavLink>
        <NavLink to="/profile">
          <span className="material-icons" aria-hidden>
            person
          </span>
          Profile
        </NavLink>
        <NavLink to="/settings">
          <span className="material-icons" aria-hidden>
            settings
          </span>
          Settings
        </NavLink>
      </nav>
    </>);
}
