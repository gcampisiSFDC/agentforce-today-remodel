import KpiTile, { formatCurrency } from './KpiTile.jsx';
import PipelineByStageChart from './charts/PipelineByStageChart.jsx';
import RevenueByCategory from './charts/RevenueByCategory.jsx';
import LeadSourceChart from './charts/LeadSourceChart.jsx';
import BriefingCard from './BriefingCard.jsx';

export default function DashboardPanel({ 
  date,
  kpis = {},
  charts = {},
  briefings = [],
  loading,
  activeBriefing,
  onBriefingClick,
  score,
}) {
  const scoreColor = score >= 150 ? '#6b7c5e' : score >= 80 ? '#8b7355' : '#c75b2e';
  const atRiskPercent = kpis.openOpportunities > 0 
    ? Math.round((kpis.atRiskDeals / kpis.openOpportunities) * 100) 
    : 0;

  if (loading && !kpis.openOpportunities) {
    return (
      <div className="dashboard-panel">
        <div className="dashboard-hero">
          <div className="sk-line" style={{ width: 200, height: 28 }} />
          <div className="sk-line sk-line--med" style={{ marginTop: 12 }} />
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="kpi-tile kpi-tile--skeleton">
              <div className="sk-line sk-line--short" />
              <div className="sk-line" style={{ width: '60%', height: 32, marginTop: 12 }} />
              <div className="sk-line sk-line--med" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
        <div className="chart-grid">
          {[1, 2, 3].map(i => (
            <div key={i} className="chart-tile chart-tile--skeleton">
              <div className="sk-line sk-line--short" />
              <div style={{ height: 150 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-panel">
      {/* Hero Section */}
      <div className="dashboard-hero">
        <div className="hero-content">
          <span className="hero-label">SALES · PIPELINE</span>
          <h1 className="hero-title">Today on <em>Agentforce</em></h1>
          <p className="hero-subtitle">
            Open pipeline, live opportunity signals, and AI-powered actions over your Salesforce CRM.
          </p>
        </div>
        <div className="hero-sentiment">
          <div className="sentiment-label">SENTIMENT · {date || 'TODAY'}</div>
          <div className="sentiment-value" style={{ color: scoreColor }}>
            {atRiskPercent}% <span className="sentiment-suffix">at risk</span>
          </div>
          <div className="sentiment-bar">
            <div 
              className="sentiment-bar-fill" 
              style={{ 
                width: `${Math.min(atRiskPercent, 100)}%`,
                background: scoreColor 
              }} 
            />
          </div>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="kpi-grid">
        <KpiTile
          label="OPEN OPPORTUNITIES"
          value={kpis.openOpportunities ?? 0}
          subtitle={`${kpis.closingSoon ?? 0} closing this month`}
          status={kpis.closingSoon > 5 ? 'warning' : 'good'}
        />
        <KpiTile
          label="PIPELINE VALUE"
          value={formatCurrency(kpis.pipelineValue ?? 0)}
          subtitle={`Avg ${formatCurrency((kpis.pipelineValue || 0) / Math.max(kpis.openOpportunities || 1, 1))} per deal`}
          status="neutral"
        />
        <KpiTile
          label="AT RISK DEALS"
          value={kpis.atRiskDeals ?? 0}
          subtitle={atRiskPercent > 20 ? 'Above threshold' : 'Within tolerance'}
          status={kpis.atRiskDeals > 3 ? 'danger' : kpis.atRiskDeals > 0 ? 'warning' : 'good'}
        />
        <KpiTile
          label="OPEN CASES"
          value={kpis.openCases ?? 0}
          subtitle={`${kpis.highPriorityCases ?? 0} high priority`}
          status={kpis.highPriorityCases > 2 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Charts */}
      <div className="chart-grid">
        <PipelineByStageChart 
          data={charts.pipelineByStage ?? []} 
          title="Pipeline by Stage"
        />
        <RevenueByCategory 
          data={charts.opportunityRanges ?? []} 
          title="Deal Size Distribution"
        />
        <LeadSourceChart 
          data={charts.leadSources ?? []} 
          title="Lead Sources"
        />
      </div>

      {/* Compact Briefings */}
      {briefings.length > 0 && (
        <div className="briefings-section">
          <div className="briefings-header">
            <span className="briefings-label">AI INSIGHTS</span>
            <span className="briefings-count">{briefings.length} briefings</span>
          </div>
          <div className="briefings-grid">
            {briefings.map((briefing, idx) => (
              <BriefingCard
                key={briefing.id}
                briefing={briefing}
                index={idx + 1}
                active={activeBriefing === briefing.id}
                onClick={() => onBriefingClick(activeBriefing === briefing.id ? null : briefing.id)}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
