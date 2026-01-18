interface AutoSubmitNumericInputProps {
  value: number;
  onSubmit?: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}

export default function AutoSubmitNumericInput({
  value,
  onSubmit,
  disabled,
  min,
  max,
}: AutoSubmitNumericInputProps) {
  return (
    <input
      key={value}
      type="number"
      defaultValue={value}
      onChange={(e) => {
        const newValue = Number(e.target.value);
        // If change is exactly +/- 1, it's from arrow buttons - submit immediately
        if (Math.abs(newValue - value) === 1) {
          onSubmit?.(newValue);
        }
      }}
      onBlur={(e) => onSubmit?.(Number(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSubmit?.(Number(e.currentTarget.value));
          e.currentTarget.blur();
        }
      }}
      disabled={disabled}
      min={min}
      max={max}
      className={`w-16 px-2 py-1 border bg-white border-gray-300 hover:border-gray-400 rounded-xl text-center ${
        disabled ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""
      }`}
    />
  );
}
