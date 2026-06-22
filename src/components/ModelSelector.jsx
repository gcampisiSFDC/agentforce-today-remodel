import { ProviderIcon } from './Header.jsx';

export default function ModelSelector({ models, selected, onSelect }) {
  return (
    <div className="model-dropdown" onClick={e => e.stopPropagation()}>
      <div className="model-dropdown-label">MODEL</div>
      {models.map(m => (
        <button
          key={m.id}
          className={`model-option ${m.id === selected ? 'model-option--selected' : ''} ${!m.available ? 'model-option--disabled' : ''}`}
          onClick={() => onSelect(m)}
          disabled={!m.available}
          title={!m.available ? 'Coming soon' : undefined}
        >
          <span className="model-option-icon">
            <ProviderIcon provider={m.provider} size={13} />
          </span>
          <span className="model-option-info">
            <span className="model-option-name">{m.label}</span>
            <span className="model-option-provider">{m.provider}</span>
          </span>
          {m.id === selected && (
            <svg className="model-option-check" width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2.5 6.5L5.5 9.5L10.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {!m.available && (
            <span className="model-option-soon">soon</span>
          )}
        </button>
      ))}
    </div>
  );
}
