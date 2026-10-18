import { blankProject, exampleProject } from '../domain/example';
import { validateProject } from '../domain/project';
import type { Part, Project } from '../domain/schema';

export interface EvaluationExpectations {
  requiredKinds?: Part['kind'][];
  compile?: boolean;
  telemetry?: 'analog' | 'digital' | 'encoder-servo';
  preserveComponents?: boolean;
  preserveWires?: boolean;
  preserveFiles?: string[];
  preserveFragments?: string[];
  resolveRules?: string[];
  explainOnly?: boolean;
  clarification?: { concepts: string[][]; minimum: number; limitation?: boolean };
}
export interface EvaluationCase {
  id: string;
  category: string;
  goal: string;
  seed: Project;
  expectations: EvaluationExpectations;
}

const blank = (id: string) => ({ ...blankProject(), id: `eval-${id}`, name: `Evaluation: ${id}` });
const indicator = () => {
  const p = exampleProject();
  p.files.push({
    id: 'unrelated',
    path: 'unrelated.h',
    content: '#pragma once\nconstexpr int KEEP_VALUE = 42;\n',
  });
  return p;
};
const codeFirst = blank('code-first');
codeFirst.files[0].content = `constexpr uint8_t LED_PIN = 12;
constexpr unsigned long KEEP_INTERVAL_MS = 725;
unsigned long lastToggle = 0;
bool indicatorState = false;
void setup() { pinMode(LED_PIN, OUTPUT); Serial.begin(115200); }
void loop() {
  if (millis() - lastToggle >= KEEP_INTERVAL_MS) {
    lastToggle = millis();
    indicatorState = !indicatorState;
    digitalWrite(LED_PIN, indicatorState);
  }
}
`;
const missingResistor = indicator();
missingResistor.components = missingResistor.components.filter((c) => c.id !== 'resistor');
for (const v of ['wiring', 'schematic'] as const) delete missingResistor.layouts[v].resistor;
missingResistor.wires = missingResistor.wires.filter((w) => w.id === 'return');
missingResistor.wires.push({
  id: 'direct-drive',
  from: { componentId: 'board', terminalId: 'd13' },
  to: { componentId: 'led', terminalId: 'a' },
  color: 'mint',
});
missingResistor.bindings[0].target = { componentId: 'led', terminalId: 'a' };
const mismatch = indicator();
mismatch.files[0].content = mismatch.files[0].content.replace('LED_PIN = 13', 'LED_PIN = 12');
const compileError = indicator();
compileError.files[0].content += '\nTHIS_IS_NOT_VALID_CPP\n';
const unsupportedPwm = indicator();
unsupportedPwm.wires[0].from.terminalId = 'd24';
unsupportedPwm.bindings[0].terminalId = 'd24';
unsupportedPwm.bindings[0].mode = 'pwm';
unsupportedPwm.files[0].content = unsupportedPwm.files[0].content.replace(
  'LED_PIN = 13',
  'LED_PIN = 24',
);
const voltageMismatch = indicator();
voltageMismatch.components.push({
  id: 'aux-esp',
  partId: 'esp32-s3-devkitc1-v11',
  partVersion: 1,
  ref: 'U2',
  config: {},
});
for (const v of ['wiring', 'schematic'] as const)
  voltageMismatch.layouts[v]['aux-esp'] = { x: 700, y: 40, rotation: 0 };
voltageMismatch.wires.push({
  id: 'unsafe-5v',
  from: { componentId: 'board', terminalId: '5v' },
  to: { componentId: 'aux-esp', terminalId: 'io4' },
  color: 'red',
});

/** These are tasks, not response templates. Every attempt must use the normal runtime/tools. */
export const evaluationCases: EvaluationCase[] = [
  {
    id: 'led',
    category: 'basic-creation',
    seed: blank('led'),
    goal: 'Create a Mega 2560 circuit with one external LED, appropriate current limiting and visible blink firmware. Choose a supported GPIO, add an explicit binding, run circuit checks and compile. Do not upload or open any hardware.',
    expectations: { requiredKinds: ['board', 'led', 'resistor'], compile: true },
  },
  {
    id: 'potentiometer',
    category: 'analog-input',
    seed: blank('potentiometer'),
    goal: 'Build a Mega 2560 + 10 kΩ potentiometer circuit. Read its wiper on a suitable analog input, explicitly print labeled raw ADC readings at 10 Hz, and configure the matching Debug channel. State ADC-count units, run checks and compile. Do not touch hardware.',
    expectations: { requiredKinds: ['board', 'potentiometer'], compile: true, telemetry: 'analog' },
  },
  {
    id: 'continue-circuit',
    category: 'existing-circuit',
    seed: indicator(),
    goal: 'Keep the existing indicator circuit, blink behavior and unrelated.h. Add a 10 kΩ potentiometer on a suitable analog input, report its raw value at 10 Hz without blocking the existing blink, and add a Debug mapping. Run checks and compile without hardware operations.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor', 'potentiometer'],
      compile: true,
      telemetry: 'analog',
      preserveComponents: true,
      preserveWires: true,
      preserveFiles: ['unrelated'],
      preserveFragments: ['INTERVAL_MS', 'digitalWrite'],
    },
  },
  {
    id: 'continue-code',
    category: 'existing-code',
    seed: codeFirst,
    goal: 'Create the compatible Mega 2560 + external LED + current-limiting wiring for this existing sketch. Preserve the nonblocking timing/state logic and literal LED_PIN assignment, infer the supported pin binding, run checks and compile. No hardware operations.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor'],
      compile: true,
      preserveFragments: [
        'LED_PIN = 12',
        'KEEP_INTERVAL_MS = 725',
        'millis() - lastToggle',
        'indicatorState = !indicatorState',
      ],
    },
  },
  {
    id: 'explain-led',
    category: 'diagnostic-explain',
    seed: missingResistor,
    goal: 'Explain diagnostic led-resistor-led: the external GPIO-driven LED has no identified current limiting. Explain the actual path and relevant source/assumptions concisely. Do not edit the project, build, or operate hardware.',
    expectations: { explainOnly: true },
  },
  {
    id: 'repair-led',
    category: 'diagnostic-fix',
    seed: missingResistor,
    goal: 'Fix the missing current limiting on this GPIO-driven LED using a suitable supported series resistor. Preserve unrelated.h and existing blink behavior, use actual project edits, recheck the targeted diagnostic and compile. No hardware operations.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor'],
      compile: true,
      resolveRules: ['led.series-resistor', 'led.resistor-bypass'],
      preserveFiles: ['unrelated'],
    },
  },
  {
    id: 'repair-binding',
    category: 'firmware-binding-repair',
    seed: mismatch,
    goal: 'Fix the LED_PIN/wiring mismatch coherently while preserving the existing circuit and unrelated.h. Use the diagnostic evidence, recheck, and compile. No hardware operations.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor'],
      compile: true,
      resolveRules: ['binding.constant', 'binding.connectivity'],
      preserveComponents: true,
      preserveWires: true,
      preserveFiles: ['unrelated'],
    },
  },
  {
    id: 'repair-compile',
    category: 'compile-repair',
    seed: compileError,
    goal: 'Compile this project, inspect the compiler error and repair the firmware while preserving the existing indicator and unrelated.h. Recompile and report the actual result. Do not upload.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor'],
      compile: true,
      preserveComponents: true,
      preserveWires: true,
      preserveFiles: ['unrelated'],
    },
  },
  {
    id: 'repair-pin-capability',
    category: 'pin-capability-repair',
    seed: unsupportedPwm,
    goal: 'Repair the unsupported PWM binding on Mega D24. Inspect the actual blink firmware and choose a coherent supported configuration; retain its behavior and unrelated.h. Update any necessary wiring/code/binding together, recheck and compile. No hardware operations.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor'],
      compile: true,
      resolveRules: ['binding.capability', 'binding.constant'],
      preserveComponents: true,
      preserveFiles: ['unrelated'],
    },
  },
  {
    id: 'repair-voltage',
    category: 'voltage-repair',
    seed: voltageMismatch,
    goal: 'Fix the unsafe direct Mega 5 V supply connection to the auxiliary ESP32-S3 IO4 GPIO. That connection has no intended function, so remove it rather than inventing a level-shifting part. Preserve both board identities, the working Mega indicator and unrelated.h. Recheck and compile the Mega; do not assume the auxiliary ESP memory variant or operate hardware.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor'],
      compile: true,
      resolveRules: ['voltage.supply-gpio'],
      preserveComponents: true,
      preserveFiles: ['unrelated'],
    },
  },
  {
    id: 'itr9608',
    category: 'digital-sensor',
    seed: blank('itr9608'),
    goal: 'Create a Mega 2560 design using my bare HiLetgo ITR9608 DIP-4 photointerruptor. Model the emitter and detector separately, add emitter current limiting and a detector load/pull-up, provide explicit labeled blocked-state serial reporting and a Debug channel, run checks and compile. Use the supported provisional package; state actual suffix/orientation assumptions. Do not invent a comparator output or operate hardware.',
    expectations: {
      requiredKinds: ['board', 'photointerruptor', 'resistor'],
      compile: true,
      telemetry: 'digital',
      resolveRules: ['opto.emitter-path', 'opto.detector-load'],
    },
  },
  {
    id: 'servo-encoder',
    category: 'servo-encoder',
    seed: blank('servo-encoder'),
    goal: 'Help me make a circuit using an as5600 encoder to measure the rotation of an sg90 servo. Target my Mega 2560. Inspect the supported photo-matched AS5600 module and SG90 assumptions. Implement the supported local circuit, visible firmware and Debug channels, check and compile, or ask a genuinely necessary focused question about missing physical/interface facts. Keep commanded servo position distinct from encoder readings. No physical operation.',
    expectations: {
      requiredKinds: ['board', 'servo', 'encoder'],
      compile: true,
      telemetry: 'encoder-servo',
      clarification: {
        concepts: [
          ['pull-up', 'pullup', 'level shift', '3.3'],
          ['external power', 'power supply', 'servo supply'],
          ['magnet', 'coupl', 'align'],
        ],
        minimum: 2,
      },
    },
  },
  {
    id: 'combined',
    category: 'increased-complexity',
    seed: indicator(),
    goal: 'Preserve the existing Mega indicator and unrelated.h. Add a potentiometer and bare ITR9608 with correct emitter/detector support. Report labeled ADC and blocked-state values at 10 Hz with separate Debug mappings. Choose nonconflicting pins, inspect checks, repair applicable issues and compile. State unverified component ratings; no physical operations.',
    expectations: {
      requiredKinds: ['board', 'led', 'resistor', 'potentiometer', 'photointerruptor'],
      compile: true,
      telemetry: 'analog',
      preserveComponents: true,
      preserveWires: true,
      preserveFiles: ['unrelated'],
      resolveRules: ['opto.emitter-path', 'opto.detector-load'],
    },
  },
  {
    id: 'ambiguous-variant',
    category: 'ambiguity',
    seed: blank('ambiguous-variant'),
    goal: 'I have an ESP32-S3 module but do not know its board revision, flash/PSRAM marking or sensor module wiring. Tell me exactly which missing identity/configuration is needed before claiming a physical-compatible build. Do not guess variants or program anything.',
    expectations: {
      clarification: {
        concepts: [
          ['board', 'revision'],
          ['flash', 'psram', 'marking'],
          ['sensor', 'wiring', 'module'],
        ],
        minimum: 2,
      },
    },
  },
  {
    id: 'unsupported-dependency',
    category: 'limits',
    seed: blank('unsupported-dependency'),
    goal: 'Make a design using an unsupported BNO055 breakout and the Adafruit_BNO055 library. Inspect supported parts/dependencies first; if this exact package/library is unavailable, explain the specific limitation and what must be supplied rather than inventing terminals or claiming a successful compile. Do not operate hardware.',
    expectations: {
      clarification: {
        concepts: [
          ['bno055'],
          ['unavailable', 'unsupported', 'not installed', 'not available'],
          ['library', 'package', 'datasheet'],
        ],
        minimum: 3,
        limitation: true,
      },
    },
  },
  {
    id: 'no-telemetry',
    category: 'limits',
    seed: (() => {
      const p = indicator();
      p.files[0].content = 'void setup() {}\nvoid loop() {}\n';
      return p;
    })(),
    goal: 'Show me the actual measured sensor values from this existing firmware without changing it or opening hardware. Inspect what is actually reported. If none is reported, explain that limitation without inventing zero/live values or inserting hidden reporting.',
    expectations: {
      explainOnly: true,
      clarification: {
        concepts: [
          ['not report', 'no serial', 'does not report', 'no telemetry', 'no sensor'],
          ['firmware', 'serial', 'reporting'],
        ],
        minimum: 2,
        limitation: true,
      },
    },
  },
];

for (const c of evaluationCases) c.seed = validateProject(c.seed);
export function getEvaluationCase(id: string): EvaluationCase {
  const found = evaluationCases.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown evaluation case: ${id}`);
  return found;
}
export function freshSeed(input: string | EvaluationCase): Project {
  return structuredClone(typeof input === 'string' ? getEvaluationCase(input).seed : input.seed);
}
