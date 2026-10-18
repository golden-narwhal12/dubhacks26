import { useEffect, useRef, useState } from 'react';
import {
  DockviewReact,
  themeDark,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewHeaderActionsProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {
  Undo2,
  Redo2,
  FolderOpen,
  Save,
  Play,
  PanelBottom,
  Columns3,
  Maximize2,
  Minimize2,
  Settings2,
  X,
  Plus,
  RotateCcw,
  Square,
  PanelTop,
  GitBranch,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useWorkspace } from './store';
import { Circuit } from './Circuit';
import { Code } from './Code';
import { Agent } from './Agent';
import { Output } from './Output';
import { Settings } from './Settings';
import { partById } from '../parts/catalog';
import { IconButton, Badge } from './primitives';
import { Debug } from './Debug';
import { BoardSelector, HardwareDialogs } from './HardwareControls';
import {
  cancelPreparation,
  initializeHardware,
  useHardware,
  verifyProject,
  programBoard,
  requestHardware,
  hardwareError,
} from './hardwareClient';
const components = { circuit: Circuit, code: Code, agent: Agent, debug: Debug };
function HeaderActions(props: IDockviewHeaderActionsProps) {
  return (
    <div className="dock-actions">
      <IconButton
        title="Float pane"
        onClick={() =>
          props.containerApi.addFloatingGroup(props.group, {
            width: 550,
            height: 500,
            position: { left: 50, top: 50 },
          })
        }
      >
        <PanelTop />
      </IconButton>
      <IconButton
        title="Maximize or restore pane"
        onClick={() => {
          if (props.group.api.isMaximized()) props.group.api.exitMaximized();
          else props.group.api.maximize();
        }}
      >
        <Maximize2 />
      </IconButton>
    </div>
  );
}
function defaults(api: DockviewApi, workspace: 'prototype' | 'debug' = 'prototype') {
  api.clear();
  const c = api.addPanel({
    id: workspace === 'debug' ? 'debug' : 'circuit',
    component: workspace === 'debug' ? 'debug' : 'circuit',
    title: workspace === 'debug' ? 'Device' : 'Circuit',
    minimumWidth: 300,
  });
  const code = api.addPanel({
    id: 'code',
    component: workspace === 'debug' ? 'circuit' : 'code',
    title: workspace === 'debug' ? 'Circuit' : 'Code',
    position: { referencePanel: c, direction: 'right' },
    minimumWidth: 260,
  });
  if (workspace === 'debug')
    api.addPanel({
      id: 'firmware-context',
      component: 'code',
      title: 'Code',
      inactive: true,
      position: { referencePanel: code, direction: 'within' },
    });
  const agent = api.addPanel({
    id: 'agent',
    component: 'agent',
    title: 'Agent',
    position: { referencePanel: code, direction: 'right' },
    minimumWidth: 260,
  });
  requestAnimationFrame(() => {
    if (api.getPanel(c.id) !== c) return;
    c.api.setSize({ width: Math.round(api.width * 0.48) });
    code.api.setSize({ width: Math.round(api.width * 0.29) });
    agent.api.setSize({ width: Math.round(api.width * 0.23) });
  });
}
export function App() {
  const s = useWorkspace(),
    h = useHardware();
  const dock = useRef<DockviewApi | null>(null);
  const activeWorkspace = useRef(s.workspace);
  const target = s.project.components.find((c) => c.id === s.project.targetBoardId),
    targetPart = target ? partById(target.partId) : null;
  const monitor = () => {
    const state = useHardware.getState();
    void requestHardware(
      state.snapshot?.serial.state === 'connected'
        ? { action: 'disconnect' }
        : {
            action: 'connect',
            portKey: state.portKey,
            baud: state.baud,
            delimiter: state.delimiter,
          },
      state.snapshot?.serial.state === 'connected'
        ? 'Stop the current monitor.'
        : 'Open the selected device for serial monitoring.',
    ).catch(hardwareError);
  };
  useEffect(() => {
    initializeHardware();
    const action = (a: string) => {
      if (document.querySelector('dialog[open]') && !['undo', 'redo'].includes(a)) return;
      const current = useWorkspace.getState();
      switch (a) {
        case 'new':
          current.reset(true);
          break;
        case 'example':
          current.reset();
          break;
        case 'open':
          void current.open();
          break;
        case 'save':
          void current.save();
          break;
        case 'export':
          void window.trace?.exportFirmware(current.project).catch(hardwareError);
          break;
        case 'settings':
          useWorkspace.setState({ settings: true });
          break;
        case 'undo':
        case 'redo': {
          const input = (document.activeElement as HTMLElement)?.closest(
            'input,textarea,.monaco-editor',
          );
          if (input) document.execCommand(a);
          else current[a]();
          break;
        }
        case 'prototype':
        case 'debug':
          useWorkspace.setState({ workspace: a });
          break;
        case 'output':
          useWorkspace.setState({ outputOpen: !current.outputOpen });
          break;
        case 'layout':
          if (dock.current) defaults(dock.current, current.workspace);
          break;
        case 'verify':
          void verifyProject();
          break;
        case 'simulate':
          void current.run(true);
          break;
        case 'program':
          void programBoard().catch(hardwareError);
          break;
        case 'refresh':
          void window.trace?.hardware
            .discover()
            .then((snapshot) => useHardware.setState({ snapshot }))
            .catch(hardwareError);
          break;
        case 'board':
          document.querySelector<HTMLDetailsElement>('.board-picker')?.setAttribute('open', '');
          break;
        case 'monitor':
          monitor();
          break;
        case 'reset':
          void requestHardware(
            { action: 'reset', portKey: useHardware.getState().portKey, mechanism: 'dtr-pulse' },
            'Reset the selected board using DTR.',
          ).catch(hardwareError);
          break;
        case 'help':
          useWorkspace.setState({
            notice:
              'Verify compiles visible source. Simulate executes Mega MCU only. Program uploads an approved artifact; serial data comes only from firmware output.',
          });
          break;
      }
    };
    const remove = window.trace?.onMenuAction?.(action);
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const map: Record<string, string> = {
        s: e.shiftKey ? 'save' : 'save',
        o: 'open',
        ',': 'settings',
        '1': 'prototype',
        '2': 'debug',
        j: 'output',
      };
      if (!window.trace) {
        map.z = e.shiftKey ? 'redo' : 'undo';
        map.r = 'verify';
        map.u = 'program';
      }
      if (map[e.key]) {
        e.preventDefault();
        action(map[e.key]);
      }
    };
    const custom = (e: Event) => action((e as CustomEvent<string>).detail);
    window.addEventListener('keydown', key);
    window.addEventListener('trace:menu', custom);
    return () => {
      remove?.();
      window.removeEventListener('keydown', key);
      window.removeEventListener('trace:menu', custom);
    };
  }, []);
  useEffect(() => {
    void window.trace?.setProjectTitle?.(s.project.name);
  }, [s.project.name]);
  useEffect(() => {
    if (!dock.current || activeWorkspace.current === s.workspace) return;
    try {
      localStorage.setItem(
        `trace.layout.${activeWorkspace.current}.v2`,
        JSON.stringify(dock.current.toJSON()),
      );
    } catch {}
    activeWorkspace.current = s.workspace;
    const saved = localStorage.getItem(`trace.layout.${s.workspace}.v2`);
    try {
      if (saved) dock.current.fromJSON(JSON.parse(saved));
      else defaults(dock.current, s.workspace);
    } catch {
      defaults(dock.current, s.workspace);
    }
  }, [s.workspace]);
  const ready = (e: DockviewReadyEvent) => {
    dock.current = e.api;
    const saved = localStorage.getItem(`trace.layout.${s.workspace}.v2`);
    try {
      if (saved) e.api.fromJSON(JSON.parse(saved));
      else defaults(e.api, s.workspace);
    } catch {
      defaults(e.api, s.workspace);
    }
    e.api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(
          `trace.layout.${activeWorkspace.current}.v2`,
          JSON.stringify(e.api.toJSON()),
        );
      } catch {}
    });
  };
  return (
    <div className="app-shell">
      <div className="app-toolbar" role="toolbar" aria-label="Workspace actions">
        {s.workspace === 'prototype' ? (
          <>
            <button
              className="verify-button secondary"
              onClick={() => void verifyProject()}
              disabled={s.building || h.preparing || h.snapshot?.busy || !target}
            >
              <CheckCircle2 size={15} />
              {s.building ? 'Verifying…' : 'Verify'}
            </button>
            <button
              className="primary"
              disabled={s.building || h.preparing || h.snapshot?.busy || !target}
              onClick={() => void programBoard().catch(hardwareError)}
            >
              <Play size={13} />
              {h.preparing ? 'Preparing…' : 'Program Board'}
            </button>
          </>
        ) : (
          <>
            <button className="secondary" disabled={h.preparing} onClick={monitor}>
              <PanelBottom size={14} />
              {h.snapshot?.serial.state === 'connected' ? 'Stop monitoring' : 'Start monitoring'}
            </button>
            <button
              className="primary"
              disabled={h.preparing || s.building || h.snapshot?.busy}
              onClick={() => void programBoard().catch(hardwareError)}
            >
              Program Board
            </button>
          </>
        )}
        <BoardSelector />
        {(s.building || h.preparing || h.snapshot?.busy) && (
          <IconButton
            title="Stop operation"
            onClick={() => {
              s.cancelBuild();
              if (h.preparationId) cancelPreparation();
              for (const r of h.snapshot?.requests ?? [])
                if (r.status === 'running') void window.trace?.hardware.cancel(r.id);
            }}
          >
            <Square />
          </IconButton>
        )}
        <span className="spacer" />
        {s.workspace === 'prototype' && (
          <button
            className="quiet"
            title={
              targetPart?.simulation === 'simavr-external'
                ? 'Simulate Mega MCU only'
                : 'No execution model for this board'
            }
            disabled={s.building || targetPart?.simulation !== 'simavr-external'}
            onClick={() => void s.run(true)}
          >
            Simulate
          </button>
        )}
        <button
          className="issues-button"
          title="Issues and output"
          aria-label="Issues and output"
          onClick={() =>
            useWorkspace.setState({ outputOpen: !s.outputOpen, outputTab: 'diagnostics' })
          }
        >
          <AlertTriangle size={13} />
          {s.diagnostics.filter((d) => d.severity === 'error').length || ''}
        </button>
        <div className="segmented workspace-switch" aria-label="Workspace">
          {(['prototype', 'debug'] as const).map((w) => (
            <button
              key={w}
              className={s.workspace === w ? 'active' : ''}
              onClick={() => useWorkspace.setState({ workspace: w })}
            >
              {w === 'prototype' ? 'Prototype' : 'Debug'}
            </button>
          ))}
        </div>
      </div>
      <main className="workspace">
        <DockviewReact
          components={components}
          dndStrategy="pointer"
          onReady={ready}
          theme={themeDark}
          rightHeaderActionsComponent={HeaderActions}
          disableAutoResizing={false}
        />
      </main>
      {s.outputOpen && <Output />}
      {s.notice && (
        <div className="notice" role="status">
          <span>{s.notice}</span>
          <IconButton title="Dismiss message" onClick={s.dismissNotice}>
            <X />
          </IconButton>
        </div>
      )}
      {s.settings && <Settings />}
      <HardwareDialogs />
    </div>
  );
}
