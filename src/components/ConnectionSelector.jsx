// Dropdown for choosing the active Salesforce data connection. Mirrors the
// ModelSelector pattern — one row per connection, with auth/availability state.

function TransportIcon({ transport, size = 13 }) {
  const s = size;
  if (transport === 'mcp') {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3 3l2 2M11 11l2 2M13 3l-2 2M5 11l-2 2" strokeLinecap="round" />
      </svg>
    );
  }
  if (transport === 'rest') {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <path d="M4 5l-3 3 3 3M12 5l3 3-3 3M9 3l-2 10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // cli
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4 6l2.5 2L4 10M8.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ConnectionSelector({ connections, active, onSelect }) {
  return (
    <div className="conn-dropdown" onClick={e => e.stopPropagation()}>
      <div className="conn-dropdown-label">DATA CONNECTION</div>
      {connections.map(c => {
        const selected = c.id === active;
        return (
          <button
            key={c.id}
            className={`conn-option ${selected ? 'conn-option--selected' : ''} ${!c.available ? 'conn-option--disabled' : ''}`}
            onClick={() => onSelect(c)}
            disabled={!c.available}
            title={!c.available ? 'Not configured — set its Client ID / URL in .env' : undefined}
          >
            <span className="conn-option-icon">
              <TransportIcon transport={c.transport} size={14} />
            </span>
            <span className="conn-option-info">
              <span className="conn-option-name">{c.label}</span>
              <span className="conn-option-sublabel">{c.sublabel}</span>
            </span>
            <span className="conn-option-state">
              {selected && (
                <svg className="conn-option-check" width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M2.5 6.5L5.5 9.5L10.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {!c.available && <span className="conn-option-tag">setup</span>}
              {c.available && !c.authenticated && c.auth === 'oauth' && (
                <span className="conn-option-tag conn-option-tag--auth">connect</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { TransportIcon };
