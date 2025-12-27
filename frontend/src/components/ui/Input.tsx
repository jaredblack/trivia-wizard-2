import { forwardRef } from "react";

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  type?: "text" | "number" | "password";
  autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters";
  autoCorrect?: "off" | "on";
  spellCheck?: boolean;
  enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send";
  onEnter?: () => void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    value,
    onChange,
    placeholder,
    className = "",
    disabled = false,
    type = "text",
    autoCapitalize,
    autoCorrect,
    spellCheck,
    enterKeyHint,
    onEnter,
  },
  ref
) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };

  return (
    <input
      ref={ref}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onEnter ? handleKeyDown : undefined}
      placeholder={placeholder}
      disabled={disabled}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      enterKeyHint={enterKeyHint}
      className={`px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed ${className}`}
    />
  );
});

export default Input;
