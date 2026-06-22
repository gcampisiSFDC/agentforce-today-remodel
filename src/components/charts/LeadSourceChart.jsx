import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const COLORS = ['#c75b2e', '#d97a4f', '#e89a70', '#f0b08f', '#8b7355', '#a89078'];

export default function LeadSourceChart({ data = [], title = 'Lead Sources' }) {
  if (!data.length) {
    return (
      <div className="chart-tile">
        <div className="chart-header">
          <span className="chart-title">{title}</span>
        </div>
        <div className="chart-empty">No lead source data available</div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d.count || d.value || 0));

  return (
    <div className="chart-tile">
      <div className="chart-header">
        <span className="chart-label">WHERE LEADS COME IN</span>
        <span className="chart-title">{title}</span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart 
            data={data} 
            layout="vertical" 
            margin={{ top: 5, right: 30, bottom: 5, left: 70 }}
          >
            <XAxis 
              type="number" 
              tick={{ fontSize: 10, fill: '#9a938a' }}
              axisLine={{ stroke: '#e5e0d8' }}
              tickLine={false}
            />
            <YAxis 
              type="category" 
              dataKey="source" 
              tick={{ fontSize: 11, fill: '#5c564e' }}
              axisLine={false}
              tickLine={false}
              width={65}
            />
            <Tooltip
              formatter={(value) => [value, 'Leads']}
              contentStyle={{
                background: '#fff',
                border: '1px solid #e5e0d8',
                borderRadius: 8,
                fontSize: 12,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-footer">
        <span className="chart-footer-stat">{data.length} sources</span>
        <span className="chart-footer-stat">
          {data.reduce((sum, d) => sum + (d.count || 0), 0)} total leads
        </span>
      </div>
    </div>
  );
}
