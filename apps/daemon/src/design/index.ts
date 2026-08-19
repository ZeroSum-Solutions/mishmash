/**
 * @module design
 *
 * Barrel for daemon design lifecycle modules: finalize-design (finalize an
 * agent design run), handoff-design (synthesize a handoff prompt),
 * claude-design-import (import a Claude design zip), site-archetypes
 * (domain knowledge for the conversational template advisor, F001 R3),
 * brief-extraction (brief -> archetype matching, F001 R4), and
 * rank-candidates (archetype x design-templates/index.json -> ranked
 * candidates, F001 R5).
 */
export * from './finalize-design.js';
export * from './handoff-design.js';
export * from './claude-design-import.js';
export * from './site-archetypes.js';
export * from './brief-extraction.js';
export * from './rank-candidates.js';
