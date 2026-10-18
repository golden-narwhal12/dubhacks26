/** View-only orthogonal routing. No point or crossing establishes connectivity. */
export interface Point {
  x: number;
  y: number;
}
export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RouteTerminal extends Point {
  componentId: string;
  terminalId?: string;
  side: 'top' | 'right' | 'bottom' | 'left';
}
export interface RouteInput {
  id: string;
  from: RouteTerminal;
  to: RouteTerminal;
}
export interface WireRoute {
  id: string;
  points: Point[];
  failed: boolean;
  destination?: Point;
  junctions?: Point[];
}
const EPS = 0.01;
const equal = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
export function segmentHitsBody(a: Point, b: Point, r: Obstacle): boolean {
  if (Math.abs(a.x - b.x) < EPS)
    return (
      a.x > r.x + EPS &&
      a.x < r.x + r.width - EPS &&
      Math.max(a.y, b.y) > r.y + EPS &&
      Math.min(a.y, b.y) < r.y + r.height - EPS
    );
  if (Math.abs(a.y - b.y) < EPS)
    return (
      a.y > r.y + EPS &&
      a.y < r.y + r.height - EPS &&
      Math.max(a.x, b.x) > r.x + EPS &&
      Math.min(a.x, b.x) < r.x + r.width - EPS
    );
  return true;
}
export function overlaps(a: Point, b: Point, c: Point, d: Point): boolean {
  return (
    (Math.abs(a.x - b.x) < EPS &&
      Math.abs(c.x - d.x) < EPS &&
      Math.abs(a.x - c.x) < EPS &&
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
        EPS) ||
    (Math.abs(a.y - b.y) < EPS &&
      Math.abs(c.y - d.y) < EPS &&
      Math.abs(a.y - c.y) < EPS &&
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
        EPS)
  );
}
function simplify(points: Point[]) {
  return points.filter(
    (p, i) =>
      !i ||
      i === points.length - 1 ||
      !(
        (points[i - 1].x === p.x && p.x === points[i + 1].x) ||
        (points[i - 1].y === p.y && p.y === points[i + 1].y)
      ),
  );
}
function lead(t: RouteTerminal, obstacles: Obstacle[], lane: number): Point {
  const own = obstacles.find((r) => r.id === t.componentId),
    n = 16 + lane * 7;
  const end =
    t.side === 'left'
      ? { x: Math.min(t.x, own?.x ?? t.x) - n, y: t.y }
      : t.side === 'right'
        ? { x: Math.max(t.x, own ? own.x + own.width : t.x) + n, y: t.y }
        : t.side === 'top'
          ? { x: t.x, y: Math.min(t.y, own?.y ?? t.y) - n }
          : { x: t.x, y: Math.max(t.y, own ? own.y + own.height : t.y) + n };
  // A nearby name tag can cap a long lead-out. Turn before it instead of drawing
  // through text or declaring an otherwise routable terminal blocked.
  for (const r of obstacles) {
    if (r.id === t.componentId || !segmentHitsBody(t, end, r)) continue;
    if (t.side === 'top' && r.y + r.height < t.y) end.y = Math.max(end.y, r.y + r.height + 8);
    if (t.side === 'bottom' && r.y > t.y) end.y = Math.min(end.y, r.y - 8);
    if (t.side === 'left' && r.x + r.width < t.x) end.x = Math.max(end.x, r.x + r.width + 8);
    if (t.side === 'right' && r.x > t.x) end.x = Math.min(end.x, r.x - 8);
  }
  return end;
}
class MinQueue<T extends { f: number }> {
  items: T[] = [];
  get length() {
    return this.items.length;
  }
  push(v: T) {
    const a = this.items;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= v.f) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = v;
  }
  pop(): T | undefined {
    const a = this.items;
    if (!a.length) return;
    const first = a[0],
      last = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
}
/** Deterministic sequential visibility grid. Occupied collinear lanes are forbidden; perpendicular crossings remain separate. */
export function routeWires(inputs: RouteInput[], obstacles: Obstacle[]): WireRoute[] {
  type Corridor = { key: string; a: Point; b: Point };
  const used: { a: Point; b: Point; corridors: Corridor[] }[] = [];
  const key = (t: RouteTerminal) => `${t.componentId}:${t.terminalId ?? `${t.x}:${t.y}`}`;
  const escapes = new Map<string, Point>(),
    counts = new Map<string, number>();
  // A physical terminal gets one stable escape corridor regardless of wire order or direction.
  inputs.forEach((input, index) =>
    [input.from, input.to].forEach((t, end) => {
      const k = key(t);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!escapes.has(k)) escapes.set(k, lead(t, obstacles, (index + (end ? 3 : 0)) % 11));
    }),
  );
  const onSegment = (p: Point, a: Point, b: Point) =>
    Math.abs(a.x - b.x) < EPS
      ? Math.abs(p.x - a.x) < EPS &&
        p.y >= Math.min(a.y, b.y) - EPS &&
        p.y <= Math.max(a.y, b.y) + EPS
      : Math.abs(p.y - a.y) < EPS &&
        p.x >= Math.min(a.x, b.x) - EPS &&
        p.x <= Math.max(a.x, b.x) + EPS;
  const result: WireRoute[] = [];
  for (const input of inputs) {
    const a = escapes.get(key(input.from))!,
      b = escapes.get(key(input.to))!;
    const corridors: Corridor[] = [
      { key: key(input.from), a: input.from, b: a },
      { key: key(input.to), a: input.to, b },
    ];
    const occupied = (p: Point, q: Point) =>
      used.some((s) => {
        if (!overlaps(p, q, s.a, s.b)) return false;
        const vertical = Math.abs(p.x - q.x) < EPS;
        const lo = Math.max(
          Math.min(vertical ? p.y : p.x, vertical ? q.y : q.x),
          Math.min(vertical ? s.a.y : s.a.x, vertical ? s.b.y : s.b.x),
        );
        const hi = Math.min(
          Math.max(vertical ? p.y : p.x, vertical ? q.y : q.x),
          Math.max(vertical ? s.a.y : s.a.x, vertical ? s.b.y : s.b.x),
        );
        const first = vertical ? { x: p.x, y: lo } : { x: lo, y: p.y },
          last = vertical ? { x: p.x, y: hi } : { x: hi, y: p.y };
        // Only the mandatory lead-out at the identical terminal may be shared. No remote overlap exception.
        return !corridors.some(
          (c) =>
            s.corridors.some((d) => d.key === c.key) &&
            onSegment(first, c.a, c.b) &&
            onSegment(last, c.a, c.b),
        );
      });
    const blocked = (p: Point, q: Point) =>
      obstacles.some((r) => segmentHitsBody(p, q, r)) || occupied(p, q);
    const xs = new Set<number>([a.x, b.x]),
      ys = new Set<number>([a.y, b.y]);
    for (const r of obstacles)
      for (const margin of [12, 24, 40]) {
        xs.add(r.x - margin);
        xs.add(r.x + r.width + margin);
        ys.add(r.y - margin);
        ys.add(r.y + r.height + margin);
      }
    for (const s of used)
      for (const p of [s.a, s.b]) {
        xs.add(p.x - 8);
        xs.add(p.x + 8);
        ys.add(p.y - 8);
        ys.add(p.y + 8);
      }
    const xx = [...xs].sort((a, b) => a - b),
      yy = [...ys].sort((a, b) => a - b);
    // Large projects remain editable; failure is explicit rather than an unbounded search.
    let path: Point[] | undefined;
    if (xx.length * yy.length < 90000) {
      const start = `${xx.indexOf(a.x)},${yy.indexOf(a.y)},0`,
        costs = new Map([[start, 0]]),
        prev = new Map<string, string>();
      const queue = new MinQueue<{ k: string; g: number; f: number }>();
      queue.push({ k: start, g: 0, f: 0 });
      let found: string | undefined,
        visits = 0;
      while (queue.length && visits++ < 65000) {
        const current = queue.pop()!;
        if (current.g !== costs.get(current.k)) continue;
        const [x, y, dir] = current.k.split(',').map(Number),
          p = { x: xx[x], y: yy[y] };
        if (equal(p, b)) {
          found = current.k;
          break;
        }
        for (const [dx, dy, nd] of [
          [1, 0, 1],
          [-1, 0, 1],
          [0, 1, 2],
          [0, -1, 2],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= xx.length || ny >= yy.length) continue;
          const q = { x: xx[nx], y: yy[ny] };
          if (blocked(p, q)) continue;
          const nk = `${nx},${ny},${nd}`,
            ng =
              current.g + Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + (dir && dir !== nd ? 18 : 0);
          if (ng < (costs.get(nk) ?? Infinity)) {
            costs.set(nk, ng);
            prev.set(nk, current.k);
            queue.push({ k: nk, g: ng, f: ng + Math.abs(q.x - b.x) + Math.abs(q.y - b.y) });
          }
        }
      }
      if (found) {
        path = [];
        let k: string | undefined = found;
        while (k) {
          const [x, y] = k.split(',').map(Number);
          path.unshift({ x: xx[x], y: yy[y] });
          k = prev.get(k);
        }
      }
    }
    const leadsClear =
      !obstacles.some(
        (r) =>
          (r.id !== input.from.componentId && segmentHitsBody(input.from, a, r)) ||
          (r.id !== input.to.componentId && segmentHitsBody(b, input.to, r)),
      ) &&
      !occupied(input.from, a) &&
      !occupied(b, input.to);
    const points = path && leadsClear ? simplify([input.from, ...path, input.to]) : [input.from];
    const route = {
      id: input.id,
      points,
      failed: !path || !leadsClear,
      destination: input.to,
      junctions: [input.from, input.to].filter((t) => (counts.get(key(t)) ?? 0) > 1),
    };
    result.push(route);
    if (!route.failed)
      for (let i = 1; i < points.length; i++)
        used.push({ a: points[i - 1], b: points[i], corridors });
  }
  return result;
}
export function routePath(points: Point[]) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
}
export function routeBounds(routes: WireRoute[], obstacles: Obstacle[]) {
  const p = [
    ...routes.flatMap((r) => r.points),
    ...obstacles.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
    ]),
  ];
  if (!p.length) return { x: 0, y: 0, width: 100, height: 100 };
  const x = Math.min(...p.map((p) => p.x)),
    y = Math.min(...p.map((p) => p.y));
  return {
    x: x - 18,
    y: y - 26,
    width: Math.max(...p.map((p) => p.x)) - x + 36,
    height: Math.max(...p.map((p) => p.y)) - y + 44,
  };
}
