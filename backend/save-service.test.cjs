'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  listSaves,
  reorderSaves,
  moveSaves,
  copySaves,
  deleteSaves,
  loadWa2ChineseMapping,
  decodeWa2PatchedText,
  cleanWa2Message,
  isChinesePatchDirectory,
  readWa2PcScriptName,
  chapterFromWa2ScriptName,
} = require('./save-service.cjs');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wa2-save-editor-'));
  await fs.writeFile(path.join(directory, 'save_00.sav'), Buffer.from('2020-01-02 03:04:05\0IC\0雪菜的存档文本', 'utf8'));
  await fs.writeFile(path.join(directory, 'save_01.sav'), Buffer.from('2021-02-03 04:05:06\0CC\0closing chapter', 'utf8'));
  return directory;
}

test('lists supported save files and extracts conservative metadata', async () => {
  const directory = await fixture();
  await fs.writeFile(path.join(directory, 'Sys.sav'), Buffer.alloc(8));
  await fs.writeFile(path.join(directory, 'save_Q.sav'), Buffer.alloc(8));
  const saves = await listSaves(directory);
  assert.equal(saves.length, 2);
  assert.equal(saves[0].slot, 1);
  assert.equal(saves[0].route, 'IC');
  assert.equal(saves[0].format, 'opaque');
  assert.match(saves[0].date, /^2020-01-02 03:04:05$/);
});

test('materializes all 100 slots without treating empty slots as saves', async () => {
  const directory = await fixture();
  const saves = await listSaves(directory, { includeEmpty: true, useChinesePatch: false });
  assert.equal(saves.length, 100);
  assert.equal(saves.filter((save) => !save.empty).length, 2);
  assert.equal(saves[0].empty, false);
  assert.equal(saves[2].empty, true);
  assert.equal(saves[2].slot, 3);
  assert.equal(saves[2].format, 'empty');
  assert.equal(saves[2].fileName, undefined);
});

test('moves a real save directly into an empty slot', async () => {
  const directory = await fixture();
  const saves = await listSaves(directory, { useChinesePatch: false });
  const result = await moveSaves(directory, [{ id: saves[0].id, targetSlot: 4 }], { backup: true, includeEmpty: true, useChinesePatch: false });
  assert.equal(result.saves.length, 100);
  assert.deepEqual(result.saves.filter((save) => !save.empty).map((save) => save.slot), [2, 4]);
  assert.equal(await fs.readFile(path.join(directory, 'save_03.sav'), 'utf8'), '2020-01-02 03:04:05\0IC\0雪菜的存档文本');
  await assert.rejects(fs.access(path.join(directory, 'save_00.sav')));
  assert.equal(result.backups.length, 1);
});

test('rejects materialized empty-slot IDs before any file operation', async () => {
  const directory = await fixture();
  const saves = await listSaves(directory, { includeEmpty: true, useChinesePatch: false });
  await assert.rejects(deleteSaves(directory, [saves[2].id], { includeEmpty: true, useChinesePatch: false }), { code: 'SAVE_NOT_FOUND' });
  assert.deepEqual((await listSaves(directory, { useChinesePatch: false })).map((save) => save.slot), [1, 2]);
});

test('decodes verified CK-GAL custom bytes and strips message tags', async () => {
  const mapping = await loadWa2ChineseMapping();
  const raw = Buffer.from('8f6388d38e479acb8d97999694e391f690b799c393c6945c81630000', 'hex');
  assert.equal(decodeWa2PatchedText(raw, mapping), '我也并非对这种毫无道理的…');
  assert.equal(cleanWa2Message('<F14「为什么你会这么熟练啊！…>|n下一行'), '「为什么你会这么熟练啊！…\n下一行');
});

test('detects a patch directory only when required files are present', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wa2-patch-'));
  await Promise.all(['WA2_chs.exe', 'ck-gal.pak', 'fon.pak'].map((name) => fs.writeFile(path.join(directory, name), '')));
  assert.equal(await isChinesePatchDirectory(directory), true);
  await fs.unlink(path.join(directory, 'fon.pak'));
  assert.equal(await isChinesePatchDirectory(directory), false);
});

test('maps embedded WA2 script names to their canonical chapters', () => {
  assert.equal(chapterFromWa2ScriptName('1011_030'), 'Introductory Chapter');
  assert.equal(chapterFromWa2ScriptName('2407'), 'Closing Chapter');
  assert.equal(chapterFromWa2ScriptName('3104'), 'CODA');
  assert.equal(chapterFromWa2ScriptName('5001'), undefined);
  assert.equal(chapterFromWa2ScriptName('not-a-script'), undefined);
});

test('parses the verified WA2 PC v2 header and thumbnail', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wa2-real-format-'));
  const payload = Buffer.alloc(348112, 0);
  payload.writeUInt32LE(2, 0);
  payload.writeUInt32LE(120110, 4);
  payload.writeUInt16LE(2026, 8);
  payload.writeUInt16LE(8, 10);
  payload.writeUInt16LE(3, 12);
  payload.writeUInt16LE(15, 14);
  payload.writeUInt16LE(16, 16);
  payload.writeUInt16LE(45, 18);
  payload.writeUInt16LE(12, 20);
  payload.write('Hello from save', 24, 'ascii');
  payload.write('2009', 132056, 'ascii');
  payload.write('2009', 132400, 'ascii');
  for (let index = 88; index < 88 + 128 * 128 * 4; index += 4) {
    payload[index] = 0x20;
    payload[index + 1] = 0x40;
    payload[index + 2] = 0x80;
    payload[index + 3] = 0xff;
  }
  await fs.writeFile(path.join(directory, 'save_00.sav'), payload);
  const [save] = await listSaves(directory);
  assert.equal(save.format, 'wa2-pc-v2');
  assert.equal(save.scriptId, 120110);
  assert.equal(save.scriptName, '2009');
  assert.equal(readWa2PcScriptName(payload), '2009');
  assert.equal(save.route, 'Closing Chapter');
  assert.equal(save.date, '2026-08-15 16:45:12');
  assert.match(save.thumbnail, /^data:image\/bmp;base64,/);
  assert.equal(save.textSnippet, 'Hello from save');
});

test('reorders files atomically and leaves backups', async () => {
  const directory = await fixture();
  const before = await listSaves(directory);
  const result = await reorderSaves(directory, [before[1].id, before[0].id]);
  assert.deepEqual(result.saves.map((save) => save.slot), [1, 2]);
  assert.equal(await fs.readFile(path.join(directory, 'save_00.sav'), 'utf8'), '2021-02-03 04:05:06\0CC\0closing chapter');
  assert.equal(await fs.readFile(path.join(directory, 'save_01.sav'), 'utf8'), '2020-01-02 03:04:05\0IC\0雪菜的存档文本');
  assert.equal(result.backups.length, 2);
  assert.equal((await fs.readdir(directory)).filter((name) => name.endsWith('.bak')).length, 2);
});

test('reorders only occupied slots and preserves empty gaps', async () => {
  const directory = await fixture();
  await fs.rename(path.join(directory, 'save_01.sav'), path.join(directory, 'save_02.sav'));
  const before = await listSaves(directory);
  await reorderSaves(directory, [before[1].id, before[0].id]);
  assert.equal(await fs.readFile(path.join(directory, 'save_00.sav'), 'utf8'), '2021-02-03 04:05:06\0CC\0closing chapter');
  assert.equal(await fs.readFile(path.join(directory, 'save_02.sav'), 'utf8'), '2020-01-02 03:04:05\0IC\0雪菜的存档文本');
  await assert.rejects(fs.access(path.join(directory, 'save_01.sav')));
});

test('rejects a collision unless overwrite is explicit', async () => {
  const directory = await fixture();
  await fs.writeFile(path.join(directory, 'save_02.sav'), 'occupied', 'utf8');
  const saves = await listSaves(directory);
  await assert.rejects(moveSaves(directory, [{ id: saves[0].id, targetSlot: 3 }]), { code: 'DESTINATION_EXISTS' });
});

test('moves a batch into consecutive slots and backs up overwritten saves', async () => {
  const directory = await fixture();
  await fs.writeFile(path.join(directory, 'save_03.sav'), 'occupied target', 'utf8');
  const saves = await listSaves(directory, { useChinesePatch: false });
  const sources = saves.filter((save) => save.slot <= 2);
  const result = await moveSaves(directory, [
    { id: sources[0].id, targetSlot: 3 },
    { id: sources[1].id, targetSlot: 4 },
  ], { backup: true, overwrite: true, useChinesePatch: false });

  assert.deepEqual(result.saves.map((save) => save.slot), [3, 4]);
  assert.equal(await fs.readFile(path.join(directory, 'save_02.sav'), 'utf8'), '2020-01-02 03:04:05\0IC\0雪菜的存档文本');
  assert.equal(await fs.readFile(path.join(directory, 'save_03.sav'), 'utf8'), '2021-02-03 04:05:06\0CC\0closing chapter');
  assert.equal(result.backups.length, 3);
  assert.equal((await fs.readdir(directory)).filter((name) => name.endsWith('.bak')).length, 3);
});

test('copies to the next free slot and deletes with a backup', async () => {
  const directory = await fixture();
  const saves = await listSaves(directory);
  const copied = await copySaves(directory, [saves[0].id]);
  assert.equal(copied.saves.length, 3);
  assert.equal(copied.saves.find((save) => save.slot === 3).textSnippet, saves[0].textSnippet);
  const deleted = await deleteSaves(directory, [saves[1].id]);
  assert.equal(deleted.saves.length, 2);
  assert.ok(deleted.backups[0].endsWith('.bak'));
});

test('can patch a slot field only when explicitly configured', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wa2-slot-field-'));
  await fs.writeFile(path.join(directory, 'save_00.sav'), Buffer.from([1, 0, 0, 0, 0x41]));
  const [save] = await listSaves(directory);
  await moveSaves(directory, [{ id: save.id, targetSlot: 2 }], { slotField: { offset: 0, width: 4, endian: 'le', expected: 1 } });
  const payload = await fs.readFile(path.join(directory, 'save_01.sav'));
  assert.equal(payload.readUInt32LE(0), 2);
  assert.equal(payload[4], 0x41);
});
