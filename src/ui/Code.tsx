import { useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { FileCode2, Link2, Plus, FileUp } from 'lucide-react';
import { useWorkspace, uid } from './store';
import { partById } from '../parts/catalog';
import { Badge, IconButton } from './primitives';
import { FileSchema } from '../domain/schema';
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
function defineTraceTheme() {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(name).trim();
  const syntax = (name: string) => color(name).replace('#', '');
  monaco.editor.defineTheme('trace', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: syntax('--editor-comment') },
      { token: 'keyword', foreground: syntax('--accent') },
      { token: 'string', foreground: syntax('--editor-string') },
      { token: 'number', foreground: syntax('--editor-number') },
    ],
    colors: {
      'editor.background': color('--editor-bg'),
      'editor.foreground': color('--text'),
      'editorLineNumber.foreground': color('--editor-line'),
      'editorLineNumber.activeForeground': color('--editor-line-active'),
      'editor.selectionBackground': color('--editor-selection'),
      'editor.lineHighlightBackground': color('--editor-highlight'),
      'editorCursor.foreground': color('--accent'),
    },
  });
}
export function Code() {
  const project = useWorkspace((s) => s.project),
    active = useWorkspace((s) => s.activeFileId),
    apply = useWorkspace((s) => s.apply),
    selection = useWorkspace((s) => s.selection);
  const [adding, setAdding] = useState(false),
    [path, setPath] = useState('');
  const file = project.files.find((f) => f.id === active) ?? project.files[0];
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const bindings = project.bindings.filter((b) => b.fileId === file.id);
  useEffect(() => {
    if (!editor.current) return;
    const model = editor.current.getModel();
    if (!model) return;
    const relevant = bindings.filter(
      (b) =>
        selection &&
        (selection.kind === 'terminal'
          ? selection.endpoint.componentId === b.boardId &&
            selection.endpoint.terminalId === b.terminalId
          : selection.kind === 'component'
            ? selection.id === b.boardId || selection.id === b.target.componentId
            : selection.kind === 'diagnostic' &&
              (selection.objectIds.includes(b.boardId) ||
                selection.objectIds.includes(b.target.componentId))),
    );
    decorations.current?.clear();
    decorations.current = editor.current.createDecorationsCollection(
      relevant.flatMap((b) =>
        model
          .findMatches(b.symbol, false, false, true, null, true)
          .map((m) => ({ range: m.range, options: { inlineClassName: 'linked-code' } })),
      ),
    );
  }, [selection, file.content]);
  const addFile = (name: string, content: string) => {
    try {
      const added = FileSchema.parse({ id: uid('file'), path: name, content });
      if (apply(`Add ${name}`, [{ type: 'writeFile', file: added }])) {
        useWorkspace.setState({ activeFileId: added.id });
        setAdding(false);
        setPath('');
      }
    } catch {
      useWorkspace.setState({
        notice: 'Use a simple .ino, .cpp, .c or .h filename; maximum 200 KB per file.',
      });
    }
  };
  return (
    <div className="code-panel">
      <div className="file-tabs">
        {project.files.map((f) => (
          <button
            className={f.id === file.id ? 'active' : ''}
            key={f.id}
            onClick={() => useWorkspace.setState({ activeFileId: f.id })}
          >
            <FileCode2 size={13} />
            {f.path}
          </button>
        ))}
        <span className="spacer" />
        <IconButton title="Add firmware file" onClick={() => setAdding(!adding)}>
          <Plus />
        </IconButton>
        <IconButton
          title="Import firmware file"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.ino,.cpp,.c,.h';
            input.onchange = async () => {
              const f = input.files?.[0];
              if (f) {
                if (f.size > 200000) {
                  useWorkspace.setState({ notice: 'Firmware file exceeds 200 KB.' });
                  return;
                }
                addFile(f.name, await f.text());
              }
            };
            input.click();
          }}
        >
          <FileUp />
        </IconButton>
      </div>
      {adding && (
        <form
          className="new-file-form"
          onSubmit={(e) => {
            e.preventDefault();
            addFile(path, '');
          }}
        >
          <input
            autoFocus
            aria-label="New firmware filename"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="helpers.h"
          />
          <button type="submit" className="secondary">
            Add
          </button>
        </form>
      )}
      <div className="editor-area">
        <Editor
          path={`${project.id}/${file.id}`}
          value={file.content}
          language="cpp"
          theme="trace"
          beforeMount={defineTraceTheme}
          onMount={(e) => (editor.current = e)}
          onChange={(content) => {
            const current = useWorkspace.getState().project.files.find((f) => f.id === file.id);
            if (content !== undefined && current && content !== current.content)
              apply(`Edit ${file.path}`, [{ type: 'writeFile', file: { ...current, content } }]);
          }}
          options={{
            editContext: false,
            fontSize: 12,
            fontFamily: 'SFMono-Regular, Menlo, monospace',
            lineHeight: 21,
            minimap: { enabled: false },
            padding: { top: 18, bottom: 16 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: 'gutter',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            wordWrap: 'on',
            lineNumbersMinChars: 3,
            glyphMargin: false,
            stickyScroll: { enabled: false },
            smoothScrolling: true,
          }}
        />
      </div>
      <div className="code-bindings">
        {bindings.length ? (
          bindings.map((b) => {
            const c = project.components.find((c) => c.id === b.boardId)!;
            const t = partById(c.partId).terminals.find((t) => t.id === b.terminalId)!;
            return (
              <button
                key={b.id}
                title="Highlight documented terminal"
                onClick={() =>
                  useWorkspace.getState().select({
                    kind: 'terminal',
                    id: `${b.boardId}:${b.terminalId}`,
                    endpoint: { componentId: b.boardId, terminalId: b.terminalId },
                  })
                }
              >
                <Link2 size={12} />
                <span className="mono">{b.symbol}</span>
                <span className="muted">
                  ↔ {c.ref}.{t.label}
                </span>
              </button>
            );
          })
        ) : (
          <small>No explicit pin bindings</small>
        )}
      </div>
    </div>
  );
}
