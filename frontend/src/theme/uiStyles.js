// Re-export the shared kit's UI style presets.
//
// This file used to be a byte-identical COPY of lilak-ui's theme/uiStyles.js — a
// fork that would silently drift the moment either side was edited. Source it from
// the kit instead so elog and the kit can't disagree. All existing relative imports
// (`../theme/uiStyles`) keep working unchanged; the kit exposes the same named
// exports (btnPrimary, inputBase, modalFrame, hoverify, …).
export * from 'lilak-ui/theme/uiStyles'
