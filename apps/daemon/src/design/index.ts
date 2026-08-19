/**
 * @module design
 *
 * Barrel for daemon design lifecycle modules: finalize-design (finalize an
 * agent design run), handoff-design (synthesize a handoff prompt),
 * claude-design-import (import a Claude design zip), and site-archetypes
 * (domain knowledge for the conversational template advisor, F001 R3).
 */
export * from './finalize-design.js';
export * from './handoff-design.js';
export * from './claude-design-import.js';
export * from './site-archetypes.js';
