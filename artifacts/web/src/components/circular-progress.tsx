import { cn } from "@/lib/utils";

interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  colorClass?: string;
  className?: string;
}

export function CircularProgress({
  value,
  max = 10,
  size = 120,
  strokeWidth = 8,
  colorClass = "text-primary",
  className,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percentage = Math.min(Math.max(value / max, 0), 1);
  const offset = circumference - percentage * circumference;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle
          className="text-muted stroke-current"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={cn("stroke-current transition-all duration-1000 ease-out", colorClass)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-display font-bold">{value.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">/ {max}</span>
      </div>
    </div>
  );
}
