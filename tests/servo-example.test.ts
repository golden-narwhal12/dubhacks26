import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { servoEncoderProject } from '../src/domain/servoExample';
import { validateCircuit } from '../src/domain/validation';
import { evaluateArtifacts } from '../src/evaluation/oracles';
import { getEvaluationCase } from '../src/evaluation/cases';
import { buildKey } from '../src/domain/semantics';
import { parseProject, serializeProject } from '../src/domain/project';
it('manual servo example preserves exact source and satisfies scoped circuit/provenance predicates', () => {
  const source = readFileSync('examples/servo-encoder/sketch.ino', 'utf8'),
    p = servoEncoderProject(source);
  expect(p.files[0].content).toBe(source);
  expect(
    validateCircuit(p).filter((d) => d.severity === 'error' || d.severity === 'warning'),
  ).toEqual([]);
  expect(parseProject(serializeProject(p))).toEqual(p);
  const checked = evaluateArtifacts(
    getEvaluationCase('servo-encoder'),
    p,
    {
      success: true,
      revision: p.revision,
      kind: 'build',
      output: 'Fixture only; separate real compiler test required',
      durationMs: 0,
      buildKey: buildKey(p),
    },
    'The external power supply and 3.3 V level shifter are documented. Couple and align the magnet with the shaft; calibrate zero and direction. This is a manual example, not an AI task or physical measurement.',
  );
  expect(checked.reasons).toEqual([]);
});
