import { blankProject } from './example';
import { transact, type Command } from './project';
import type { Endpoint, TelemetryMapping } from './schema';

/** Explicit manual template, never an agent-response shortcut or physical test. */
export function servoEncoderProject(firmware: string) {
  const p = { ...blankProject(), id: 'servo-encoder-example', name: 'Servo / magnetic encoder' };
  const commands: Command[] = [];
  const add = (id: string, partId: string, ref: string, x: number, y: number, config: any = {}) =>
    commands.push({
      type: 'addComponent',
      component: { id, partId, partVersion: 1, ref, config },
      placement: { x, y, rotation: 0 },
    });
  add('mega', 'arduino-mega-r3', 'U1', 80, 260);
  add('shifter', 'adafruit-757', 'U2', 900, 80);
  add('encoder', 'as5600-module-photo', 'U3', 1250, 80);
  add('servo', 'sg90-generic', 'M1', 1250, 460);
  add('supply', 'external-dc-supply', 'PS1', 900, 480, { supplyVoltageV: 5 });
  const ep = (address: string): Endpoint => {
    const [componentId, terminalId] = address.split(':');
    return { componentId, terminalId };
  };
  const connect = (
    id: string,
    from: string,
    to: string,
    color: 'red' | 'black' | 'blue' | 'yellow' | 'mint' = 'mint',
  ) => commands.push({ type: 'connect', wire: { id, from: ep(from), to: ep(to), color } });
  connect('servo-positive', 'supply:positive', 'servo:power', 'red');
  connect('supply-reference', 'supply:negative', 'mega:gnd1', 'black');
  connect('servo-reference', 'servo:gnd', 'mega:gnd1', 'black');
  connect('servo-control', 'mega:d9', 'servo:signal', 'yellow');
  connect('low-reference', 'mega:3v3', 'shifter:lv', 'red');
  connect('high-reference', 'mega:5v', 'shifter:hv', 'red');
  connect('translator-ground', 'mega:gnd1', 'shifter:gnd', 'black');
  connect('encoder-supply', 'mega:3v3', 'encoder:vcc', 'red');
  connect('encoder-ground', 'mega:gnd2', 'encoder:gnd', 'black');
  connect('encoder-direction', 'encoder:dir', 'encoder:gnd', 'black');
  connect('data-high', 'mega:d20', 'shifter:hv1', 'blue');
  connect('data-low', 'shifter:lv1', 'encoder:sda', 'blue');
  connect('clock-high', 'mega:d21', 'shifter:hv2', 'yellow');
  connect('clock-low', 'shifter:lv2', 'encoder:scl', 'yellow');
  commands.push(
    { type: 'setTarget', id: 'mega' },
    { type: 'writeFile', file: { id: 'main', path: 'sketch.ino', content: firmware } },
    {
      type: 'setBinding',
      binding: {
        id: 'servo-pin',
        boardId: 'mega',
        terminalId: 'd9',
        target: ep('servo:signal'),
        fileId: 'main',
        symbol: 'SERVO_PIN',
        mode: 'output',
      },
    },
  );
  const channel = (
    id: string,
    label: string,
    field: string,
    componentId: string,
    units: string,
    meaning: TelemetryMapping['meaning'],
  ) =>
    commands.push({
      type: 'setTelemetry',
      mapping: {
        id,
        label,
        field,
        componentId,
        units,
        meaning,
        parser: 'keyvalue',
        staleAfterMs: 1000,
      },
    });
  channel('servo-command', 'Commanded position', 'command_deg', 'servo', 'deg', 'command');
  channel('encoder-angle', 'Encoder orientation', 'encoder_deg', 'encoder', 'deg', 'measurement');
  channel('encoder-raw', 'Encoder raw angle', 'encoder_raw', 'encoder', 'counts', 'raw');
  channel('encoder-valid', 'Encoder data valid', 'encoder_valid', 'encoder', '0/1', 'state');
  return transact(p, {
    expectedRevision: 0,
    summary: 'Create documented servo/encoder example',
    commands,
  });
}
