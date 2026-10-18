import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from './store';
import { Sparkles } from 'lucide-react';

/** This UI only captures intent. The runtime resolves the current diagnostic before inference. */
export function DiagnosticAgent({ diagnosticId }: { diagnosticId: string }) {
  const busy = useWorkspace((s) => s.agentBusy);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog:modal')) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    root.current?.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      root.current?.removeEventListener('keydown', escape);
    };
  }, [open]);
  const request = (action: 'explain' | 'fix') => {
    setOpen(false);
    trigger.current?.focus();
    window.dispatchEvent(
      new CustomEvent('trace:diagnostic-request', { detail: { id: diagnosticId, action } }),
    );
  };
  return (
    <div className="diagnostic-agent nodrag nopan" ref={root} data-diagnostic-id={diagnosticId}>
      <button
        ref={trigger}
        className="icon-button diagnostic-agent-trigger"
        disabled={busy}
        title={busy ? 'Agent is working' : 'Ask Agent'}
        aria-label="Ask Agent"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
            );
          }
        }}
      >
        <Sparkles size={13} />
      </button>
      {open && (
        <div
          className="diagnostic-agent-menu"
          role="menu"
          aria-label="Ask Agent about issue"
          onKeyDown={(event) => {
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            ];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'ArrowDown'
                ? (index + 1) % items.length
                : event.key === 'ArrowUp'
                  ? (index - 1 + items.length) % items.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          <button role="menuitem" onClick={() => request('explain')}>
            Explain
          </button>
          <button role="menuitem" onClick={() => request('fix')}>
            Fix
          </button>
        </div>
      )}
    </div>
  );
}
