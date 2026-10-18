import { partById } from '../parts/catalog';
import type { Transaction } from '../domain/project';
import type { Project, Endpoint } from '../domain/schema';
export function ChangeReview({
  transaction,
  project,
}: {
  transaction: Transaction;
  project: Project;
}) {
  const endpoint = (e: Endpoint) => {
    const c = project.components.find((c) => c.id === e.componentId);
    return `${c?.ref ?? e.componentId}.${c ? (partById(c.partId).terminals.find((t) => t.id === e.terminalId)?.label ?? e.terminalId) : e.terminalId}`;
  };
  const lines = transaction.commands
    .filter((c) => c.type !== 'writeFile')
    .map((c) => {
      switch (c.type) {
        case 'addComponent':
          return `Add ${c.component.ref} · ${partById(c.component.partId).name}`;
        case 'removeComponent':
          return `Remove ${project.components.find((x) => x.id === c.id)?.ref ?? c.id} and its connections`;
        case 'connect':
          return `Connect ${endpoint(c.wire.from)} ↔ ${endpoint(c.wire.to)}`;
        case 'disconnect': {
          const w = project.wires.find((w) => w.id === c.id);
          return w ? `Disconnect ${endpoint(w.from)} ↔ ${endpoint(w.to)}` : `Disconnect ${c.id}`;
        }
        case 'setBinding':
          return `Bind ${c.binding.symbol} ↔ ${endpoint({ componentId: c.binding.boardId, terminalId: c.binding.terminalId })}`;
        case 'moveComponent':
          return `Move ${c.id} in ${c.view} view`;
        case 'configureComponent':
          return `Update ${c.id} properties`;
        case 'setTelemetry':
          return `Debug channel → ${c.mapping.label} (${c.mapping.field})`;
        case 'removeTelemetry':
          return `Remove Debug channel ${c.id}`;
        case 'setBoardSettings':
          return 'Update board configuration';
        case 'setTarget':
          return `Build target → ${c.id}`;
        case 'removeBinding':
          return `Remove binding ${c.id}`;
        case 'renameProject':
          return `Project → ${c.name}`;
      }
    });
  return (
    <div className="change-review">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {transaction.commands
        .filter((c) => c.type === 'writeFile')
        .map((c) => {
          const before = (project.files.find((f) => f.id === c.file.id)?.content ?? '').split('\n'),
            after = c.file.content.split('\n');
          let first = 0;
          while (first < before.length && first < after.length && before[first] === after[first])
            first++;
          let oldEnd = before.length,
            newEnd = after.length;
          while (oldEnd > first && newEnd > first && before[oldEnd - 1] === after[newEnd - 1]) {
            oldEnd--;
            newEnd--;
          }
          return (
            <details key={c.file.id} open>
              <summary>
                {c.file.path}{' '}
                <span className="muted">
                  {Math.max(0, oldEnd - first)} removed · {Math.max(0, newEnd - first)} added
                </span>
              </summary>
              <pre>
                {before
                  .slice(first, oldEnd)
                  .slice(0, 35)
                  .map((l, i) => (
                    <span key={`b${i}`} className="diff-remove">
                      − {l}
                      {'\n'}
                    </span>
                  ))}
                {after
                  .slice(first, newEnd)
                  .slice(0, 35)
                  .map((l, i) => (
                    <span key={`a${i}`} className="diff-add">
                      + {l}
                      {'\n'}
                    </span>
                  ))}
                {oldEnd - first > 35 || newEnd - first > 35
                  ? '… additional changed lines omitted'
                  : ''}
              </pre>
            </details>
          );
        })}
    </div>
  );
}
