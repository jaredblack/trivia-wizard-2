interface TimerDisplayProps {
  seconds: number;
  className?: string;
}

export default function TimerDisplay({ seconds, className = "" }: TimerDisplayProps) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = `${minutes}:${secs.toString().padStart(2, "0")}`;

  return (
    <span className={`font-mono font-bold ${className}`}>
      {display}
    </span>
  );
}
