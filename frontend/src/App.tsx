import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage';

const ProtectedRoute = lazy(() => import('./ProtectedRoute'));
const HostLanding = lazy(() => import('./features/host/HostLanding'));
const HostGame = lazy(() => import('./features/host/HostGame'));
const EventList = lazy(() => import('./features/host/EventList'));
const EventEditor = lazy(() => import('./features/host/EventEditor'));
const TeamFlow = lazy(() => import('./features/team/TeamFlow'));
const PublicScoreboard = lazy(() => import('./features/watcher/PublicScoreboard'));
const PresentationPage = lazy(() => import('./presentation/PresentationPage'));

export default function App() {
  return (
    <Router>
      <Suspense>
        <Routes>
          {/* Routes that render full-width — outside the centered wrapper, behind auth. */}
          <Route element={<ProtectedRoute />}>
            <Route path="/present/:uuid" element={<PresentationPage />} />
            <Route path="/host/events/:uuid" element={<EventEditor />} />
          </Route>

          <Route
            path="*"
            element={
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
                    <Route path="events" element={<EventList />} />
                  </Route>
                  <Route path="*" element={<p>There's nothing here: 404!</p>} />
                </Routes>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </Router>
  );
}
