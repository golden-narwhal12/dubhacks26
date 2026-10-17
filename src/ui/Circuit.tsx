import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  ConnectionMode,
  Background,
  Controls,
  applyNodeChanges,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, MousePointer2, Move, Trash2, X, Search, ExternalLink, RotateCw } from 'lucide-react';
import { partById, searchParts } from '../parts/catalog';
import type { Part, Terminal, Component, View } from '../domain/schema';
import { useWorkspace, selectedIds, uid } from './store';
import { Badge, IconButton } from './primitives';
import { deriveNets, netFor } from '../domain/topology';

type PinPosition = { x: number; y: number; side: Position };
function baseGeometry(
  part: Part,
  view: View,
): { width: number; height: number; pins: Record<string, PinPosition> } {
  const pins: Record<string, PinPosition> = {};
  if (part.kind === 'resistor')
    return {
      width: 130,
      height: 54,
      pins: {
        p1: { x: 0, y: 27, side: Position.Left },
        p2: { x: 130, y: 27, side: Position.Right },
      },
    };
  if (part.kind === 'led')
    return {
      width: 80,
      height: 108,
      pins: {
        a: { x: 20, y: 108, side: Position.Bottom },
        k: { x: 60, y: 108, side: Position.Bottom },
      },
    };
  if (part.id === 'esp32-s3-devkitc1-v11') {
    for (const t of part.terminals)
      pins[t.id] = {
        x: t.header === 'J1' ? 0 : 186,
        y: 38 + ((t.physicalPin ?? 1) - 1) * 23,
        side: t.header === 'J1' ? Position.Left : Position.Right,
      };
    return { width: 186, height: 560, pins };
  }
  // A readable illustrative Rev3 header arrangement. Every physical terminal is explicit.
  const top = [
    'scl',
    'sda',
    'aref',
    'gnd3',
    ...Array.from({ length: 14 }, (_, i) => `d${13 - i}`),
    ...Array.from({ length: 8 }, (_, i) => `d${14 + i}`),
  ];
  const bottom = [
    'nc',
    'ioref',
    'reset',
    '3v3',
    '5v',
    'gnd1',
    'gnd2',
    'vin',
    ...Array.from({ length: 16 }, (_, i) => `a${i}`),
  ];
  top.forEach((id, i) => (pins[id] = { x: 38 + i * 23, y: 0, side: Position.Top }));
  bottom.forEach((id, i) => (pins[id] = { x: 38 + i * 23, y: 310, side: Position.Bottom }));
  ['5v2', ...Array.from({ length: 16 }, (_, i) => `d${22 + i * 2}`), 'gnd4'].forEach(
    (id, i) => (pins[id] = { x: 660, y: 10 + i * 17, side: Position.Right }),
  );
  ['5v3', ...Array.from({ length: 16 }, (_, i) => `d${23 + i * 2}`), 'gnd5'].forEach(
    (id, i) => (pins[id] = { x: 704, y: 10 + i * 17, side: Position.Right }),
  );
  return { width: 704, height: 310, pins };
}
function geometry(part: Part, view: View, rotation = 0) {
  let g = baseGeometry(part, view);
  const sides = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  for (let i = 0; i < rotation / 90; i++) {
    const h = g.height;
    g = {
      width: g.height,
      height: g.width,
      pins: Object.fromEntries(
        Object.entries(g.pins).map(([id, p]) => [
          id,
          { x: h - p.y, y: p.x, side: sides[(sides.indexOf(p.side) + 1) % 4] },
        ]),
      ),
    };
  }
  return g;
}
function Artwork({ part, view }: { part: Part; view: View }) {
  if (part.kind === 'resistor')
    return (
      <svg width="130" height="54" viewBox="0 0 130 54">
        <path d="M0 27H130" stroke="var(--metal)" strokeWidth="4" />
        {view === 'schematic' ? (
          <rect
            x="33"
            y="17"
            width="64"
            height="20"
            fill="var(--panel)"
            stroke="var(--text)"
            strokeWidth="2"
          />
        ) : (
          <>
            <rect x="28" y="13" width="74" height="28" rx="10" fill="var(--resistor)" />
            {[40, 48, 56, 74, 87].map((x, i) => (
              <rect
                key={x}
                x={x}
                y="14"
                width="5"
                height="26"
                fill={['#b76431', '#b76431', '#20272c', '#20272c', '#775441'][i]}
              />
            ))}
          </>
        )}
      </svg>
    );
  if (part.kind === 'led')
    return (
      <svg width="80" height="108" viewBox="0 0 80 108">
        {view === 'wiring' && (
          <path d="M20 60V108M60 60V108" stroke="var(--metal)" strokeWidth="3" />
        )}
        {view === 'schematic' ? (
          <>
            <path
              d="M20 108V50H30 M30 36V64L54 50Z M54 34V66 M54 50H60V108 M47 28L58 17 M53 17H58V22 M58 35L69 24 M64 24H69V29"
              fill="none"
              stroke="var(--text)"
              strokeWidth="2"
            />
          </>
        ) : (
          <>
            <path d="M14 61V39A26 26 0 0 1 66 39V61Z" fill="var(--red)" opacity=".8" />
            <rect x="10" y="60" width="60" height="8" rx="3" fill="var(--red)" />
            <path
              d="M24 43V31"
              stroke="var(--text)"
              opacity=".35"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <text x="57" y="88" fill="var(--muted)" fontSize="9">
              K
            </text>
          </>
        )}
      </svg>
    );
  const esp = part.id.startsWith('esp32');
  const { width, height } = geometry(part, view);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="board-art">
      <rect
        x="1"
        y="1"
        width={width - 2}
        height={height - 2}
        rx={esp ? 5 : 13}
        fill={view === 'schematic' ? 'var(--panel)' : 'var(--board)'}
        stroke={view === 'schematic' ? 'var(--muted)' : 'var(--board-edge)'}
        strokeWidth="2"
      />
      {view === 'wiring' && (
        <>
          {(esp
            ? [
                [16, 18],
                [170, 18],
                [16, 540],
                [170, 540],
              ]
            : [
                [20, 40],
                [600, 40],
                [20, 270],
                [600, 270],
              ]
          ).map(([x, y]) => (
            <circle
              key={`${x},${y}`}
              cx={x}
              cy={y}
              r="7"
              fill="var(--canvas)"
              stroke="var(--metal)"
              strokeWidth="2"
            />
          ))}
          {esp ? (
            <>
              <rect x="44" y="56" width="98" height="180" rx="3" fill="var(--metal)" />
              <rect x="44" y="54" width="98" height="42" fill="var(--chip)" />
              <path
                d="M55 80V63H66V80H77V63H88V80H99V63H110V80H130"
                fill="none"
                stroke="var(--copper)"
                strokeWidth="3"
              />
              <text x="93" y="151" textAnchor="middle" fill="var(--chip)" fontSize="12">
                ESP32-S3
              </text>
              <rect x="70" y="463" width="47" height="41" rx="3" fill="var(--metal)" />
              <rect x="41" y="399" width="26" height="19" rx="3" fill="var(--chip)" />
              <rect x="121" y="399" width="26" height="19" rx="3" fill="var(--chip)" />
            </>
          ) : (
            <>
              <rect x="-8" y="66" width="64" height="65" rx="3" fill="var(--metal)" />
              <rect x="8" y="202" width="54" height="43" rx="3" fill="var(--chip)" />
              <rect
                x="338"
                y="116"
                width="87"
                height="87"
                fill="var(--chip)"
                stroke="var(--metal)"
                strokeWidth="1"
              />
              {Array.from({ length: 12 }, (_, i) => (
                <path
                  key={i}
                  d={`M${342 + i * 7} 108V116 M${342 + i * 7} 203V211 M330 ${120 + i * 7}H338 M425 ${120 + i * 7}H433`}
                  stroke="var(--metal)"
                  strokeWidth="2"
                />
              ))}
              <rect x="105" y="85" width="37" height="38" fill="var(--chip)" />
              <rect x="183" y="210" width="34" height="15" rx="7" fill="var(--metal)" />
              <rect x="64" y="28" width="28" height="20" rx="2" fill="var(--metal)" />
              <circle cx="95" cy="205" r="12" fill="var(--metal)" />
              <circle cx="128" cy="205" r="12" fill="var(--metal)" />
              <text x="381" y="163" textAnchor="middle" fill="var(--muted)" fontSize="9">
                ATMEGA2560
              </text>
            </>
          )}
        </>
      )}
      <text
        x={esp ? 93 : 215}
        y={esp ? 288 : 142}
        textAnchor="middle"
        fill="var(--board-ink)"
        fontSize={esp ? 16 : 22}
        fontWeight="600"
      >
        {esp ? 'ESPRESSIF' : 'MEGA 2560'}
      </text>
      <text
        x={esp ? 93 : 215}
        y={esp ? 309 : 164}
        textAnchor="middle"
        fill="var(--board-ink)"
        opacity=".7"
        fontSize="10"
      >
        {esp ? 'DevKitC-1 · v1.1' : 'REV3   /   ARDUINO'}
      </text>
    </svg>
  );
}
type PartNode = Node<
  { component: Component; part: Part; view: View; highlighted: boolean; rotation: number },
  'part'
>;
function PartNodeView({ data }: NodeProps<PartNode>) {
  const select = useWorkspace((s) => s.select),
    selection = useWorkspace((s) => s.selection);
  const { component: c, part, view, rotation } = data;
  const update = useUpdateNodeInternals();
  useEffect(() => update(c.id), [rotation, view, c.id, update]);
  const g = geometry(part, view, rotation),
    base = baseGeometry(part, view);
  const offset =
    rotation === 90
      ? [base.height, 0]
      : rotation === 180
        ? [base.width, base.height]
        : rotation === 270
          ? [0, base.width]
          : [0, 0];
  return (
    <div
      className={`part-node ${data.highlighted ? 'highlighted' : ''}`}
      style={{ width: g.width, height: g.height }}
    >
      <div className="part-name">
        <strong>{c.ref}</strong>
        <span>{c.config.label ?? part.name}</span>
      </div>
      <div
        className="part-art"
        style={{
          position: 'absolute',
          transform: `translate(${offset[0]}px, ${offset[1]}px) rotate(${rotation}deg)`,
          transformOrigin: '0 0',
        }}
      >
        <Artwork part={part} view={view} />
      </div>
      {part.terminals.map((t) => {
        const pin = g.pins[t.id];
        if (!pin) return null;
        const active =
          selection?.kind === 'terminal' &&
          selection.endpoint.componentId === c.id &&
          selection.endpoint.terminalId === t.id;
        return (
          <div
            key={t.id}
            className={`pin-wrap ${pin.side} ${t.kind} ${active ? 'active' : ''}`}
            style={{ left: pin.x, top: pin.y }}
          >
            <Handle
              id={t.id}
              type="source"
              position={pin.side}
              className="terminal-handle"
              role="button"
              tabIndex={0}
              title={`${c.ref} · ${t.label}${t.gpio ? ` / ${t.gpio}` : ''}`}
              aria-label={`${c.ref} terminal ${t.label}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select({
                    kind: 'terminal',
                    id: `${c.id}:${t.id}`,
                    endpoint: { componentId: c.id, terminalId: t.id },
                  });
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                select({
                  kind: 'terminal',
                  id: `${c.id}:${t.id}`,
                  endpoint: { componentId: c.id, terminalId: t.id },
                });
              }}
            />
            <span className="pin-label">{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}
const nodeTypes = { part: PartNodeView };
export function Circuit() {
  return (
    <ReactFlowProvider>
      <CircuitCanvas />
    </ReactFlowProvider>
  );
}
function CircuitCanvas() {
  const project = useWorkspace((s) => s.project),
    view = useWorkspace((s) => s.view),
    selection = useWorkspace((s) => s.selection),
    select = useWorkspace((s) => s.select),
    apply = useWorkspace((s) => s.apply),
    library = useWorkspace((s) => s.library);
  const flow = useReactFlow();
  const [dragNodes, setDragNodes] = useState<Node[] | null>(null);
  const [pan, setPan] = useState(false);
  const ids = selectedIds(selection);
  const nodes = useMemo<PartNode[]>(
    () =>
      project.components.map((c) => {
        const placement = project.layouts[view][c.id],
          part = partById(c.partId),
          g = geometry(part, view, placement.rotation);
        return {
          id: c.id,
          type: 'part',
          position: placement,
          data: {
            component: c,
            part,
            view,
            rotation: placement.rotation,
            highlighted: ids.includes(c.id),
          },
          selected: ids.includes(c.id),
          dragHandle: '.board-art, .part-name, svg',
          style: { width: g.width, height: g.height },
        };
      }),
    [project, view, selection],
  );
  const edges: Edge[] = project.wires.map((w) => ({
    id: w.id,
    source: w.from.componentId,
    sourceHandle: w.from.terminalId,
    target: w.to.componentId,
    targetHandle: w.to.terminalId,
    type: 'smoothstep',
    selected: ids.includes(w.id),
    style: { stroke: `var(--wire-${w.color})`, strokeWidth: ids.includes(w.id) ? 3 : 2 },
    interactionWidth: 20,
  }));
  const connect = useCallback(
    (c: Connection) => {
      if (c.sourceHandle && c.targetHandle)
        apply('Connect terminals', [
          {
            type: 'connect',
            wire: {
              id: uid('wire'),
              from: { componentId: c.source, terminalId: c.sourceHandle },
              to: { componentId: c.target, terminalId: c.targetHandle },
              color: 'mint',
            },
          },
        ]);
    },
    [apply],
  );
  const remove = () => {
    if (selection?.kind === 'component')
      apply('Remove component', [{ type: 'removeComponent', id: selection.id }]);
    if (selection?.kind === 'wire')
      apply('Remove wire', [{ type: 'disconnect', id: selection.id }]);
    select(null);
  };
  return (
    <div className="circuit-panel">
      <div className="panel-toolbar">
        <div className="segmented">
          <button
            className={view === 'wiring' ? 'active' : ''}
            onClick={() => useWorkspace.setState({ view: 'wiring' })}
          >
            Wiring
          </button>
          <button
            className={view === 'schematic' ? 'active' : ''}
            onClick={() => useWorkspace.setState({ view: 'schematic' })}
          >
            Schematic
          </button>
        </div>
        <span className="spacer" />
        <IconButton title={pan ? 'Select objects' : 'Pan canvas'} onClick={() => setPan(!pan)}>
          {pan ? <Move /> : <MousePointer2 />}
        </IconButton>
        <IconButton
          title="Delete selection"
          onClick={remove}
          disabled={!selection || !['component', 'wire'].includes(selection.kind)}
        >
          <Trash2 />
        </IconButton>
        <button className="secondary" onClick={() => useWorkspace.setState({ library: !library })}>
          <Plus size={14} /> Parts
        </button>
      </div>
      <div
        className="canvas-area"
        onKeyDown={(e) => {
          if (
            (e.key === 'Delete' || e.key === 'Backspace') &&
            (e.target as HTMLElement).closest('.react-flow')
          ) {
            e.preventDefault();
            remove();
          }
        }}
      >
        <ReactFlow
          nodes={dragNodes ?? nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          onConnect={connect}
          onNodeClick={(_e, n) => select({ kind: 'component', id: n.id })}
          onEdgeClick={(_e, e) => select({ kind: 'wire', id: e.id })}
          onPaneClick={() => select(null)}
          onNodesChange={(changes) => {
            if (changes.some((c) => c.type === 'position'))
              setDragNodes((current) => applyNodeChanges(changes, current ?? nodes));
          }}
          onNodeDragStop={(_e, n) => {
            apply('Move component', [
              {
                type: 'moveComponent',
                id: n.id,
                view,
                placement: { ...n.position, rotation: project.layouts[view][n.id].rotation },
              },
            ]);
            setDragNodes(null);
          }}
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
          minZoom={0.25}
          maxZoom={2.5}
          snapToGrid
          snapGrid={[8, 8]}
          nodesDraggable={!pan}
          panOnDrag={pan ? [0, 1, 2] : [1, 2]}
          panOnScroll
          deleteKeyCode={null}
          connectionRadius={24}
          connectionDragThreshold={4}
          nodeDragThreshold={5}
          colorMode="dark"
          proOptions={{ hideAttribution: false }}
        >
          <Background color="var(--border)" gap={20} size={1} />
          <Controls showInteractive={false} fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }} />
        </ReactFlow>
        {!project.components.length && (
          <div className="canvas-empty">
            <h2>Start with a connection.</h2>
            <p>Add a board, then wire your first part.</p>
            <button className="secondary" onClick={() => useWorkspace.setState({ library: true })}>
              <Plus size={14} /> Add a part
            </button>
          </div>
        )}
        <div className="canvas-caption">
          <span>DOCUMENTED DESIGN</span>
          <span>
            {project.components.length} parts · {project.wires.length} wires
          </span>
        </div>
        {library && (
          <PartLibrary
            onAdded={() => {
              setTimeout(() => void flow.fitView({ padding: 0.25, duration: 250 }), 50);
            }}
          />
        )}
        {selection && !library && <Inspector />}
      </div>
    </div>
  );
}
function PartLibrary({ onAdded }: { onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const apply = useWorkspace((s) => s.apply);
  const project = useWorkspace((s) => s.project);
  return (
    <aside className="library floating-surface">
      <div className="row">
        <h3>Parts</h3>
        <span className="spacer" />
        <IconButton title="Close parts" onClick={() => useWorkspace.setState({ library: false })}>
          <X />
        </IconButton>
      </div>
      <div className="search">
        <Search size={14} />
        <input
          aria-label="Search parts"
          autoFocus
          placeholder="Name, part number, capability…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="part-results">
        {searchParts(query).map((p) => (
          <button
            key={p.id}
            className="part-result"
            onClick={() => {
              const id = uid('part'),
                n = project.components.length + 1;
              const refPrefix = p.kind === 'board' ? 'U' : p.kind === 'led' ? 'D' : 'R';
              let ref = `${refPrefix}${n}`;
              while (project.components.some((c) => c.ref === ref)) ref += 'a';
              const commands: any[] = [
                {
                  type: 'addComponent',
                  component: { id, partId: p.id, partVersion: 1, ref, config: {} },
                  placement: {
                    x: project.components.length
                      ? Math.min(
                          9000,
                          Math.max(
                            ...project.components.map((c) => {
                              const at = project.layouts.wiring[c.id];
                              return (
                                at.x + geometry(partById(c.partId), 'wiring', at.rotation).width
                              );
                            }),
                          ) + 80,
                        )
                      : 40,
                    y: 80,
                    rotation: 0,
                  },
                },
              ];
              if (!project.targetBoardId && p.kind === 'board')
                commands.push({ type: 'setTarget', id });
              apply(`Add ${p.name}`, commands);
              useWorkspace.setState({ library: false, selection: { kind: 'component', id } });
              onAdded();
            }}
          >
            <div className="part-preview">
              <Artwork part={p} view="schematic" />
            </div>
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.manufacturer} · {p.mpn}
              </small>
              <div className="row wrap">
                <Badge tone={p.verifiedMapping ? 'accent' : 'warning'}>
                  {p.verifiedMapping ? 'Pin map verified' : 'Provisional map'}
                </Badge>
                <Badge>{p.constraints ? 'Known constraints' : 'Constraints unknown'}</Badge>
                {p.firmware && <Badge>Compile</Badge>}
                <Badge>
                  {p.simulation === 'simavr-external' ? 'MCU model' : 'No execution model'}
                </Badge>
              </div>
            </div>
            <Plus size={14} />
          </button>
        ))}
      </div>
      <small>4 exact packages · local library</small>
    </aside>
  );
}
function Inspector() {
  const project = useWorkspace((s) => s.project),
    selection = useWorkspace((s) => s.selection),
    apply = useWorkspace((s) => s.apply);
  if (!selection) return null;
  const component = project.components.find(
    (c) => c.id === (selection.kind === 'terminal' ? selection.endpoint.componentId : selection.id),
  );
  if (selection.kind === 'wire') {
    const w = project.wires.find((w) => w.id === selection.id);
    if (!w) return null;
    return (
      <aside className="inspector floating-surface">
        <div className="row">
          <h3>Connection</h3>
          <span className="spacer" />
          <IconButton
            title="Close inspector"
            onClick={() => useWorkspace.setState({ selection: null })}
          >
            <X />
          </IconButton>
        </div>
        <p className="mono">
          {w.from.componentId}:{w.from.terminalId}
          <br />↳ {w.to.componentId}:{w.to.terminalId}
        </p>
        <button
          className="danger secondary"
          onClick={() => {
            apply('Disconnect terminals', [{ type: 'disconnect', id: w.id }]);
            useWorkspace.setState({ selection: null });
          }}
        >
          <Trash2 size={13} /> Disconnect
        </button>
      </aside>
    );
  }
  if (!component) return null;
  const part = partById(component.partId),
    pin =
      selection.kind === 'terminal'
        ? part.terminals.find((t) => t.id === selection.endpoint.terminalId)
        : undefined;
  return (
    <aside className="inspector floating-surface">
      <div className="row">
        <h3>{pin ? `${component.ref} / ${pin.label}` : component.ref}</h3>
        <span className="spacer" />
        <IconButton
          title="Close inspector"
          onClick={() => useWorkspace.setState({ selection: null })}
        >
          <X />
        </IconButton>
      </div>
      <strong>{part.name}</strong>
      <small>
        {part.mpn} · {part.revision}
      </small>
      {pin ? (
        <>
          <div className="pin-facts">
            <span>GPIO</span>
            <span className="mono">{pin.gpio ?? '—'}</span>
            <span>Firmware</span>
            <span className="mono">{pin.firmwareAlias ?? '—'}</span>
            <span>Type</span>
            <span>{pin.kind}</span>
            {pin.header && (
              <>
                <span>Header</span>
                <span>
                  {pin.header}
                  {pin.physicalPin ? ` · pin ${pin.physicalPin}` : ''}
                </span>
              </>
            )}
            {pin.voltage !== undefined && (
              <>
                <span>Nominal</span>
                <span>{pin.voltage} V</span>
              </>
            )}
          </div>
          <div className="row wrap">
            {pin.capabilities.map((c) => (
              <Badge key={c}>{c}</Badge>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="field">
            Reference
            <input
              key={component.id}
              defaultValue={component.ref}
              onBlur={(e) => {
                if (e.target.value !== component.ref)
                  apply('Rename component', [
                    { type: 'configureComponent', id: component.id, ref: e.target.value },
                  ]);
              }}
            />
          </label>
          <label className="field">
            Label
            <input
              key={`${component.id}-label`}
              defaultValue={component.config.label ?? ''}
              placeholder="Optional label"
              onBlur={(e) => {
                if (e.target.value !== (component.config.label ?? ''))
                  apply('Label component', [
                    { type: 'configureComponent', id: component.id, label: e.target.value },
                  ]);
              }}
            />
          </label>
          {part.firmware && (
            <button
              className="secondary"
              onClick={() =>
                apply('Choose build target', [{ type: 'setTarget', id: component.id }])
              }
            >
              {project.targetBoardId === component.id ? 'Build target' : 'Use as build target'}
            </button>
          )}
        </>
      )}
      <details>
        <summary>
          Documented facts <Badge>{part.evidence.length}</Badge>
        </summary>
        {part.evidence
          .filter((e) => !pin || pin.evidenceIds.includes(e.id))
          .map((e) => (
            <div key={e.id} className="evidence">
              <p>{e.fact}</p>
              <small>
                {e.location} · {e.revision}
              </small>
              <a href={e.url} target="_blank" rel="noreferrer">
                {e.title} <ExternalLink size={11} />
              </a>
              <Badge tone={e.status === 'verified' ? 'accent' : 'warning'}>{e.status}</Badge>
            </div>
          ))}
      </details>
      {pin?.kind === 'gpio' && part.firmware && (
        <BindingEditor key={`${component.id}:${pin.id}`} component={component} pin={pin} />
      )}
      {!pin && (
        <button
          className="secondary"
          onClick={() => {
            const view = useWorkspace.getState().view,
              placement = project.layouts[view][component.id];
            apply('Rotate component', [
              {
                type: 'moveComponent',
                id: component.id,
                view,
                placement: {
                  ...placement,
                  rotation: ((placement.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                },
              },
            ]);
          }}
        >
          <RotateCw size={13} /> Rotate 90°
        </button>
      )}
      {part.coverage && <small>{part.coverage}</small>}
      <small>Illustrative geometry · explicit terminals</small>
    </aside>
  );
}
function BindingEditor({ component, pin }: { component: Component; pin: Terminal }) {
  const project = useWorkspace((s) => s.project),
    apply = useWorkspace((s) => s.apply);
  const existing = project.bindings.find(
    (b) => b.boardId === component.id && b.terminalId === pin.id,
  );
  const targets =
    netFor(deriveNets(project), {
      componentId: component.id,
      terminalId: pin.id,
    })?.terminals.filter((t) => t.componentId !== component.id) ?? [];
  const [symbol, setSymbol] = useState(existing?.symbol ?? ''),
    [fileId, setFileId] = useState(existing?.fileId ?? project.files[0].id),
    [targetKey, setTargetKey] = useState(
      existing
        ? `${existing.target.componentId}:${existing.target.terminalId}`
        : targets[0]
          ? `${targets[0].componentId}:${targets[0].terminalId}`
          : '',
    ),
    [mode, setMode] = useState<'input' | 'output' | 'input_pullup' | 'pwm'>(
      existing?.mode ?? 'output',
    );
  return (
    <details>
      <summary>Firmware binding</summary>
      <div className="stack binding-form">
        <label className="field">
          Symbol
          <input
            aria-label="Firmware binding symbol"
            value={symbol}
            placeholder="LED_PIN"
            onChange={(e) => setSymbol(e.target.value)}
          />
        </label>
        <label className="field">
          File
          <select value={fileId} onChange={(e) => setFileId(e.target.value)}>
            {project.files.map((f) => (
              <option value={f.id} key={f.id}>
                {f.path}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Signal terminal
          <select
            aria-label="Binding signal terminal"
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
          >
            <option value="">Select connected signal</option>
            {targets.map((t) => (
              <option
                key={`${t.componentId}:${t.terminalId}`}
                value={`${t.componentId}:${t.terminalId}`}
              >
                {project.components.find((c) => c.id === t.componentId)?.ref}.{t.terminalId}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Configured mode
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="output">Output</option>
            <option value="input">Input</option>
            <option value="input_pullup">Input pull-up</option>
            <option value="pwm">PWM</option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol) || !targetKey}
          onClick={() => {
            const [componentId, terminalId] = targetKey.split(':');
            apply('Set explicit firmware pin binding', [
              {
                type: 'setBinding',
                binding: {
                  id: existing?.id ?? uid('binding'),
                  boardId: component.id,
                  terminalId: pin.id,
                  target: { componentId, terminalId },
                  fileId,
                  symbol,
                  mode,
                },
              },
            ]);
          }}
        >
          Save binding
        </button>
        {existing && (
          <button
            className="danger"
            onClick={() =>
              apply('Remove pin binding', [{ type: 'removeBinding', id: existing.id }])
            }
          >
            Remove binding
          </button>
        )}
        <small>
          Records intended configuration. Local checks analyze simple literal pin constants.
        </small>
      </div>
    </details>
  );
}
