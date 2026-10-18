import { useState } from 'react';
import { useWorkspace } from './store';
import './agentQuestion.css';

export function AgentQuestion() {
  const question = useWorkspace((s) => s.agentQuestion);
  const [choice, setChoice] = useState(''),
    [text, setText] = useState('');
  if (!question) return null;
  const answer = (text.trim() || choice).trim();
  return (
    <form
      className="agent-question"
      aria-label="Agent question"
      onSubmit={(e) => {
        e.preventDefault();
        if (answer) useWorkspace.setState({ questionAnswer: { id: question.id, answer } });
      }}
    >
      <strong>{question.question}</strong>
      <div role="radiogroup" aria-label={question.question}>
        {question.options.map((option) => (
          <label key={option.label}>
            <input
              type="radio"
              name={question.id}
              checked={choice === option.label && !text}
              onChange={() => {
                setChoice(option.label);
                setText('');
              }}
            />
            <span>
              {option.label}
              {option.description && <small>{option.description}</small>}
            </span>
          </label>
        ))}
      </div>
      <input
        aria-label="Your answer"
        placeholder="Or type an answer…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
      />
      <div className="row end">
        <button type="button" onClick={() => window.dispatchEvent(new Event('trace:agent-cancel'))}>
          Cancel
        </button>
        <button className="primary" disabled={!answer}>
          Send answer
        </button>
      </div>
    </form>
  );
}
