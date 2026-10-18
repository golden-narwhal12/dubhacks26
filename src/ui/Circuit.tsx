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
  type EdgeProps,
  BaseEdge,
  ControlButton,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus,
  MousePointer2,
  Move,
  Trash2,
  X,
  Search,
  ExternalLink,
  RotateCw,
  CheckCircle2,
  CornerUpRight,
  Scan,
} from 'lucide-react';
import { partById, searchParts } from '../parts/catalog';
import type { Part, Terminal, Component, View } from '../domain/schema';
import { useWorkspace, selectedIds, uid } from './store';
import { Badge, IconButton } from './primitives';
import { deriveNets, netFor } from '../domain/topology';
import { routeWires, routePath, routeBounds, type WireRoute } from './routing';

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
      width: 56,
      height: 100,
      pins: {
        a: { x: 16, y: 100, side: Position.Bottom },
        k: { x: 40, y: 100, side: Position.Bottom },
      },
    };
  if (part.kind === 'breadboard') {
    for (const t of part.terminals) {
      const match = /^([a-j])(\d+)$/.exec(t.id);
      if (match) {
        const col = match[1].charCodeAt(0) - 97;
        pins[t.id] = {
          x: 30 + (col < 5 ? col : col + 2) * 13,
          y: 35 + (Number(match[2]) - 1) * 13,
          side: col < 5 ? Position.Left : Position.Right,
        };
      } else {
        const rail = /^(lp|ln|rp|rn)(\d+)$/.exec(t.id);
        if (rail)
          pins[t.id] = {
            x: ({ lp: 0, ln: 13, rp: 199, rn: 212 } as Record<string, number>)[rail[1]],
            y: 35 + (Number(rail[2]) - 1) * 16,
            side: rail[1][0] === 'l' ? Position.Left : Position.Right,
          };
      }
    }
    return { width: 212, height: 870, pins };
  }
  if (part.kind !== 'board') {
    const layouts: Record<string, string[][]> = {
      encoder: [
        ['vcc', 'out', 'gnd'],
        ['dir', 'scl', 'sda', 'gpo'],
      ],
      servo: [['power', 'gnd', 'signal'], []],
      potentiometer: [['p1'], ['wiper', 'p2']],
      photointerruptor: [
        ['a', 'k'],
        ['c', 'e'],
      ],
    };
    const rows = layouts[part.kind] ?? [part.terminals.map((t) => t.id), []];
    rows.forEach((row, side) =>
      row.forEach(
        (id, i) =>
          (pins[id] = {
            x: side ? 130 : 0,
            y: 28 + i * 25,
            side: side ? Position.Right : Position.Left,
          }),
      ),
    );
    return { width: 130, height: 130, pins };
  }
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
    (id, i) => (pins[id] = { x: 704, y: 18.5 + i * 17, side: Position.Right }),
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
function Artwork({ part, view, component }: { part: Part; view: View; component?: Component }) {
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
            {part.id === 'generic-resistor' ? (
              <text x="65" y="32" textAnchor="middle" fill="var(--chip)" fontSize="10">
                {component?.config.resistanceOhms ?? 330} Ω
              </text>
            ) : (
              [40, 48, 56, 74, 87].map((x, i) => (
                <rect
                  key={x}
                  x={x}
                  y="14"
                  width="5"
                  height="26"
                  fill={
                    [
                      'var(--band-orange)',
                      'var(--band-orange)',
                      'var(--band-black)',
                      'var(--band-black)',
                      'var(--band-brown)',
                    ][i]
                  }
                />
              ))
            )}
          </>
        )}
      </svg>
    );
  if (part.kind === 'led') {
    const color = component?.config.ledColor ?? 'red';
    return (
      <svg width="56" height="100" viewBox="0 0 56 100">
        {view === 'schematic' ? (
          <path
            d="M16 100V42H20 M20 30V54L37 42Z M37 28V56 M37 42H40V100 M32 23L43 12 M38 12H43V17 M42 29L52 19 M47 19H52V24"
            fill="none"
            stroke="var(--text)"
            strokeWidth="2"
          />
        ) : (
          <>
            <path d="M16 50V100M40 50V100" stroke="var(--metal)" strokeWidth="3" />
            <path
              d="M12 53V32A16 20 0 0 1 44 32V53Z"
              fill={`var(--led-${color}, var(--red))`}
              opacity=".85"
            />
            <rect
              x="9"
              y="52"
              width="38"
              height="6"
              rx="2"
              fill={`var(--led-${color}, var(--red))`}
            />
            <path
              d="M20 33V24"
              stroke="var(--text)"
              opacity=".4"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <text x="40" y="81" fill="var(--muted)" fontSize="9">
              K
            </text>
          </>
        )}
      </svg>
    );
  }
  if (part.kind === 'breadboard') {
    const g = baseGeometry(part, view);
    return (
      <svg width={g.width} height={g.height} className="board-art">
        <rect width={g.width} height={g.height} rx="5" fill="var(--raised)" stroke="var(--metal)" />
        <rect x="91" y="15" width="26" height="840" fill="var(--canvas)" />
        {Object.entries(g.pins).map(([id, p]) => (
          <circle key={id} cx={p.x} cy={p.y} r="2.5" fill="var(--canvas)" />
        ))}
        <text x="106" y="863" textAnchor="middle" fill="var(--text)" fontSize="10">
          BB830
        </text>
        {'abcdefghij'.split('').map((label, i) => (
          <text
            key={label}
            x={30 + (i < 5 ? i : i + 2) * 13}
            y="23"
            textAnchor="middle"
            fill="var(--muted)"
            fontSize="8"
          >
            {label.toUpperCase()}
          </text>
        ))}
        {Array.from({ length: 13 }, (_, i) => i * 5 + 1)
          .filter((n) => n <= 63)
          .map((n) => (
            <text
              key={n}
              x="106"
              y={38 + (n - 1) * 13}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="8"
            >
              {n}
            </text>
          ))}
        <path d="M0 28V827M199 28V827" stroke="var(--danger)" strokeWidth="1" opacity=".5" />
        <path d="M13 28V827M212 28V827" stroke="var(--blue)" strokeWidth="1" opacity=".5" />
      </svg>
    );
  }
  if (part.kind !== 'board')
    return (
      <svg width="130" height="130" viewBox="0 0 130 130" className="board-art">
        <rect
          x="12"
          y="9"
          width="106"
          height="112"
          rx="5"
          fill={part.kind === 'servo' ? 'var(--chip)' : 'var(--board)'}
          stroke="var(--metal)"
        />
        {part.kind === 'encoder' && (
          <>
            <circle cx="65" cy="56" r="20" fill="var(--metal)" />
            <rect x="53" y="44" width="24" height="24" fill="var(--chip)" />
          </>
        )}
        {part.kind === 'potentiometer' && <circle cx="65" cy="53" r="23" fill="var(--metal)" />}
        {part.kind === 'photointerruptor' && (
          <path d="M30 30H48V78H82V30H100V96H30Z" fill="var(--chip)" stroke="var(--metal)" />
        )}
        {part.kind === 'servo' && (
          <>
            <circle cx="65" cy="48" r="19" fill="var(--metal)" />
            <path d="M30 48H100" stroke="var(--text)" strokeWidth="8" />
          </>
        )}
        <text x="65" y="111" textAnchor="middle" fill="var(--text)" fontSize="11">
          {part.kind === 'encoder'
            ? 'AS5600'
            : part.kind === 'servo'
              ? 'SG90'
              : part.kind === 'photointerruptor'
                ? 'ITR9608'
                : 'Potentiometer'}
        </text>
      </svg>
    );
  const esp = part.id.startsWith('esp32');
  const { width, height } = geometry(part, view);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="board-art">
      <rect
        x="1"
        y="1"
        width={esp ? width - 2 : 628}
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
  const diagnostics = useWorkspace((s) => s.diagnostics);
  const [showIssue, setShowIssue] = useState(false);
  const issues = diagnostics.filter(
    (d) => d.objectIds.includes(c.id) && (d.severity === 'error' || d.severity === 'warning'),
  );
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
      className={`part-node ${part.kind} ${data.highlighted ? 'highlighted' : ''}`}
      style={{ width: g.width, height: g.height }}
    >
      {issues.length > 0 && (
        <button
          className={`part-issue ${issues.some((d) => d.severity === 'error') ? 'error' : 'warning'}`}
          aria-label={`${c.ref} issues`}
          onClick={(e) => {
            e.stopPropagation();
            setShowIssue(!showIssue);
          }}
        >
          <CornerUpRight size={12} />
        </button>
      )}
      {showIssue && (
        <div className="part-issue-message nodrag">
          {issues.map((d) => (
            <p key={d.id}>{d.title}</p>
          ))}
        </div>
      )}
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
        <Artwork part={part} view={view} component={c} />
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
function RoutedEdge({ id, data, selected }: EdgeProps<Edge<{ route: WireRoute; color: string }>>) {
  const [hover, setHover] = useState(false),
    [showIssue, setShowIssue] = useState(false);
  const issues = useWorkspace((s) => s.diagnostics).filter(
    (d) => d.objectIds.includes(id) && d.severity === 'error',
  );
  const r = data?.route;
  if (!r) return null;
  const path = routePath(r.points),
    active = selected || hover;
  return (
    <g
      className="wire-trace"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <path
        d={path}
        stroke="var(--canvas)"
        strokeWidth={active ? 9 : 7}
        fill="none"
        pointerEvents="none"
      />
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        style={{
          stroke: `var(--wire-${data?.color})`,
          strokeWidth: active ? 3 : 2,
          strokeDasharray: r.failed ? '5 4' : undefined,
        }}
      />
      {r.junctions?.map((p, i) => (
        <circle
          key={`junction-${i}`}
          cx={p.x}
          cy={p.y}
          r="3"
          fill="var(--accent)"
          pointerEvents="none"
        />
      ))}
      {active &&
        r.points
          .filter((_, i) => i === 0 || i === r.points.length - 1)
          .map((p, i) => (
            <circle
              key={i}
              pointerEvents="none"
              cx={p.x}
              cy={p.y}
              r="5"
              fill="var(--canvas)"
              stroke="var(--accent)"
              strokeWidth="2"
            />
          ))}
      {issues.length > 0 && (
        <g
          role="button"
          tabIndex={0}
          aria-label="Connection errors"
          onClick={(e) => {
            e.stopPropagation();
            setShowIssue(!showIssue);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowIssue(!showIssue);
            }
          }}
          transform={`translate(${r.points[Math.floor(r.points.length / 2)].x},${r.points[Math.floor(r.points.length / 2)].y - 11})`}
        >
          <circle r="8" fill="var(--panel)" stroke="var(--danger)" />
          <text textAnchor="middle" y="4" fontSize="12" fill="var(--danger)">
            ↪
          </text>
          {showIssue && (
            <foreignObject x="12" y="-12" width="220" height="90">
              <div className="part-issue-message">
                {issues.map((d) => (
                  <p key={d.id}>{d.title}</p>
                ))}
              </div>
            </foreignObject>
          )}
        </g>
      )}
      {r.failed && r.destination && (
        <circle
          cx={r.destination.x}
          cy={r.destination.y}
          r="5"
          fill="var(--canvas)"
          stroke="var(--warning)"
          strokeDasharray="2 2"
        />
      )}
      {r.failed && (
        <text
          x={r.points.at(-1)!.x + 6}
          y={r.points.at(-1)!.y - 7}
          fill="var(--warning)"
          fontSize="12"
        >
          Route blocked · move part
        </text>
      )}
    </g>
  );
}
const edgeTypes = { routed: RoutedEdge };
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
  const [dragNodes, setDragNodes] = useState<PartNode[] | null>(null);
  const [pan, setPan] = useState(false);
  const [needsFit, setNeedsFit] = useState(false);
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
  const displayed = dragNodes ?? nodes;
  const obstacles = displayed.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: Number(n.style?.width ?? 0),
    height: Number(n.style?.height ?? 0),
  }));
  const routes = routeWires(
    project.wires.flatMap((w) => {
      const terminal = (ep: typeof w.from) => {
        const n = displayed.find((n) => n.id === ep.componentId);
        if (!n) return null;
        const g = geometry(partById(n.data.component.partId), view, n.data.rotation);
        const p = g.pins[ep.terminalId];
        return p
          ? {
              componentId: ep.componentId,
              terminalId: ep.terminalId,
              x: n.position.x + p.x,
              y: n.position.y + p.y,
              side: p.side,
            }
          : null;
      };
      const from = terminal(w.from),
        to = terminal(w.to);
      return from && to ? [{ id: w.id, from, to }] : [];
    }),
    obstacles,
  );
  const fitRoutes = useCallback(
    () => void flow.fitBounds(routeBounds(routes, obstacles), { padding: 0.15, duration: 200 }),
    [flow, routes, obstacles],
  );
  useEffect(() => {
    if (needsFit) {
      const frame = requestAnimationFrame(() => {
        fitRoutes();
        setNeedsFit(false);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [needsFit, fitRoutes]);
  const edges: Edge[] = project.wires.map((w) => ({
    id: w.id,
    source: w.from.componentId,
    sourceHandle: w.from.terminalId,
    target: w.to.componentId,
    targetHandle: w.to.terminalId,
    type: 'routed',
    selected: ids.includes(w.id),
    zIndex: 2,
    data: { route: routes.find((r) => r.id === w.id), color: w.color },
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
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          onConnect={connect}
          onNodeClick={(_e, n) => select({ kind: 'component', id: n.id })}
          onEdgeClick={(_e, e) => select({ kind: 'wire', id: e.id })}
          onPaneClick={() => select(null)}
          onNodesChange={(changes) => {
            if (changes.some((c) => c.type === 'position'))
              setDragNodes((current) => applyNodeChanges<PartNode>(changes, current ?? nodes));
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
          onInit={() =>
            void flow.fitBounds(routeBounds(routes, obstacles), { padding: 0.15, duration: 0 })
          }
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
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border)" gap={20} size={1} />
          <Controls showInteractive={false} showFitView={false}>
            <ControlButton title="Fit view" aria-label="Fit view" onClick={fitRoutes}>
              <Scan size={14} />
            </ControlButton>
          </Controls>
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
        {library && (
          <PartLibrary
            onAdded={() => {
              setNeedsFit(true);
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
  const [category, setCategory] = useState('All');
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
          placeholder="Search parts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="parts-categories">
        {[
          'All',
          'Boards',
          'Prototyping',
          'Passive Components',
          'Indicators',
          'Sensors',
          'Actuators',
        ].map((c) => (
          <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="part-results">
        {searchParts(query)
          .filter((p) => !['kingbright-wp7113id', 'vishay-mrs25-330'].includes(p.id))
          .filter(
            (p) =>
              category === 'All' ||
              (p.category ??
                (p.kind === 'board'
                  ? 'Boards'
                  : p.kind === 'led'
                    ? 'Indicators'
                    : 'Passive Components')) === category,
          )
          .map((p) => (
            <button
              key={p.id}
              className="part-result"
              onClick={() => {
                const id = uid('part'),
                  n = project.components.length + 1;
                const refPrefix =
                  p.kind === 'board'
                    ? 'U'
                    : p.kind === 'led'
                      ? 'D'
                      : p.kind === 'resistor'
                        ? 'R'
                        : p.kind === 'breadboard'
                          ? 'BB'
                          : 'P';
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
                <strong>
                  {p.name}{' '}
                  {p.verifiedMapping && (
                    <span title="Documented terminal mapping; execution and electrical coverage vary">
                      <CheckCircle2
                        className="verified-part"
                        size={12}
                        tabIndex={0}
                        aria-label="Documented terminal mapping; execution and electrical coverage vary"
                      />
                    </span>
                  )}
                </strong>
              </div>
              <Plus size={14} />
            </button>
          ))}
      </div>
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
          {project.components.find((c) => c.id === w.from.componentId)?.ref}.{w.from.terminalId}
          <br />↳ {project.components.find((c) => c.id === w.to.componentId)?.ref}.{w.to.terminalId}
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
      {!pin && <strong>{part.name}</strong>}
      {pin ? (
        <div className="pin-facts terminal-popover">
          {pin.function && (
            <>
              <span>Function</span>
              <span>{pin.function}</span>
            </>
          )}
          <span>Type</span>
          <span>{pin.kind === 'gpio' ? 'Digital I/O' : pin.kind}</span>
          {pin.gpio && (
            <>
              <span>GPIO</span>
              <span className="mono">{pin.gpio}</span>
            </>
          )}
          {pin.voltage !== undefined && (
            <>
              <span>{pin.kind === 'power' ? 'Supply' : 'Logic'}</span>
              <span>{pin.voltage} V</span>
            </>
          )}
          {pin.requirements && (
            <>
              <span>Requirements</span>
              <span>{pin.requirements}</span>
            </>
          )}
        </div>
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
          <ComponentProperties component={component} part={part} />
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
        <details>
          <summary>Advanced</summary>
          <BindingEditor key={`${component.id}:${pin.id}`} component={component} pin={pin} />
        </details>
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
      {!pin && (
        <details>
          <summary>Part details</summary>
          <small>
            {part.manufacturer} · {part.mpn}
          </small>
          <p>{part.coverage ?? part.description}</p>
        </details>
      )}
    </aside>
  );
}
/** Explicit units only; accepts 330, 330 ohm, 4.7kΩ, 1M. */
function parseResistance(value: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*(?:Ω|ohms?)?\s*$/.exec(value);
  if (!m) return null;
  const n =
    Number(m[1]) *
    (m[2].toLowerCase() === 'k' ? 1000 : m[2] === 'M' ? 1000000 : m[2] === 'm' ? 0.001 : 1);
  return n > 0 && n <= 1e12 ? n : null;
}
function ComponentProperties({ component: c, part }: { component: Component; part: Part }) {
  const apply = useWorkspace((s) => s.apply),
    [error, setError] = useState('');
  if (['vishay-mrs25-330', 'kingbright-wp7113id'].includes(part.id))
    return (
      <small>
        Exact package values retained. Use a generic LED or resistor for editable assumptions.
      </small>
    );
  if (part.kind === 'resistor' || part.kind === 'potentiometer') {
    const field = part.kind === 'resistor' ? 'resistanceOhms' : 'potentiometerOhms';
    return (
      <label className="field compact-property">
        Resistance
        <input
          key={`${c.id}-${c.config[field]}`}
          aria-label="Resistance"
          defaultValue={`${c.config[field] ?? part.resistance ?? (part.kind === 'resistor' ? 330 : 10000)} Ω`}
          onBlur={(e) => {
            const v = parseResistance(e.target.value);
            if (v === null || (part.kind === 'potentiometer' && v > 1e9)) {
              setError('Enter a positive value in Ω, kΩ or MΩ.');
              return;
            }
            setError('');
            if (v !== c.config[field])
              apply('Change resistance', [
                { type: 'configureComponent', id: c.id, config: { [field]: v } },
              ]);
          }}
        />
        {error && <small role="alert">{error}</small>}
      </label>
    );
  }
  if (part.kind === 'led')
    return (
      <>
        <label className="field compact-property">
          Color
          <select
            aria-label="LED color"
            value={c.config.ledColor ?? 'red'}
            onChange={(e) =>
              apply('Change LED color', [
                {
                  type: 'configureComponent',
                  id: c.id,
                  config: {
                    ledColor: e.target.value as 'red' | 'green' | 'blue' | 'yellow' | 'white',
                  },
                },
              ])
            }
          >
            {['red', 'green', 'blue', 'yellow', 'white'].map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>Analysis assumptions</summary>
          <small>Color does not specify forward voltage.</small>
          {(['forwardVoltageV', 'maxCurrentMa'] as const).map((field) => (
            <label className="field" key={field}>
              {field === 'forwardVoltageV' ? 'Forward voltage (V)' : 'Current limit (mA)'}
              <input
                type="number"
                min="0.01"
                step="0.1"
                defaultValue={
                  c.config[field] ??
                  (field === 'forwardVoltageV' ? (part.forwardV ?? 1.9) : (part.maxCurrentMa ?? 10))
                }
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v <= (field === 'forwardVoltageV' ? 20 : 1000))
                    apply('Change LED assumption', [
                      { type: 'configureComponent', id: c.id, config: { [field]: v } },
                    ]);
                }}
              />
            </label>
          ))}
        </details>
      </>
    );
  return null;
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
