import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage';
import ProtectedRoute from './ProtectedRoute';
import HostLanding from './HostLanding';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/home" element={<LandingPage />} />

        {/* Team routes */}
        <Route path="/join" element={<p>Join Game (coming soon)</p>} />
        <Route path="/watch" element={<p>Watch Scoreboard (coming soon)</p>} />

        {/* Host routes (protected) */}
        <Route path="/host" element={<ProtectedRoute />}>
          <Route index element={<HostLanding />} />
        </Route>
        <Route path="*" element={<p>There's nothing here: 404!</p>} />
      </Routes>
    </Router>
  );
}
