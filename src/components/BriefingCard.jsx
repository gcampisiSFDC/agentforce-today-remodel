import { useState } from 'react';

const CATEGORIES = {
  FORECAST: {
    color:  '#6b7c5e',
    light:  '#e8ebe5',
    label:  'Forecast',
    icon: (color) => (
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
        <path d="M4 20L10 13L15 17L22 8" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M18 8H22V12" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  RISK: {
    color:  '#c75b2e',
    light:  '#fdf5f0',
    label:  'Risk',
    icon: (color) => (
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
        <path d="M14 4L25 22H3L14 4Z" stroke={color} strokeWidth="2.2" strokeLinejoin="round"/>
        <path d="M14 12V16" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
        <circle cx="14" cy="19.5" r="1.2" fill={color}/>
      </svg>
    ),
  },
  LEADS: {
    color:  '#8b7355',
    light:  '#f5f0ea',
    label:  'Leads',
    icon: (color) => (
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="10" r="4" stroke={color} strokeWidth="2.2"/>
        <path d="M6 23c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
        <path d="M20 7c1.657 0 3 1.343 3 3s-1.343 3-3 3" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <path d="M23.5 21c0-2.761-1.567-5.077-3.5-6" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  CASES: {
    color:  '#7a8f6e',
    light:  '#edf1ea',
    label:  'Cases',
    icon: (color) => (
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
        <rect x="4" y="5" width="20" height="15" rx="3" stroke={color} strokeWidth="2.2"/>
        <path d="M9 23l5-3 5 3" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 11h8M10 15h5" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
};

const now = new Date();
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TODAY_LABEL = `${MONTHS[now.getMonth()]} ${now.getDate()}`;

export default function BriefingCard({ briefing, index, active, onClick, compact = false }) {
  const [liked,     setLiked]     = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const cat   = CATEGORIES[briefing.category] ?? { color: '#9a938a', light: '#f5f2ed', label: briefing.category, icon: () => null };
  const color = cat.color;

  return (
    <div className={`briefing-card ${active ? 'briefing-card--active' : ''} ${compact ? 'briefing-card--compact' : ''}`} onClick={onClick}>

      {/* Top color bar */}
      <div className="briefing-color-bar" style={{ background: color }} />

      {/* Header with icon and category */}
      <div className="briefing-header">
        <div className="briefing-icon-wrap" style={{ background: cat.light }}>
          {cat.icon(color)}
        </div>
        <span className="briefing-category-label" style={{ color }}>{cat.label}</span>
        
        <div className="briefing-meta">
          <span className="briefing-index">#{index}</span>
          <span className="briefing-sep">·</span>
          <span className="briefing-filed">{TODAY_LABEL}</span>
          {active && <span className="briefing-read-badge" style={{ color, borderColor: color + '44' }}>Read</span>}
        </div>
      </div>

      {/* Card body */}
      <div className="briefing-inner">

        {/* Title */}
        <h2 className="briefing-title">{briefing.title}</h2>

        {/* Body (expanded) */}
        {active && briefing.body && (
          <p className="briefing-body">{briefing.body}</p>
        )}

        {/* Stats chips */}
        {briefing.stats?.length > 0 && (
          <div className="briefing-stats">
            {briefing.stats.map((s, i) => (
              <span key={i} className="briefing-stat" style={{ background: cat.light, color, borderColor: color + '22' }}>
                {s}
              </span>
            ))}
          </div>
        )}

        {/* Action row */}
        <div className="briefing-actions">
          <div className="briefing-icons">
            <IconBtn
              active={liked}
              title="Helpful"
              onClick={e => { e.stopPropagation(); setLiked(v => !v); }}
              activeColor={color}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M4.5 7L6.5 2.5C7.5 2.5 8 3 8 4.5V6H12.5L11.5 11H4.5V7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <rect x="2.5" y="7" width="1.5" height="4.5" rx=".5" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </IconBtn>
            <IconBtn
              title="Not helpful"
              onClick={e => { e.stopPropagation(); setDismissed(true); }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M10.5 8L8.5 12.5C7.5 12.5 7 12 7 10.5V9H2.5L3.5 4H10.5V8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <rect x="11" y="3.5" width="1.5" height="4.5" rx=".5" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </IconBtn>
            <IconBtn
              active={saved}
              title={saved ? 'Unsave' : 'Save'}
              onClick={e => { e.stopPropagation(); setSaved(v => !v); }}
              activeColor={color}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill={saved ? 'currentColor' : 'none'}>
                <path d="M3.5 2.5h8a.5.5 0 01.5.5v10l-4.5-2.5-4.5 2.5V3a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
            </IconBtn>
          </div>

          <button
            className="reopen-btn"
            style={{ color, borderColor: color + '33' }}
            onClick={e => { e.stopPropagation(); onClick(); }}
          >
            {active ? 'Collapse' : 'Read more'} ›
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, active, activeColor, title }) {
  return (
    <button
      className={`icon-btn ${active ? 'icon-btn--active' : ''}`}
      style={active && activeColor ? { color: activeColor } : undefined}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
