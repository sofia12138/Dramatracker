'use client';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({ data, width = 80, height = 30, color }: Props) {
  if (!data || data.length < 2 || data.every(v => v === 0)) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <span className="text-xs text-primary-text-muted">-</span>
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const px = 2;

  const points = data.map((val, i) => {
    const x = px + (i / (data.length - 1)) * (width - px * 2);
    const y = height - px - ((val - min) / range) * (height - px * 2);
    return `${x},${y}`;
  });

  const trend = data[data.length - 1] >= data[0];
  const lineColor = color || (trend ? '#15803d' : '#dc2626');

  return (
    <svg width={width} height={height} className="block">
      <polyline
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
      <circle
        cx={parseFloat(points[points.length - 1].split(',')[0])}
        cy={parseFloat(points[points.length - 1].split(',')[1])}
        r="2"
        fill={lineColor}
      />
    </svg>
  );
}
