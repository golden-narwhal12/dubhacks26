import { describe, expect, it } from 'vitest';
import { additionalParts } from '../src/parts/additional';
import { Id, TerminalId } from '../src/domain/schema';

const part = (id: string) => {
  const result = additionalParts.find((p) => p.id === id);
  if (!result) throw new Error(`Missing additional package ${id}`);
  return result;
};
const pinNumbers = (id: string) =>
  Object.fromEntries(part(id).terminals.map((terminal) => [terminal.id, terminal.physicalPin]));

describe('additional part packages', () => {
  it('has unique package/terminal identities and complete evidence references', () => {
    expect(additionalParts).toHaveLength(24);
    expect(new Set(additionalParts.map((p) => p.id)).size).toBe(additionalParts.length);
    for (const p of additionalParts) {
      expect(Id.safeParse(p.id).success, p.id).toBe(true);
      expect(p.version).toBe(1);
      expect(p.simulation).toBe('none');
      expect(p.terminals.length).toBeGreaterThan(1);
      expect(new Set(p.terminals.map((t) => t.id)).size, p.id).toBe(p.terminals.length);
      expect(p.evidence.length, p.id).toBeGreaterThan(0);
      for (const t of p.terminals) {
        expect(TerminalId.safeParse(t.id).success, `${p.id}:${t.id}`).toBe(true);
        expect(t.evidenceIds.length, `${p.id}:${t.id}`).toBeGreaterThan(0);
        for (const evidenceId of t.evidenceIds)
          expect(
            p.evidence.some((e) => e.id === evidenceId),
            `${p.id}:${evidenceId}`,
          ).toBe(true);
      }
      for (const group of p.internalGroups)
        for (const id of group) expect(p.terminals.some((t) => t.id === id)).toBe(true);
    }
  });

  it('does not turn generic assumptions into verified hardware ratings or pin numbers', () => {
    for (const p of additionalParts.filter((p) => p.manufacturer === 'Generic')) {
      expect(p.verifiedMapping, p.id).toBe(false);
      expect(p.constraints, p.id).toBe(false);
      expect(
        p.terminals.every((t) => t.physicalPin === undefined),
        p.id,
      ).toBe(true);
      expect(
        p.evidence.every((e) => e.status === 'provisional'),
        p.id,
      ).toBe(true);
      expect(p.firmware, p.id).toBeUndefined();
      expect(p.maxCurrentMa, p.id).toBeUndefined();
      expect(p.internalGroups, p.id).toEqual([]);
    }
  });

  it('provides isolated source terminals without inventing a fixed current capacity', () => {
    const supply = part('external-dc-supply');
    expect(supply.kind).toBe('supply');
    expect(supply.terminals.map((t) => t.id)).toEqual(['positive', 'negative']);
    expect(supply.terminals[0].voltage).toBeUndefined();
    expect(supply.terminals[1].kind).toBe('ground');
    expect(supply.coverage).toContain('not measurements');
    expect(supply.internalGroups).toEqual([]);
  });

  it('maps the Adafruit reference board without shorting translated channels or pull-ups', () => {
    const shifter = part('adafruit-757');
    expect(shifter.verifiedMapping).toBe(true);
    expect(shifter.terminals).toHaveLength(12);
    expect(shifter.internalGroups).toEqual([['gnd', 'gnd2']]);
    for (let channel = 1; channel <= 4; channel++) {
      const low = shifter.terminals.find((t) => t.id === `lv${channel}`)!;
      const high = shifter.terminals.find((t) => t.id === `hv${channel}`)!;
      expect(low.label).toBe(`A${channel}`);
      expect(high.label).toBe(`B${channel}`);
      expect(low.header).toBe('JP3');
      expect(high.header).toBe('JP4');
      expect(low.physicalPin).toBe(6 - channel);
      expect(high.physicalPin).toBe(6 - channel);
      expect(low.requirements).toContain('10 kΩ');
      expect(high.requirements).toContain('10 kΩ');
      expect(low.capabilities).toContain('i2c');
      expect(shifter.internalGroups.some((g) => g.includes(low.id) || g.includes(high.id))).toBe(
        false,
      );
    }
    expect(shifter.terminals.find((t) => t.id === 'hv')?.voltage).toBeUndefined();
    expect(shifter.terminals.find((t) => t.id === 'lv')?.voltage).toBeUndefined();
  });

  it('distinguishes common-looking TO-92 temperature sensor pinouts and supply requirements', () => {
    expect(pinNumbers('tmp36-to92')).toEqual({ vs: 1, out: 2, gnd: 3 });
    expect(pinNumbers('lm35dz-to92')).toEqual({ vs: 1, out: 2, gnd: 3 });
    expect(pinNumbers('ds18b20-to92')).toEqual({ gnd: 1, dq: 2, vdd: 3 });
    expect(part('lm35dz-to92').terminals[0].requirements).toContain('4–30 V');
    expect(part('tmp36-to92').terminals[0].requirements).toContain('2.7–5.5 V');
    expect(part('ds18b20-to92').terminals.find((t) => t.id === 'dq')?.requirements).toContain(
      'pull-up',
    );
  });

  it('retains ADS1115 package pin mapping and does not confuse full-scale range with allowable input', () => {
    expect(pinNumbers('ads1115-vssop10')).toEqual({
      addr: 1,
      alert: 2,
      gnd: 3,
      ain0: 4,
      ain1: 5,
      ain2: 6,
      ain3: 7,
      vdd: 8,
      sda: 9,
      scl: 10,
    });
    expect(part('ads1115-vssop10').terminals.find((t) => t.id === 'ain0')?.requirements).toContain(
      'does not permit overvoltage',
    );
  });

  it('maps latched outputs, enable, reset and clocks independently on the DIP shift register', () => {
    expect(pinNumbers('sn74hc595n')).toEqual({
      qb: 1,
      qc: 2,
      qd: 3,
      qe: 4,
      qf: 5,
      qg: 6,
      qh: 7,
      gnd: 8,
      'qh-serial': 9,
      srclr: 10,
      srclk: 11,
      rclk: 12,
      oe: 13,
      ser: 14,
      qa: 15,
      vcc: 16,
    });
    expect(part('sn74hc595n').internalGroups).toEqual([]);
  });

  it('keeps ULN2003 clamp common separate from common emitter and reverses collector numbering', () => {
    const pins = pinNumbers('uln2003an');
    for (let channel = 1; channel <= 7; channel++) {
      expect(pins[`in${channel}`]).toBe(channel);
      expect(pins[`out${channel}`]).toBe(17 - channel);
    }
    expect(pins.e).toBe(8);
    expect(pins.com).toBe(9);
    expect(part('uln2003an').internalGroups).toEqual([]);
    expect(part('uln2003an').terminals.find((t) => t.id === 'com')?.kind).toBe('passive');
  });

  it('does not permanently connect stateful switch/relay/multiplexer contacts', () => {
    for (const id of ['pushbutton-no', 'switch-spdt', 'relay-spdt-generic', 'tca9548apwr'])
      expect(part(id).internalGroups, id).toEqual([]);
    const pins = pinNumbers('tca9548apwr');
    expect(pins).toMatchObject({
      a0: 1,
      a1: 2,
      reset: 3,
      gnd: 12,
      a2: 21,
      scl: 22,
      sda: 23,
      vcc: 24,
    });
    for (let channel = 0; channel < 8; channel++) {
      const offset = channel < 4 ? 4 + channel * 2 : 13 + (channel - 4) * 2;
      expect(pins[`sd${channel}`]).toBe(offset);
      expect(pins[`sc${channel}`]).toBe(offset + 1);
    }
  });

  it('distinguishes the bipolar NE555 operating range and pin mapping', () => {
    expect(pinNumbers('ne555p')).toEqual({
      gnd: 1,
      trig: 2,
      out: 3,
      reset: 4,
      cont: 5,
      thres: 6,
      disch: 7,
      vcc: 8,
    });
    expect(part('ne555p').terminals.find((t) => t.id === 'vcc')?.requirements).toContain(
      '4.5–16 V',
    );
    expect(part('ne555p').coverage).toContain('no analog oscillation');
  });
});
