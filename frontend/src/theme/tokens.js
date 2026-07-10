// Re-export the shared kit's design tokens.
//
// This file used to be a byte-identical COPY of lilak-ui's theme/tokens.js — a
// fork that would silently drift the moment either side was edited. Source it from
// the kit instead so elog and the kit can't disagree. All existing relative imports
// (`../theme/tokens`) keep working unchanged; the kit exposes the same named
// exports (TOKEN_GROUPS, TOKENS, THEMES).
export * from 'lilak-ui/theme/tokens'
