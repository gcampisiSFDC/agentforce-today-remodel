import { useState, useEffect, useRef, useCallback } from 'react';

const SUGGESTIONS = [
  'Show me all open opportunities',
  'Which deals are most at risk?',
  'What should I focus on today?',
  'Which opportunities close this month?',
  'Update the NextStep on Acme deal to "Schedule demo"',
];

const WELCOME = {
  role: 'assistant',
  content: "I'm your Agentforce sales assistant. I have live access to your Salesforce data — ask me anything about your pipeline, deals, leads or what to prioritise. I can also update records when you ask.",
  id: 'welcome',
};

// Parse salesforce-update code blocks from message content
function parseUpdateBlocks(content) {
  // Try multiple patterns - AI might format slightly differently
  const patterns = [
    /```salesforce-update\s*([\s\S]*?)```/g,
    /```salesforce-update\n([\s\S]*?)```/g,
    /`salesforce-update`\s*\n?\s*```(?:json)?\s*([\s\S]*?)```/g,
    /```json\s*\n?\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/g,
  ];
  
  const blocks = [];
  
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      try {
        const jsonStr = match[1].trim();
        console.log('[Chat] Trying to parse:', jsonStr.slice(0, 100));
        const json = JSON.parse(jsonStr);
        if (json.action && json.objectType) {
          blocks.push(json);
          console.log('[Chat] Successfully parsed block:', json);
        }
      } catch (e) {
        console.error('[Chat] Failed to parse update block:', e.message, match[1]?.slice(0, 100));
      }
    }
  }
  
  // Dedupe by stringifying
  const unique = [...new Map(blocks.map(b => [JSON.stringify(b), b])).values()];
  return unique;
}

// Execute a Salesforce update
async function executeUpdate(block) {
  const endpoint = block.action === 'create' ? '/api/create-record' : '/api/update-record';
  const body = block.action === 'create' 
    ? { objectType: block.objectType, fields: block.fields }
    : { objectType: block.objectType, recordId: block.recordId, fields: block.fields };
  
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `Update failed: ${res.status}`);
  }
  
  return res.json();
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  const isStatus = msg.isStatus;
  
  if (isStatus) {
    return (
      <div className="chat-status-row">
        <span className="chat-status-text">{msg.content}</span>
      </div>
    );
  }
  
  return (
    <div className={`chat-bubble-row ${isUser ? 'chat-bubble-row--user' : ''}`}>
      {!isUser && (
        <div className="chat-avatar">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1.5L10.5 8H3.5L7 1.5Z" fill="white" opacity=".9"/>
            <circle cx="7" cy="6" r="2" fill="white"/>
          </svg>
        </div>
      )}
      <div className={`chat-bubble ${isUser ? 'chat-bubble--user' : 'chat-bubble--assistant'}`}>
        <MessageContent content={msg.content} streaming={msg.streaming} />
      </div>
    </div>
  );
}

function MessageContent({ content, streaming }) {
  // Remove salesforce-update code blocks from visible content
  const cleanContent = content.replace(/```salesforce-update[\s\S]*?```/g, '').trim();
  
  // Check if there are update blocks
  const hasUpdates = /```salesforce-update/.test(content);
  
  // Render markdown-lite: bold, inline code, line breaks
  const rendered = cleanContent
    .split('\n')
    .map((line, i, arr) => {
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={j} className="chat-inline-code">{part.slice(1, -1)}</code>;
        return part;
      });
      return (
        <span key={i}>
          {parts}
          {i < arr.length - 1 && <br />}
        </span>
      );
    });

  return (
    <span>
      {rendered}
      {hasUpdates && !streaming && (
        <span className="chat-update-indicator">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ verticalAlign: 'middle', marginLeft: 6 }}>
            <path d="M6 1v4l2.5 1.5M11 6a5 5 0 11-10 0 5 5 0 0110 0z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {' '}Processing update...
        </span>
      )}
      {streaming && <span className="chat-cursor" />}
    </span>
  );
}

export default function ForecastChat({ open, onClose, model }) {
  const [messages,   setMessages]   = useState([WELCOME]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);
  const [error,      setError]      = useState(null);
  const bottomRef   = useRef(null);
  const inputRef    = useRef(null);
  const abortRef    = useRef(null);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  // Scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    setError(null);
    const userMsg = { role: 'user', content: trimmed, id: Date.now() };
    const assistantId = Date.now() + 1;

    setMessages(prev => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '', id: assistantId, streaming: true },
    ]);
    setInput('');
    setStreaming(true);

    // Build conversation history (exclude welcome, exclude empty streaming placeholders)
    const history = [...messages.filter(m => m.id !== 'welcome'), userMsg]
      .map(m => ({ role: m.role, content: m.content }));

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: history, model }),
        signal:  abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.text) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk.text }
                  : m
              ));
            }
          } catch { /* ignore malformed chunks */ }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      // Get the final message content and check for update blocks
      setMessages(prev => {
        const assistantMsg = prev.find(m => m.id === assistantId);
        if (assistantMsg) {
          console.log('[Chat] Final message length:', assistantMsg.content.length);
          console.log('[Chat] Final message content:', assistantMsg.content);
          console.log('[Chat] Contains salesforce-update?', assistantMsg.content.includes('salesforce-update'));
          console.log('[Chat] Contains triple backticks?', assistantMsg.content.includes('```'));
          const updateBlocks = parseUpdateBlocks(assistantMsg.content);
          console.log('[Chat] Parsed update blocks:', updateBlocks);
          if (updateBlocks.length > 0) {
            console.log('[Chat] Processing', updateBlocks.length, 'update(s)...');
            // Process updates asynchronously
            processUpdates(updateBlocks, assistantId);
          } else {
            console.log('[Chat] No update blocks found to process');
          }
        }
        return prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m);
      });
      setStreaming(false);
    }
  }, [messages, model, streaming]);

  // Process update blocks and add status messages
  async function processUpdates(blocks, afterMsgId) {
    for (const block of blocks) {
      const statusId = Date.now();
      const actionLabel = block.action === 'create' ? 'Creating' : 'Updating';
      
      // Add status message
      setMessages(prev => [...prev, {
        role: 'system',
        content: `⏳ ${actionLabel} ${block.objectType}...`,
        id: statusId,
        isStatus: true,
      }]);

      try {
        const result = await executeUpdate(block);
        setMessages(prev => prev.map(m => 
          m.id === statusId 
            ? { ...m, content: `✅ ${block.action === 'create' ? 'Created' : 'Updated'} ${block.objectType} successfully!` }
            : m
        ));
      } catch (err) {
        setMessages(prev => prev.map(m => 
          m.id === statusId 
            ? { ...m, content: `❌ Failed to ${block.action} ${block.objectType}: ${err.message}` }
            : m
        ));
      }
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleStop() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
  }

  function handleClear() {
    abortRef.current?.abort();
    setMessages([WELCOME]);
    setStreaming(false);
    setError(null);
  }

  const showSuggestions = messages.length === 1; // only welcome message

  return (
    <>
      {/* Backdrop */}
      <div
        className={`chat-backdrop ${open ? 'chat-backdrop--open' : ''}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`chat-panel ${open ? 'chat-panel--open' : ''}`} role="dialog" aria-modal>

        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-left">
            <div className="chat-header-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5L12 9H4L8 1.5Z" fill="white" opacity=".9"/>
                <circle cx="8" cy="7" r="2.5" fill="white"/>
              </svg>
            </div>
            <div>
              <div className="chat-header-title">Forecast Focus</div>
              <div className="chat-header-sub">Powered by {model}</div>
            </div>
          </div>
          <div className="chat-header-actions">
            {messages.length > 1 && (
              <button className="chat-action-btn" onClick={handleClear} title="Clear conversation">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 4h9M5.5 4V2.5h3V4M6 6.5v4M8 6.5v4M3 4l.5 7.5h7L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <button className="chat-action-btn" onClick={onClose} title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {error && (
            <div className="chat-error">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M6.5 4v3M6.5 9v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Suggested prompts */}
        {showSuggestions && !streaming && (
          <div className="chat-suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s} className="chat-suggestion" onClick={() => sendMessage(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <form className="chat-input-row" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="chat-input"
            placeholder="Ask about your pipeline…"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={streaming}
          />
          {streaming ? (
            <button type="button" className="chat-send-btn chat-send-btn--stop" onClick={handleStop} title="Stop">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
              </svg>
            </button>
          ) : (
            <button type="submit" className="chat-send-btn" disabled={!input.trim()} title="Send">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </form>
      </div>
    </>
  );
}
