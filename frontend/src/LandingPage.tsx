import Button from './components/ui/Button';

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with Host Login */}
      <header className="flex justify-end p-4">
        <Button variant="secondary" to="/host">
          Host Login
        </Button>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center gap-4">
        <h1 className="text-5xl font-bold mb-8 text-center">
          Trivia Wizard
          <span className="px-4 block md:inline text-[1.4em]" style={{ fontFamily: 'Birthstone' }}>2.0!</span>
        </h1>

        <Button variant="primary" to="/join" className="text-lg px-32 py-8">
          Join Game
        </Button>

        <Button variant="secondary" to="/watch">
          Watch Scoreboard
        </Button>
      </main>

      {/* Footer */}
      <footer className="p-4">
        <a
          href="https://jarbla.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Jarbla Home
        </a>
      </footer>
    </div>
  );
}
