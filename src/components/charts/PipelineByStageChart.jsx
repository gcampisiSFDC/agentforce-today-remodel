import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';

const COLORS = ['#c75b2e', '#d97a4f', '#e89a70', '#8b7355', '#a89078', '#c5b09b'];

export default function PipelineByStageChart({ data = [], title = 'Pipeline by Stage' }) {
  if (!data.length) {
    return (
      <div className="chart-tile">
        <div className="chart-header">
          <span className="chart-title">{title}</span>
        </div>
        <div className="chart-empty">No pipeline data available</div>
      </div>
    );
  }

  const formatValue = (value) => {
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value}`;
  };

  return (
    <div className="chart-tile">
      <div className="chart-header">
        <span className="chart-label">PIPELINE</span>
        <span className="chart-title">{title}</span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <XAxis 
              dataKey="stage" 
              tick={{ fontSize: 10, fill: '#9a938a' }}
              axisLine={{ stroke: '#e5e0d8' }}
              tickLine={false}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={50}
            />
            <YAxis 
              tick={{ fontSize: 10, fill: '#9a938a' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatValue}
              width={50}
            />
            <Tooltip 
              formatter={(value) => [formatValue(value), 'Value']}
              contentStyle={{
                background: '#fff',
                border: '1px solid #e5e0d8',
                borderRadius: 8,
                fontSize: 12,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-footer">
        <span className="chart-footer-stat">{data.length} stages</span>
        <span className="chart-footer-stat">
          {formatValue(data.reduce((sum, d) => sum + (d.value || 0), 0))} total
        </span>
      </div>
    </div>
  );
}
