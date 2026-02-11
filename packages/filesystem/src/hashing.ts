import { createHash } from 'node:crypto';
import type { Hash } from '@antimatter/project-model';
import type { FileContent } from './types.js';

/** Compute a SHA-256 hex hash of the given content. */
export function hashContent(content: FileContent | string): Hash {
  const hash = createHash('sha256');
  if (typeof content === 'string') {
    hash.update(content, 'utf-8');
  } else {
    hash.update(content);
  }
  return hash.digest('hex');
}
