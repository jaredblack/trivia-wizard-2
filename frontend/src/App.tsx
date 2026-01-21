import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage';
import ProtectedRoute from './ProtectedRoute';
import HostLanding from './features/host/HostLanding';
import HostGame from './features/host/HostGame';
import TeamFlow from './features/team/TeamFlow';
import PublicScoreboard from './features/watcher/PublicScoreboard';

export default function App() {
  return (
    <Router>
      <div className="max-w-screen-xl mx-auto">
        <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/home" element={<LandingPage />} />

        {/* Team routes */}
        <Route path="/join" element={<TeamFlow />} />
        <Route path="/watch" element={<PublicScoreboard />} />

        {/* Host routes (protected) */}
        <Route path="/host" element={<ProtectedRoute />}>
          <Route index element={<HostLanding />} />
          <Route path="game" element={<HostGame />} />
        </Route>
        <Route path="*" element={<p>There's nothing here: 404!</p>} />
        </Routes>
      </div>
    </Router>
  );
}
