interface ColorButtonProps {
  backgroundColor: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

function getRelativeLuminance(hex: string): number {
  // Remove # if present
  const cleanHex = hex.startsWith("#") ? hex.slice(1) : hex;

  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function getTextColor(backgroundColor: string): "black" | "white" {
  return getRelativeLuminance(backgroundColor) > 0.179 ? "black" : "white";
}

export default function ColorButton({
  backgroundColor,
  children,
  onClick,
  className = "",
  disabled = false,
  type = "button",
}: ColorButtonProps) {
  const textColor = getTextColor(backgroundColor);

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        backgroundColor,
        color: textColor,
      }}
      className={`font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
