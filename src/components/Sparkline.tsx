'use client';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({ data, width = 80, height = 28, color = '#3b5bdb' }: Props) {
  if (!data || data.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <span className="text-xs text-primary-text-muted">-</span>
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const trend = data[data.length - 1] >= data[0];
  const lineColor = trend ? '#15803d' : '#dc2626';

  return (
    <svg width={width} height={height} className="block">
      <polyline
        fill="none"
        stroke={color || lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
      <circle
        cx={parseFloat(points[points.length - 1].split(',')[0])}
        cy={parseFloat(points[points.length - 1].split(',')[1])}
        r="2"
        fill={color || lineColor}
      />
    </svg>
  );
}
