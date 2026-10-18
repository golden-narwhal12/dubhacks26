/** Chip-level firmware evidence, separate from immutable module terminal packages. */
export function referenceFacts(partId: string) {
  if (partId !== 'as5600-module-photo') return undefined;
  return {
    id: 'as5600-interface-1',
    version: 1,
    scope:
      'AS5600 chip protocol only; does not verify the photographed module circuitry or mechanics.',
    source: {
      url: 'https://look.ams-osram.com/m/7059eac7531a86fd/original/AS5600-DS000365.pdf',
      revision: 'v1-06, 2018-Jun-20',
      location: 'p.18 Figure21 register map; p.1 DIR/magnet description',
      verification:
        'Cross-checked official manufacturer indexed table; direct PDF fetch returned404 on17Oct2026',
    },
    facts: {
      i2c7BitAddress: '0x36',
      rawAngleRegisters: ['0x0C', '0x0D'],
      scaledAngleRegisters: ['0x0E', '0x0F'],
      angleBits: 12,
      rawMask: '0x0FFF',
      statusRegister: '0x0B',
      statusBits: { magnetDetected: 5, magnetTooWeak: 4, magnetTooStrong: 3 },
      direction: 'DIR grounded: clockwise increases; DIR high: counterclockwise increases',
      mechanical:
        'Diametrically magnetized on-axis magnet; real coupling/alignment and application zero/direction calibration are required.',
    },
    application:
      'Degrees may be computed from valid raw counts *360/4096. Visible firmware must handle I²C/status failures as invalid or unreported, never fabricated zero. The interface does not measure servo commands or establish mechanical linkage. No OTP burn is needed for read-only angle acquisition.',
  };
}
