import { describe, it, expectTypeOf } from 'vitest';
import type { Project, Module, SourceFile, BuildRule, TestSuite, ToolConfig } from './index.js';

describe('project-model types', () => {
  it('Project type is defined', () => {
    expectTypeOf<Project>().toBeObject();
  });

  it('Module type is defined', () => {
    expectTypeOf<Module>().toBeObject();
  });

  it('SourceFile type is defined', () => {
    expectTypeOf<SourceFile>().toBeObject();
  });

  it('BuildRule type is defined', () => {
    expectTypeOf<BuildRule>().toBeObject();
  });

  it('TestSuite type is defined', () => {
    expectTypeOf<TestSuite>().toBeObject();
  });

  it('ToolConfig type is defined', () => {
    expectTypeOf<ToolConfig>().toBeObject();
  });
});
