import {describe, expect, it} from 'vitest';
import {exampleProject} from '../src/domain/example';
import {transact, validateProject} from '../src/domain/project';
import {constantValue, validateCircuit} from '../src/domain/validation';

describe('review regressions: electrical identity and coordinated fixes', () => {
  it('treats Rev3 SDA and D20 as one GPIO when validating a signal binding', () => {
    const p = exampleProject();
    p.wires[0].from.terminalId = 'sda';
    p.bindings[0].terminalId = 'sda';
    p.files[0].content = p.files[0].content.replace('LED_PIN = 13', 'LED_PIN = 20');
    const diagnostics = validateCircuit(validateProject(p));
    expect(diagnostics.filter(d => d.layer === 'firmware' && d.severity !== 'unknown')).toEqual([]);
  });

  it('edits the supported constant declaration instead of a matching comment', () => {
    const p = exampleProject();
    p.files[0].content = '// LED_PIN = 13; (previous wiring)\n' + p.files[0].content;
    p.wires[0].from.terminalId = 'd12';
    const issue = validateCircuit(p).find(d => d.id === 'mismatch-indicator-pin');
    expect(issue?.fix).toBeDefined();
    const fixed = transact(p, {expectedRevision:p.revision, ...issue!.fix!});
    expect(constantValue(fixed.files[0].content, 'LED_PIN')).toBe(12);
    expect(validateCircuit(fixed).some(d => d.rule === 'binding.constant')).toBe(false);
    expect(fixed.files[0].content).toContain('// LED_PIN = 13; (previous wiring)');
  });

  it('does not estimate resistor-limited LED current when that resistor is bypassed', () => {
    const p = exampleProject();
    const bypassed = transact(p, {expectedRevision:0, summary:'Bypass current-limiting resistor', commands:[{
      type:'connect', wire:{id:'bypass', from:{componentId:'board', terminalId:'d13'}, to:{componentId:'led', terminalId:'a'}, color:'mint'},
    }]});
    const diagnostics = validateCircuit(bypassed);
    expect(diagnostics.some(d => d.rule === 'led.nominal-estimate')).toBe(false);
    expect(diagnostics.some(d => d.layer === 'electrical' && (d.severity === 'warning' || d.severity === 'error') && d.objectIds.includes('led'))).toBe(true);
  });
});
