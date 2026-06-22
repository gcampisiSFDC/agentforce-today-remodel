import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#c75b2e', '#8b7355', '#6b7c5e', '#d97a4f', '#a89078', '#7a8f6e'];

export default function RevenueByCategory({ data = [], title = 'Revenue by Category' }) {
  if (!data.length) {
    return (
      <div className="chart-tile">
        <div className="chart-header">
          <span className="chart-title">{title}</span>
        </div>
        <div className="chart-empty">No category data available</div>
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + (d.value || d.count || 0), 0);

  const formatValue = (value) => {
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value}`;
  };

  return (
    <div className="chart-tile">
      <div className="chart-header">
        <span className="chart-label">DISTRIBUTION</span>
        <span className="chart-title">{title}</span>
      </div>
      <div className="chart-body chart-body--donut">
        <div className="donut-chart-wrap">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
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
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <span className="donut-center-value">{data.length}</span>
            <span className="donut-center-label">categories</span>
          </div>
        </div>
        <div className="donut-legend">
          {data.slice(0, 5).map((item, idx) => (
            <div key={item.name} className="donut-legend-item">
              <span 
                className="donut-legend-dot" 
                style={{ background: COLORS[idx % COLORS.length] }} 
              />
              <span className="donut-legend-label">{item.name}</span>
              <span className="donut-legend-value">
                {total > 0 ? `${Math.round((item.value / total) * 100)}%` : '0%'}
              </span>
            </div>
          ))}
          {data.length > 5 && (
            <div className="donut-legend-item donut-legend-more">
              +{data.length - 5} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
