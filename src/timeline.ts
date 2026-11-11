import { sectionRange } from './engine/beat';
import type { SectionId } from './engine/beat';

export const IMPLEMENTED_2D: SectionId[] = ['boot', 'lock', 'drop1', 'glitch', 'youth', 'gen', 'build', 'drop2', 'outro'];
export const IMPLEMENTED_END = Math.max(...IMPLEMENTED_2D.map(id => sectionRange(id).end));
