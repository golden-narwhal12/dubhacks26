import type { Part, Terminal, Evidence } from '../domain/schema';

const megaEvidence: Evidence[] = [
  {
    id: 'mega-power',
    title: 'Mega 2560 Rev3 user manual',
    url: 'https://docs.arduino.cc/resources/datasheets/A000067-datasheet.pdf',
    revision: 'Modified 15 Oct 2026',
    location: 'p. 11 §5.1 · analog/power header',
    fact: 'IOREF is the digital logic reference connected to the 5 V rail. Auxiliary ICSP/ATmega16U2 headers are outside this package’s terminal coverage.',
    value: 5,
    units: 'V nominal logic reference',
    status: 'verified',
  },
  {
    id: 'mega-pinout',
    title: 'Arduino Mega 2560 Rev3 full pinout',
    url: 'https://docs.arduino.cc/resources/pinouts/A000067-full-pinout.pdf',
    revision: '16 Dec 2020',
    location: 'pp. 1–4 · header/port maps',
    fact: 'D13 = PB7, D12 = PB6; D22–D29 = PA0–PA7. Digital header aliases match the Rev3 board.',
    status: 'verified',
  },
  {
    id: 'mega-current',
    title: 'Mega pinout · I/O current limit',
    url: 'https://docs.arduino.cc/resources/pinouts/A000067-full-pinout.pdf',
    revision: '16 Dec 2020',
    location: 'p. 1 · current notes',
    fact: 'Board documentation specifies maximum 20 mA per I/O. This is a limit, not a normal operating target.',
    value: 20,
    units: 'mA maximum',
    status: 'verified',
  },
];
const megaPorts = [
  'PE0',
  'PE1',
  'PE4',
  'PE5',
  'PG5',
  'PE3',
  'PH3',
  'PH4',
  'PH5',
  'PH6',
  'PB4',
  'PB5',
  'PB6',
  'PB7',
  'PJ1',
  'PJ0',
  'PH1',
  'PH0',
  'PD3',
  'PD2',
  'PD1',
  'PD0',
  ...Array.from({ length: 8 }, (_, i) => `PA${i}`),
  ...Array.from({ length: 8 }, (_, i) => `PC${7 - i}`),
  'PD7',
  'PG2',
  'PG1',
  'PG0',
  ...Array.from({ length: 8 }, (_, i) => `PL${7 - i}`),
  'PB3',
  'PB2',
  'PB1',
  'PB0',
];
const megaPins: Terminal[] = megaPorts.map((port, i) => ({
  id: `d${i}`,
  label: `${i}`,
  kind: 'gpio',
  gpio: port,
  firmwareAlias: String(i),
  header: i < 22 ? 'DIGITAL' : 'DOUBLE-ROW',
  capabilities: [
    'digital',
    ...((i >= 2 && i <= 13) || (i >= 44 && i <= 46) ? ['pwm'] : []),
    ...([0, 1, 14, 15, 16, 17, 18, 19].includes(i) ? ['uart'] : []),
    ...([20, 21].includes(i) ? ['i2c'] : []),
    ...(i >= 50 ? ['spi'] : []),
  ],
  voltage: 5,
  evidenceIds: ['mega-pinout', 'mega-current'],
}));
megaPins.push(
  ...Array.from({ length: 16 }, (_, i): Terminal => ({
    id: `a${i}`,
    label: `A${i}`,
    kind: 'gpio',
    gpio: i < 8 ? `PF${i}` : `PK${i - 8}`,
    firmwareAlias: `A${i}`,
    header: 'ANALOG',
    capabilities: ['digital', 'adc'],
    voltage: 5,
    evidenceIds: ['mega-pinout'],
  })),
);
const terminal = (
  id: string,
  label: string,
  kind: Terminal['kind'],
  voltage?: number,
): Terminal => ({ id, label, kind, voltage, capabilities: [], evidenceIds: ['mega-pinout'] });
megaPins.push(
  terminal('5v', '5V', 'power', 5),
  terminal('3v3', '3V3', 'power', 3.3),
  terminal('vin', 'VIN', 'power'),
  terminal('gnd1', 'GND', 'ground', 0),
  terminal('gnd2', 'GND', 'ground', 0),
  terminal('gnd3', 'GND', 'ground', 0),
  terminal('gnd4', 'GND', 'ground', 0),
  terminal('gnd5', 'GND', 'ground', 0),
  terminal('5v2', '5V', 'power', 5),
  terminal('5v3', '5V', 'power', 5),
  terminal('reset', 'RESET', 'control'),
  terminal('ioref', 'IOREF', 'power', 5),
  terminal('aref', 'AREF', 'control'),
  terminal('nc', 'NC', 'nc'),
);
// Rev3's duplicate SDA/SCL terminals are explicit internal equivalences.
megaPins.push(
  {
    ...terminal('sda', 'SDA', 'gpio', 5),
    gpio: 'PD1',
    firmwareAlias: '20',
    capabilities: ['digital', 'i2c'],
  },
  {
    ...terminal('scl', 'SCL', 'gpio', 5),
    gpio: 'PD0',
    firmwareAlias: '21',
    capabilities: ['digital', 'i2c'],
  },
);

const espSource =
  'https://documentation.espressif.com/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html';
const espEvidence: Evidence[] = [
  {
    id: 'esp-header',
    title: 'Espressif ESP32-S3-DevKitC-1 v1.1 guide',
    url: espSource,
    revision: 'v1.1 · checked 17 Oct 2026',
    location: 'Header Block · J1/J3; module note',
    fact: '3.3 V GPIO; J1/J3 header mapping cross-checked against the official v1.1 tables. GPIO35–37 are unavailable with octal flash/PSRAM variants; exact module is unconfirmed.',
    status: 'verified',
  },
];
const left = [
  '3v3',
  '3v3b',
  'en',
  'io4',
  'io5',
  'io6',
  'io7',
  'io15',
  'io16',
  'io17',
  'io18',
  'io8',
  'io3',
  'io46',
  'io9',
  'io10',
  'io11',
  'io12',
  'io13',
  'io14',
  '5v',
  'gnd1',
];
const right = [
  'gnd2',
  'io43',
  'io44',
  'io1',
  'io2',
  'io42',
  'io41',
  'io40',
  'io39',
  'io38',
  'io37',
  'io36',
  'io35',
  'io0',
  'io45',
  'io48',
  'io47',
  'io21',
  'io20',
  'io19',
  'gnd3',
  'gnd4',
];
const espPins = [
  ...left.map((id, i) => ({ id, header: 'J1', physicalPin: i + 1 })),
  ...right.map((id, i) => ({ id, header: 'J3', physicalPin: i + 1 })),
].map(({ id, header, physicalPin }): Terminal => {
  const gpio = id.startsWith('io') ? id.slice(2) : undefined;
  return {
    id,
    label:
      gpio ??
      (id.startsWith('gnd') ? 'GND' : id.startsWith('3v3') ? '3V3' : id === '5v' ? '5V' : 'EN'),
    header,
    physicalPin,
    kind: gpio ? 'gpio' : id.startsWith('gnd') ? 'ground' : id === 'en' ? 'control' : 'power',
    gpio: gpio ? `GPIO${gpio}` : undefined,
    firmwareAlias: gpio,
    voltage: gpio ? 3.3 : id.startsWith('3v3') ? 3.3 : id === '5v' ? 5 : 0,
    capabilities: gpio
      ? [
          'digital',
          ...([0, 3, 45, 46].includes(Number(gpio)) ? ['strapping'] : []),
          ...([35, 36, 37].includes(Number(gpio)) ? ['variant-dependent'] : []),
          ...([19, 20].includes(Number(gpio)) ? ['usb'] : []),
        ]
      : [],
    evidenceIds: ['esp-header'],
  };
});
export const parts: Part[] = [
  {
    id: 'arduino-mega-r3',
    version: 1,
    name: 'Mega 2560 Rev3',
    manufacturer: 'Arduino',
    mpn: 'A000067',
    revision: 'Rev3',
    kind: 'board',
    description: 'ATmega2560 · 5 V logic · 54 digital + 16 analog',
    coverage:
      'Main GPIO, power, analog and duplicate I²C headers modeled. Auxiliary ICSP/ATmega16U2 headers are not modeled.',
    terminals: megaPins,
    internalGroups: [
      ['gnd1', 'gnd2', 'gnd3', 'gnd4', 'gnd5'],
      ['5v', '5v2', '5v3', 'ioref'],
      ['d20', 'sda'],
      ['d21', 'scl'],
    ],
    evidence: megaEvidence,
    verifiedMapping: true,
    constraints: true,
    firmware: { fqbn: 'arduino:avr:mega:cpu=atmega2560', logicV: 5 },
    simulation: 'simavr-external',
    assets: { renderer: 'mega', geometry: 'illustrative' },
  },
  {
    id: 'esp32-s3-devkitc1-v11',
    version: 1,
    name: 'ESP32-S3 DevKitC-1',
    manufacturer: 'Espressif',
    mpn: 'ESP32-S3-DevKitC-1',
    revision: 'v1.1 · module variant unconfirmed',
    kind: 'board',
    description: 'Xtensa LX7 · 3.3 V logic · exact module variant required',
    coverage:
      'J1/J3 headers modeled. Module memory variant is unconfirmed; on-board RGB LED, USB circuitry and analog behavior are not simulated.',
    terminals: espPins,
    internalGroups: [
      ['gnd1', 'gnd2', 'gnd3', 'gnd4'],
      ['3v3', '3v3b'],
    ],
    evidence: espEvidence,
    verifiedMapping: true,
    constraints: true,
    firmware: { fqbn: 'esp32:esp32:esp32s3', logicV: 3.3 },
    simulation: 'none',
    assets: { renderer: 'esp32', geometry: 'illustrative' },
  },
  {
    id: 'kingbright-wp7113id',
    version: 1,
    name: 'Red LED · 5 mm',
    manufacturer: 'Kingbright',
    mpn: 'WP7113ID',
    revision: 'V.14A',
    kind: 'led',
    description: 'Red diffused · polarized · 1.9 V typical at 10 mA',
    terminals: [
      { id: 'a', label: 'A', kind: 'anode', capabilities: [], evidenceIds: ['led-package'] },
      { id: 'k', label: 'K', kind: 'cathode', capabilities: [], evidenceIds: ['led-package'] },
    ],
    internalGroups: [],
    verifiedMapping: true,
    constraints: true,
    simulation: 'none',
    forwardV: 1.9,
    maxCurrentMa: 30,
    evidence: [
      {
        id: 'led-package',
        title: 'Kingbright WP7113ID datasheet',
        url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf',
        revision: 'V.14A · 8 Jan 2026',
        location: 'p. 1 package drawing; p. 2 electrical characteristics',
        fact: 'Cathode is identified by the flat in the package drawing. Forward voltage is typical 1.9 V at 10 mA, 25 °C; 30 mA DC is an absolute maximum, not a target.',
        value: 1.9,
        units: 'V typical @ 10 mA',
        status: 'verified',
      },
    ],
    assets: { renderer: 'led', geometry: 'illustrative' },
  },
  {
    id: 'vishay-mrs25-330',
    version: 1,
    name: '330 Ω resistor',
    manufacturer: 'Vishay BCcomponents',
    mpn: 'MRS25000C3300FCT00',
    revision: '07 Mar 2016',
    kind: 'resistor',
    description: 'MRS25 · 330 Ω ±1% · axial metal film',
    terminals: [
      { id: 'p1', label: '1', kind: 'passive', capabilities: [], evidenceIds: ['resistor-rating'] },
      { id: 'p2', label: '2', kind: 'passive', capabilities: [], evidenceIds: ['resistor-rating'] },
    ],
    internalGroups: [],
    verifiedMapping: true,
    constraints: true,
    simulation: 'none',
    resistance: 330,
    ratedPowerW: 0.6,
    evidence: [
      {
        id: 'resistor-rating',
        title: 'Vishay MRS16 / MRS25',
        url: 'https://www.vishay.com/docs/28724/mrs16m25.pdf',
        revision: '07 Mar 2016 · document 28724',
        location: 'p. 1 technical specifications; p. 2 ordering code',
        fact: 'MRS25 ±1%, 0.6 W P70 subject to permitted film temperature. Ordering code 3300 denotes 330 Ω. Leads are interchangeable; app IDs 1/2 are stable identifiers, not manufacturer polarity.',
        value: 330,
        units: 'Ω ±1%',
        status: 'verified',
      },
    ],
    assets: { renderer: 'resistor', geometry: 'illustrative' },
  },
];
export const partById = (id: string) => {
  const p = parts.find((p) => p.id === id);
  if (!p) throw new Error(`Unsupported part package: ${id}`);
  return p;
};
export const searchParts = (query: string) =>
  parts
    .filter((p) =>
      `${p.name} ${p.manufacturer} ${p.mpn} ${p.description} ${p.terminals.flatMap((t) => t.capabilities).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 20);
