import type { Part, Terminal, Evidence } from '../domain/schema';
const assets = { renderer: 'generic', geometry: 'illustrative' } as const;
const pin = (
  id: string,
  label: string,
  kind: Terminal['kind'] = 'passive',
  requirements?: string,
): Terminal => ({
  id,
  label,
  kind,
  capabilities: [],
  evidenceIds: [],
  ...(requirements ? { requirements } : {}),
});
const assumed = (fact: string): Evidence => ({
  id: 'assumptions',
  title: 'Editable analysis assumptions',
  url: 'https://docs.arduino.cc/learn/electronics/ohms-law/',
  revision: 'Trace model 1',
  location: 'Instance properties; not a manufacturer rating',
  fact,
  status: 'provisional',
});
const base = {
  version: 1,
  manufacturer: 'Generic',
  mpn: 'Unspecified',
  revision: 'Trace model 1',
  internalGroups: [] as string[][],
  simulation: 'none',
  assets,
  verifiedMapping: false,
  constraints: false,
} as const;
const holes: Terminal[] = [];
const groups: string[][] = [];
for (let row = 1; row <= 63; row++) {
  for (const letters of ['abcde', 'fghij']) {
    const group = [];
    for (const letter of letters) {
      const id = `${letter}${row}`;
      holes.push(pin(id, id.toUpperCase()));
      group.push(id);
    }
    groups.push(group);
  }
}
for (const rail of ['lp', 'ln', 'rp', 'rn']) {
  const group = [];
  for (let i = 1; i <= 50; i++) {
    const id = `${rail}${i}`;
    holes.push(pin(id, `${rail.toUpperCase()}${i}`));
    group.push(id);
  }
  groups.push(group);
}
export const expandedParts: Part[] = [
  {
    ...base,
    id: 'generic-resistor',
    name: 'Resistor',
    kind: 'resistor',
    category: 'Passive Components',
    description: 'Editable resistance · unpolarized',
    terminals: [pin('p1', '1'), pin('p2', '2')],
    resistance: 330,
    evidence: [
      assumed(
        'Default resistance 330 Ω. Edit the value after placement. Power/tolerance are unknown; no exact manufacturer rating is implied.',
      ),
    ],
  },
  {
    ...base,
    id: 'generic-led',
    name: 'LED',
    kind: 'led',
    category: 'Indicators',
    description: 'Red by default · editable analysis assumptions',
    terminals: [
      pin('a', 'Anode', 'anode', 'Use a current-limiting resistor.'),
      pin('k', 'Cathode', 'cathode'),
    ],
    forwardV: 1.9,
    maxCurrentMa: 10,
    evidence: [
      assumed(
        'Default nominal forward-voltage assumption 1.9 V and analysis current threshold 10 mA. These are editable assumptions, not guaranteed specifications. Changing color does not establish forward voltage or a rating.',
      ),
    ],
  },
  {
    ...base,
    id: 'potentiometer-generic',
    name: 'Potentiometer',
    kind: 'potentiometer',
    category: 'Passive Components',
    description: 'Two ends and a wiper · 10 kΩ assumed',
    terminals: [pin('p1', 'End 1'), pin('wiper', 'Wiper'), pin('p2', 'End 2')],
    resistance: 10000,
    evidence: [
      assumed(
        '10 kΩ end-to-end default assumption; wiper position, taper, power and exact package pin order are unknown. Terminal identity is logical, not a manufacturer pin number.',
      ),
    ],
  },
  {
    ...base,
    id: 'breadboard-830',
    name: 'BB830 breadboard',
    manufacturer: 'BusBoard Prototype Systems',
    mpn: 'BB830',
    revision: 'Rev 7',
    kind: 'breadboard',
    category: 'Prototyping',
    description: '830 holes · continuous rails',
    terminals: holes,
    internalGroups: groups,
    verifiedMapping: true,
    coverage:
      'BB830 model: A–E and F–J isolated five-hole groups per row; four separate continuous 50-hole rails. No rail midpoint split. Wires create explicit hole connections; visual placement does not insert leads. Other breadboards may differ.',
    evidence: [
      {
        id: 'bb830-groups',
        title: 'BusBoard BB830 datasheet',
        url: 'https://www.busboard.com/documents/datasheets/BPS-DAT-(BB830)-Datasheet.pdf',
        revision: 'Rev 7',
        location: 'pp. 1–2; BusBoard FAQ rail continuity',
        fact: '630 tie points in five-hole groups across an isolated center channel, plus four separate 50-point distribution rails. BB830 rails are continuous, not split at the midpoint.',
        status: 'verified',
      },
      {
        id: 'bb830-rails',
        title: 'BusBoard FAQ',
        url: 'https://busboard.com/faq',
        revision: 'Accessed 17 Oct 2026',
        location: 'Does BB830 have split power rails?',
        fact: 'BB830 power rails run the entire length; visually similar breadboards can have different connections.',
        status: 'verified',
      },
    ],
  },
  {
    ...base,
    id: 'as5600-module-photo',
    name: 'AS5600 module',
    manufacturer: 'Unconfirmed module supplier',
    mpn: 'AS5600 / t026510 photo',
    kind: 'encoder',
    category: 'Sensors',
    description: 'Photo-matched 7-terminal breakout · 3.3 V listing',
    terminals: [
      {
        ...pin('vcc', 'VCC', 'power', '3.3 V listing; regulator topology unconfirmed.'),
        voltage: 3.3,
      },
      pin(
        'out',
        'OUT',
        'control',
        'Analog/PWM function depends on chip configuration; not automatic telemetry.',
      ),
      pin('gnd', 'GND', 'ground'),
      pin('dir', 'DIR', 'control', 'Direction configuration input; board bias unknown.'),
      pin('scl', 'SCL', 'control', 'I²C clock; pull-up presence and rail unconfirmed.'),
      pin('sda', 'SDA', 'control', 'I²C data; pull-up presence and rail unconfirmed.'),
      pin('gpo', 'GPO', 'control', 'Printed GPO; chip connection not independently verified.'),
    ],
    coverage:
      'Header labels match the supplied white t026510 module photo. Chip-to-header continuity, pull-ups and supply circuitry remain provisional. No assumed 5 V tolerance or mechanical calibration.',
    evidence: [
      {
        id: 'as-photo',
        title: 'User-supplied module photo',
        url: 'https://look.ams-osram.com/m/7059eac7531a86fd/original/AS5600-DS000365.pdf',
        revision: 'Photo supplied 17 Oct 2026; chip document DS000365',
        location:
          'Photo: left VCC/OUT/GND; right DIR/SCL/SDA/GPO. Chip datasheet describes functions, not this module routing.',
        fact: 'User photo establishes seven printed header labels. Product listing says 3.3 V. Manufacturer schematic and continuity are unavailable; board mapping is provisional. AS5600 chip supports 12-bit angle data and configurable OUT; nothing is reported unless firmware sends it.',
        status: 'provisional',
      },
    ],
  },
  {
    ...base,
    id: 'sg90-generic',
    name: 'SG90 servo',
    manufacturer: 'Unconfirmed SG90 supplier',
    mpn: 'SG90 positional, supplier unconfirmed',
    kind: 'servo',
    category: 'Actuators',
    description: 'Power, ground, control · no feedback',
    terminals: [
      pin(
        'power',
        'Supply',
        'power',
        'Check the actual servo supply specification; current demand unknown.',
      ),
      pin('gnd', 'GND', 'ground'),
      pin(
        'signal',
        'Control',
        'control',
        'Positional servo control pulses; actual timing/range must be confirmed.',
      ),
    ],
    coverage:
      'Generic SG90-style positional servo. Connector order, supply/current ratings and pulse limits require confirmation on the actual unit. A commanded angle is not measured position; no feedback terminal is modeled.',
    evidence: [
      {
        id: 'sg90-reference',
        title: 'TowerPro SG90 Analog reference',
        url: 'https://towerpro.com.tw/product/sg90-analog/',
        revision: 'Accessed 17 Oct 2026',
        location: 'Manufacturer product specifications and counterfeit notice',
        fact: 'TowerPro documents its own SG90 product and cautions about counterfeits. This generic inventory item is not confirmed to be TowerPro hardware; manufacturer ratings are not assigned to it.',
        status: 'provisional',
      },
    ],
  },
  {
    ...base,
    id: 'itr9608-dip4',
    name: 'ITR9608 DIP-4',
    manufacturer: 'HiLetgo listing; die manufacturer unconfirmed',
    mpn: 'ITR9608 / ITR9608-F listing',
    kind: 'photointerruptor',
    category: 'Sensors',
    description: 'IR emitter + phototransistor · four separate leads',
    terminals: [
      {
        ...pin('a', 'Anode', 'anode', 'IR emitter requires a current-limiting resistor.'),
        physicalPin: 1,
      },
      { ...pin('k', 'Cathode', 'cathode'), physicalPin: 2 },
      {
        ...pin(
          'c',
          'Collector',
          'passive',
          'Phototransistor collector; external load/pull-up required for a voltage signal.',
        ),
        physicalPin: 3,
      },
      {
        ...pin('e', 'Emitter', 'passive', 'Phototransistor emitter; reference depends on circuit.'),
        physicalPin: 4,
      },
    ],
    coverage:
      'Bare four-lead optical interrupter, not a digital comparator module. Pin-role model follows Everlight package drawings; verify the actual HiLetgo-supplied part orientation. -F and non-F ratings are not interchangeable. No invented digital output or emitter/detector internal electrical short.',
    evidence: [
      {
        id: 'itr-pinout',
        title: 'Everlight ITR9608-F datasheet',
        url: 'https://everlightamericas.com/datasheets/ITR9608-F.pdf',
        revision: 'DRX-0000076 Rev 7 · 20 Jul 2019',
        location: 'p. 6 package drawing / pin legend; p. 1 construction',
        fact: 'Reference package pin roles: 1 anode, 2 cathode, 3 collector, 4 emitter. Emitter and phototransistor are optically coupled, electrically separate. Supplier authenticity and suffix are unconfirmed, so absolute current/voltage ratings are not assigned.',
        status: 'provisional',
      },
    ],
  },
];
