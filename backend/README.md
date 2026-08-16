# Backend implementation

## Verified game facts

- PC saves live under `%USERPROFILE%\Documents\Leaf\WHITE ALBUM2`.
- Manual saves use zero-based names such as `save_00.sav`; the application presents these as slots 1 through 100.
- The PC release exposes 100 save slots.
- The observed PC v2 file is 348,112 bytes. It starts with a little-endian version (`uint32 = 2`), an engine position value at offset 4, a Windows `SYSTEMTIME`-compatible block at offset 8, a 64-byte message field at offset 24, and a 128 x 128 BGRA thumbnail at offset 88. Matching ASCII script names at offsets 132,056 and 132,400 identify the chapter (`1xxx` = IC, `2xxx` = CC, `3xxx` = CODA). The remaining state payload is copied byte-for-byte.

Sources checked through GitHub MCP:

- [MilkFeng/GalHub](https://github.com/MilkFeng/GalHub) documents the `Documents/Leaf/WHITE ALBUM2` redirection path.
- [Irk2wd/GalPathModify](https://github.com/Irk2wd/GalPathModify) confirms the game obtains its base path through the Windows Documents API.
- [wangandi520/wangandi520.github.io](https://github.com/wangandi520/wangandi520.github.io) records the `save_00.sav` naming used by a working PC save.
- [chenmozhijin/VisualNovel-Dataset](https://github.com/chenmozhijin/VisualNovel-Dataset) records the PC version's 100 save slots.

The PAK/LZSS information in the original proposal concerns Leaf resource archives. It is not evidence that `.sav` payloads use the same layout. The verified fields above are read-only metadata; the remaining state payload is not speculatively decompressed or rewritten.

## Safety model

`save-service.cjs` treats unknown payloads as opaque bytes. Moving, copying, and deleting saves creates `.bak` files by default. Reordering uses temporary files in the same directory so swaps cannot overwrite one another.

`Sys.sav` and `save_Q.sav` are system/quick-save files rather than numbered manual slots and are excluded from the grid. The observed Chinese patch stores dialogue through a replacement glyph table, so the service shows a scene id when it cannot decode the 64-byte message field instead of displaying mojibake.

An optional `slotField` descriptor can patch a verified integer field, but it is never enabled by default. This keeps the normal path byte-for-byte compatible with unknown game revisions and translation patches.

## IPC API

The preload exposes these methods through `window.electronAPI`:

- `listSaves(directory)`
- `discoverSaveDirectories()`
- `chooseSaveDirectory(current?)`
- `openSaveDirectory(directory)`
- `reorderSaves(directory, orderedIds, options?)`
- `moveSaves(directory, moves, options?)`
- `copySaves(directory, ids, options?)`
- `deleteSaves(directory, ids, options?)`

Run `npm test` from the repository root for the filesystem test suite. Run `npm run dev` for Electron development, or `npm run build && npm start` to load the production bundle.
