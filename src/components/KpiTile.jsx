import { AreaChart, Area, ResponsiveContainer } from 'recharts';

const STATUS_COLORS = {
  good:    { color: '#6b7c5e', bg: '#e8ebe5' },
  warning: { color: '#8b7355', bg: '#f5f0ea' },
  danger:  { color: '#c75b2e', bg: '#fdf5f0' },
  neutral: { color: '#5c564e', bg: '#f5f2ed' },
};

export default function KpiTile({ 
  label, 
  value, 
  subtitle, 
  status = 'neutral',
  sparklineData = null,
  sparklineColor = '#c75b2e',
  icon = null,
}) {
  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.neutral;

  return (
    <div className="kpi-tile">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon">{icon}</span>}
      </div>

      <div className="kpi-value-row">
        <span className="kpi-value">{value}</span>
        
        {sparklineData && sparklineData.length > 0 && (
          <div className="kpi-sparkline">
            <ResponsiveContainer width="100%" height={32}>
              <AreaChart data={sparklineData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`sparkGrad-${label.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={sparklineColor}
                  strokeWidth={1.5}
                  fill={`url(#sparkGrad-${label.replace(/\s/g, '')})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {subtitle && (
        <div className="kpi-subtitle" style={{ color: statusStyle.color }}>
          {status !== 'neutral' && (
            <span className="kpi-status-dot" style={{ background: statusStyle.color }} />
          )}
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function formatCurrency(amount) {
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

export function formatDuration(minutes) {
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${minutes}m`;
}
