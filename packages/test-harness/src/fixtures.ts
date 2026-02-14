import type { FileSystem, WorkspacePath } from '@antimatter/filesystem';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';

export interface ProjectFixture {
  readonly files: ReadonlyMap<string, string>;
  readonly rules: ReadonlyMap<string, BuildRule>;
  readonly targets: readonly BuildTarget[];
}

/**
 * Create a realistic TypeScript project fixture in the given file system.
 *
 * Writes package.json, tsconfig.json, source files, and test files
 * to the in-memory FS and returns metadata for driving builds.
 */
export async function createTypeScriptProjectFixture(
  fs: FileSystem,
): Promise<ProjectFixture> {
  const files = new Map<string, string>();

  const packageJson = JSON.stringify(
    {
      name: 'demo-project',
      version: '1.0.0',
      type: 'module',
      scripts: {
        build: 'tsc',
        test: 'vitest run',
      },
    },
    null,
    2,
  );
  files.set('package.json', packageJson);

  const tsconfigJson = JSON.stringify(
    {
      compilerOptions: {
        target: 'es2024',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        outDir: './dist',
        rootDir: './src',
      },
      include: ['src/**/*.ts'],
    },
    null,
    2,
  );
  files.set('tsconfig.json', tsconfigJson);

  const indexTs = `import { add, subtract } from './math.js';
import { formatResult } from './utils.js';

export function main(): void {
  const sum = add(2, 3);
  const diff = subtract(10, 4);
  console.log(formatResult('sum', sum));
  console.log(formatResult('diff', diff));
}
`;
  files.set('src/index.ts', indexTs);

  const mathTs = `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}
`;
  files.set('src/math.ts', mathTs);

  const utilsTs = `export function formatResult(label: string, value: number): string {
  return \`\${label}: \${value}\`;
}

export function isPositive(n: number): boolean {
  return n > 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
`;
  files.set('src/utils.ts', utilsTs);

  const mathSpecTs = `import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from '../src/math.js';

describe('math', () => {
  it('should add two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('should subtract two numbers', () => {
    expect(subtract(10, 4)).toBe(6);
  });

  it('should multiply two numbers', () => {
    expect(multiply(3, 4)).toBe(12);
  });

  it('should divide two numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('should throw on division by zero', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
  });
});
`;
  files.set('tests/math.spec.ts', mathSpecTs);

  // Write all files to the FS
  for (const [path, content] of files) {
    await fs.writeFile(path as WorkspacePath, content);
  }

  const rules = new Map<string, BuildRule>([
    [
      'compile-ts',
      {
        id: 'compile-ts',
        name: 'Compile TypeScript',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      },
    ],
    [
      'run-tests',
      {
        id: 'run-tests',
        name: 'Run Tests',
        inputs: ['src/**/*.ts', 'tests/**/*.spec.ts'],
        outputs: [],
        command: 'vitest run',
      },
    ],
  ]);

  const targets: BuildTarget[] = [
    {
      id: 'build',
      ruleId: 'compile-ts',
      moduleId: 'demo-project',
    },
    {
      id: 'test',
      ruleId: 'run-tests',
      moduleId: 'demo-project',
      dependsOn: ['build'],
    },
  ];

  return { files, rules, targets };
}
