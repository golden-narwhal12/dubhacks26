import { mkdir, writeFile } from 'node:fs/promises';
import { exampleProject } from '../src/domain/example.ts';
await mkdir('examples', { recursive: true });
await writeFile('examples/indicator.trace.json', JSON.stringify(exampleProject(), null, 2) + '\n');
