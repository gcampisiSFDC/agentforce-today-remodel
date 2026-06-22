import BriefingCard from './BriefingCard.jsx';

const SKELETON_COUNTS = [1, 2, 3];

export default function FeedPanel({ briefings, loading, activeBriefing, onBriefingClick }) {
  if (loading && briefings.length === 0) {
    return (
      <div className="feed-panel">
        {SKELETON_COUNTS.map(i => (
          <div key={i} className="briefing-card briefing-card--skeleton">
            <div className="sk-line sk-line--short" />
            <div className="sk-line sk-line--long" />
            <div className="sk-line sk-line--med" />
          </div>
        ))}
      </div>
    );
  }

  if (!loading && briefings.length === 0) {
    return (
      <div className="feed-panel feed-panel--empty">
        <p>No briefings yet. Click <strong>Curate</strong> to generate your daily briefing.</p>
      </div>
    );
  }

  return (
    <div className="feed-panel">
      {briefings.map((b, idx) => (
        <BriefingCard
          key={b.id}
          briefing={b}
          index={idx + 1}
          active={activeBriefing === b.id}
          onClick={() => onBriefingClick(activeBriefing === b.id ? null : b.id)}
        />
      ))}
    </div>
  );
}
