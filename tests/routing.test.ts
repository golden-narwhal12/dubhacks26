import { describe, it, expect } from 'vitest';
import {
  routeWires,
  routeBounds,
  segmentHitsBody,
  overlaps,
  type RouteInput,
  type Obstacle,
  type WireRoute,
} from '../src/ui/routing';
const body: Obstacle[] = [
  { id: 'a', x: 0, y: 0, width: 100, height: 100 },
  { id: 'b', x: 300, y: 0, width: 100, height: 100 },
];
const input: RouteInput = {
  id: 'w1',
  from: { componentId: 'a', x: 100, y: 40, side: 'right' },
  to: { componentId: 'b', x: 300, y: 40, side: 'left' },
};
function segments(r: WireRoute) {
  return r.points.slice(1).map((b, i) => ({ a: r.points[i], b }));
}
describe('view-only obstacle routing', () => {
  it('routes around intervening component bodies and preserves endpoint coordinates', () => {
    const obstacles = [...body, { id: 'obstacle', x: 170, y: 0, width: 60, height: 100 }];
    const [r] = routeWires([input], obstacles);
    expect(r.failed).toBe(false);
    expect(r.points[0]).toMatchObject(input.from);
    expect(r.points.at(-1)).toMatchObject(input.to);
    expect(segments(r).some((s) => obstacles.some((o) => segmentHitsBody(s.a, s.b, o)))).toBe(
      false,
    );
  });
  it('separates unrelated paths instead of sharing visible collinear segments', () => {
    const inputs = [
      input,
      { id: 'w2', from: { ...input.from, y: 60 }, to: { ...input.to, y: 60 } },
      { id: 'w3', from: { ...input.from, y: 80 }, to: { ...input.to, y: 20 } },
    ];
    const routes = routeWires(inputs, body);
    expect(routes.every((r) => !r.failed)).toBe(true);
    for (let i = 0; i < routes.length; i++)
      for (let j = i + 1; j < routes.length; j++)
        expect(
          segments(routes[i]).some((s) =>
            segments(routes[j]).some((t) => overlaps(s.a, s.b, t.a, t.b)),
          ),
        ).toBe(false);
  });
  it('supports dense rotated header lead-outs and recomputes after movement', () => {
    const inputs: RouteInput[] = Array.from({ length: 8 }, (_, i) => ({
      id: `w${i}`,
      from: { componentId: 'a', x: 10 + i * 10, y: 0, side: 'top' },
      to: { componentId: 'b', x: 310 + i * 10, y: 100, side: 'bottom' },
    }));
    const r = routeWires(inputs, body);
    expect(r.every((p) => !p.failed)).toBe(true);
    const moved = routeWires(
      inputs.map((p) => ({ ...p, to: { ...p.to, x: p.to.x + 50 } })),
      body.map((o) => (o.id === 'b' ? { ...o, x: o.x + 50 } : o)),
    );
    expect(moved.every((p) => !p.failed)).toBe(true);
    expect(moved[0].points.at(-1)!.x).toBe(r[0].points.at(-1)!.x + 50);
  });
  it('reports blocked terminal escape honestly rather than hiding wires under a body', () => {
    const [r] = routeWires(
      [input],
      [...body, { id: 'blocked', x: 101, y: 10, width: 20, height: 80 }],
    );
    expect(r.failed).toBe(true);
  });
  it('perpendicular crossings remain separate and fit bounds include route excursions', () => {
    expect(overlaps({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 0 }, { x: 5, y: 10 })).toBe(false);
    const r = routeWires(
      [input],
      [...body, { id: 'obstacle', x: 150, y: -50, width: 100, height: 200 }],
    );
    const bounds = routeBounds(r, body);
    for (const p of r.flatMap((r) => r.points)) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.x);
      expect(p.x).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(p.y).toBeGreaterThanOrEqual(bounds.y);
      expect(p.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });
});
it('keeps the indicator example routes distinct around the Mega body', () => {
  const parts = [
    { id: 'board', x: 40, y: 80, width: 704, height: 310 },
    { id: 'resistor', x: 260, y: 530, width: 130, height: 54 },
    { id: 'led', x: 570, y: 480, width: 56, height: 100 },
  ];
  const wires: RouteInput[] = [
    {
      id: 'signal',
      from: { componentId: 'board', x: 170, y: 80, side: 'top' },
      to: { componentId: 'resistor', x: 260, y: 557, side: 'left' },
    },
    {
      id: 'feed',
      from: { componentId: 'resistor', x: 390, y: 557, side: 'right' },
      to: { componentId: 'led', x: 586, y: 580, side: 'bottom' },
    },
    {
      id: 'return',
      from: { componentId: 'led', x: 610, y: 580, side: 'bottom' },
      to: { componentId: 'board', x: 193, y: 390, side: 'bottom' },
    },
  ];
  const routes = routeWires(wires, parts);
  expect(routes.every((r) => !r.failed)).toBe(true);
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++)
      expect(
        segments(routes[i]).some((s) =>
          segments(routes[j]).some((t) => overlaps(s.a, s.b, t.a, t.b)),
        ),
      ).toBe(false);
});
it('branches from the same explicit terminal share only their mandatory lead-out', () => {
  const inputs: RouteInput[] = [
    { ...input, from: { ...input.from, terminalId: 'signal' } },
    {
      id: 'branch',
      from: { ...input.from, terminalId: 'signal' },
      to: { ...input.to, y: 80, terminalId: 'other' },
    },
  ];
  const routes = routeWires(inputs, body);
  expect(routes.every((r) => !r.failed)).toBe(true);
  expect(routes.every((r) => r.junctions?.some((p) => p.x === 100 && p.y === 40))).toBe(true);
  const shared = segments(routes[0]).flatMap((s) =>
    segments(routes[1])
      .filter((t) => overlaps(s.a, s.b, t.a, t.b))
      .map((t) => ({ s, t })),
  );
  expect(shared.length).toBeGreaterThan(0);
  for (const { s, t } of shared) {
    expect(s.a.y).toBe(40);
    expect(t.a.y).toBe(40);
    const high = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x));
    expect(high).toBeLessThanOrEqual(116);
  }
});
it('the same terminal can be a source or destination without losing its branch', () => {
  const routes = routeWires(
    [input, { id: 'reverse', from: { ...input.to, y: 80 }, to: input.from }],
    body,
  );
  expect(routes.every((r) => !r.failed)).toBe(true);
});
it('turns dense top-header leads before reserved name tags and includes tags in fit', () => {
  const obstacles: Obstacle[] = [
    { id: 'mega', x: 0, y: 0, width: 704, height: 310 },
    { id: 'mega:nametag', x: -4, y: -48, width: 248, height: 22 },
    { id: 'module', x: 820, y: -160, width: 180, height: 188 },
    { id: 'module:nametag', x: 816, y: -208, width: 220, height: 22 },
  ];
  const inputs: RouteInput[] = Array.from({ length: 6 }, (_, index) => ({
    id: `header-${index}`,
    from: { componentId: 'mega', terminalId: `d${index}`, x: 38 + index * 23, y: 0, side: 'top' },
    to: {
      componentId: 'module',
      terminalId: `ch${index}`,
      x: 820,
      y: -132 + index * 26,
      side: 'left',
    },
  }));
  const routes = routeWires(inputs, obstacles);
  expect(routes.every((route) => !route.failed)).toBe(true);
  for (const route of routes) {
    expect(
      segments(route).some(({ a, b }) => obstacles.some((body) => segmentHitsBody(a, b, body))),
    ).toBe(false);
    expect(route.points[0]).toMatchObject(inputs.find((input) => input.id === route.id)!.from);
    expect(route.points.at(-1)).toMatchObject(inputs.find((input) => input.id === route.id)!.to);
  }
  const fit = routeBounds(routes, obstacles);
  expect(fit.y).toBeLessThan(-208);
});
