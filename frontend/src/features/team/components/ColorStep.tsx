import { useTeamStore } from "../../../stores/useTeamStore";
import { TEAM_COLORS } from "../../../utils/colors";
import type { TeamColorOption } from "../../../utils/colors";

interface ColorStepProps {
  onJoinGame: () => void;
}

export default function ColorStep({ onJoinGame }: ColorStepProps) {
  const { teamName, selectedColor, setColor } = useTeamStore();

  const handleColorSelect = (color: TeamColorOption) => {
    setColor(color);
  };

  const handleJoin = () => {
    if (selectedColor) {
      onJoinGame();
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-xl font-bold">{teamName}</h2>
        <p className="text-gray-600">Choose your team color:</p>
      </div>

      <div className="grid grid-cols-4 gap-3 justify-items-center">
        {TEAM_COLORS.map((color) => (
          <button
            key={color.hex}
            onClick={() => handleColorSelect(color)}
            className={`w-14 h-14 rounded-full transition-all ${
              selectedColor?.hex === color.hex
                ? "ring-4 ring-offset-2 ring-gray-400"
                : "hover:scale-110"
            }`}
            style={{ backgroundColor: color.hex }}
            aria-label={`Select ${color.name}`}
          />
        ))}
      </div>

      <button
        onClick={handleJoin}
        disabled={!selectedColor}
        className="w-full py-4 rounded-2xl text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: selectedColor?.hex ?? "#9CA3AF",
        }}
      >
        {selectedColor ? `Choose ${selectedColor.name}` : "Select a color"}
      </button>
    </div>
  );
}
