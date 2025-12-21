interface HeaderProps {
  onLogOut?: () => void;
}

export default function Header({ onLogOut }: HeaderProps) {
  return (
    <header className="flex justify-between items-center p-4">
      <h1 className="text-2xl font-bold">
        Trivia Wizard <span className="text-[1.2em]" style={{ fontFamily: 'Birthstone' }}>2.0!</span>
      </h1>
      {onLogOut && (
        <button
          onClick={onLogOut}
          className="text-gray-600 hover:text-gray-900 underline"
        >
          Log Out
        </button>
      )}
    </header>
  );
}
