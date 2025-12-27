import { ChevronLeft } from "lucide-react";

interface TeamHeaderProps {
  onBack: () => void;
}

export default function TeamHeader({ onBack }: TeamHeaderProps) {
  return (
    <header className="flex items-center gap-4 p-4">
      <button
        onClick={onBack}
        className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
      >
        <ChevronLeft size={24} />
      </button>
      <h1 className="text-2xl font-bold">
        Trivia Wizard{" "}
        <span style={{ fontFamily: "Birthstone" }} className="text-3xl">
          2.0!
        </span>
      </h1>
    </header>
  );
}
