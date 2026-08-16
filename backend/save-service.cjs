'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

/**
 * The PC release stores saves below the user's Documents directory, but the
 * exact binary layout differs between releases and patches.  This service
 * deliberately treats the payload as opaque unless a caller supplies a
 * verified slot-field description.  File operations therefore cannot corrupt
 * an unknown save format.
 */
const SUPPORTED_EXTENSIONS = new Set(['.dat', '.sav', '.bin']);
const SLOT_PATTERNS = [
  // WA2 PC uses save_00.sav through save_99.sav. UI slots stay 1-based.
  { pattern: /^save_(\d{2})(?:\.[^.]+)?$/i, fileBase: 0 },
  { pattern: /^(?:save|savedata|slot)[-_ ]?(\d{1,4})(?:\.[^.]+)?$/i, fileBase: 1 },
  { pattern: /^(?:wa2|whitealbum2)[-_ ]?(?:save[-_ ]?)?(\d{1,4})(?:\.[^.]+)?$/i, fileBase: 1 },
  { pattern: /^data[-_ ]?(\d{1,4})(?:\.[^.]+)?$/i, fileBase: 1 },
];
const DATE_PATTERNS = [
  /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2})[:：](\d{2})(?::(\d{2}))?/,
  /(20\d{2})(\d{2})(\d{2})[ _T](\d{2})(\d{2})(\d{2})/,
];
const ROUTE_PATTERN = /\b(?:IC|CC|CODA|introductory chapter|closing chapter|final chapter)\b/i;
const WA2_PC_VERSION = 2;
const WA2_PC_THUMBNAIL_OFFSET = 88;
const WA2_PC_THUMBNAIL_WIDTH = 128;
const WA2_PC_THUMBNAIL_HEIGHT = 128;
const WA2_PC_THUMBNAIL_BYTES = WA2_PC_THUMBNAIL_WIDTH * WA2_PC_THUMBNAIL_HEIGHT * 4;
const WA2_PC_SCRIPT_NAME_OFFSETS = [132056, 132400];
const WA2_PC_SCRIPT_NAME_BYTES = 24;
const MAX_SAVE_SLOTS = 100;
const WA2_CHINESE_MAPPING_PATH = path.join(__dirname, 'resources', 'wa2.chs.txt');
const WA2_CHINESE_PATCH_FILES = ['WA2_chs.exe', 'ck-gal.pak', 'fon.pak'];
const WA2_CUSTOM_CODE_RANGES = [
  [0x889f, 0x88ff, 0],
  [0x8940, 0x89ff, -95 + 189],
  [0x8a40, 0x8aff, -95 + 189 * 2],
  [0x8b40, 0x8bff, -95 + 189 * 3],
  [0x8c40, 0x8cff, -95 + 189 * 4],
  [0x8d40, 0x8dff, -95 + 189 * 5],
  [0x8e40, 0x8eff, -95 + 189 * 6],
  [0x8f40, 0x8fff, -95 + 189 * 7],
  [0x9040, 0x90ff, -95 + 189 * 8],
  [0x9140, 0x91ff, -95 + 189 * 9],
  [0x9240, 0x92ff, -95 + 189 * 10],
  [0x9340, 0x93ff, -95 + 189 * 11],
  [0x9440, 0x94ff, -95 + 189 * 12],
  [0x9540, 0x95ff, -95 + 189 * 13],
  [0x9640, 0x96ff, -95 + 189 * 14],
  [0x9740, 0x97ff, -95 + 189 * 15],
  [0x9840, 0x987f, -95 + 51 + 189 * 16],
  [0x989f, 0x98ff, -95 + 51 + 189 * 16],
  [0x9940, 0x99ff, -95 + 51 + 94 + 189 * 16],
  [0x9a40, 0x9aff, -95 + 51 + 94 + 189 * 17],
  [0x9b40, 0x9bff, -95 + 51 + 94 + 189 * 18],
  [0x9c40, 0x9cff, -95 + 51 + 94 + 189 * 19],
];

let wa2ChineseMappingPromise;
let detectedChineseGameDirectoryPromise;

class SaveServiceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SaveServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SaveServiceError(code, message, details);
}

function normalizeRoot(root) {
  if (typeof root !== 'string' || !root.trim()) {
    fail('INVALID_DIRECTORY', 'A save directory is required.');
  }
  return path.resolve(root);
}

function safeChild(root, child) {
  const resolvedRoot = path.resolve(root);
  const resolvedChild = path.resolve(resolvedRoot, child);
  if (resolvedChild !== resolvedRoot && !resolvedChild.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail('INVALID_PATH', 'The requested path is outside the save directory.');
  }
  return resolvedChild;
}

function parseSlotFromName(name) {
  for (const descriptor of SLOT_PATTERNS) {
    const match = descriptor.pattern.exec(name);
    if (match) {
      const fileSlot = Number.parseInt(match[1], 10);
      const slot = descriptor.fileBase === 0 ? fileSlot + 1 : fileSlot;
      if (Number.isInteger(slot) && slot > 0 && slot <= 100) {
        const digitMatch = name.match(/\d+/);
        return {
          slot,
          fileSlot,
          fileBase: descriptor.fileBase,
          recognized: true,
          digitWidth: digitMatch ? digitMatch[0].length : 3,
        };
      }
    }
  }
  return { slot: null, fileSlot: null, fileBase: 0, recognized: false, digitWidth: 2 };
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseEmbeddedDate(text) {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [, year, month, day, hour, minute, second = '0'] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)) {
      return date;
    }
  }
  return null;
}

function printableStrings(buffer) {
  const candidates = [];
  const utf8 = buffer.toString('utf8');
  const utf16 = buffer.toString('utf16le');
  let shiftJis = '';
  try {
    shiftJis = new TextDecoder('shift_jis').decode(buffer);
  } catch { /* Node builds without full ICU still support the other decoders */ }
  for (const text of [utf8, utf16, shiftJis]) {
    for (const part of text.split(/[\0\r\n]+/)) {
      const value = part.trim();
      if (value.length < 4 || value.length > 500) continue;
      const printable = [...value].filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
      }).length / value.length;
      if (printable >= 0.9 && !candidates.includes(value)) candidates.push(value);
    }
  }
  return candidates;
}

function embeddedThumbnail(buffer) {
  const jpegStart = buffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (jpegStart >= 0) {
    const jpegEnd = buffer.indexOf(Buffer.from([0xff, 0xd9]), jpegStart + 3);
    if (jpegEnd > jpegStart && jpegEnd - jpegStart <= 2 * 1024 * 1024) {
      return `data:image/jpeg;base64,${buffer.subarray(jpegStart, jpegEnd + 2).toString('base64')}`;
    }
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngStart = buffer.indexOf(pngSignature);
  if (pngStart >= 0) {
    const pngEnd = buffer.indexOf(Buffer.from('IEND'), pngStart + pngSignature.length);
    if (pngEnd > pngStart && pngEnd - pngStart <= 2 * 1024 * 1024) {
      const end = Math.min(buffer.length, pngEnd + 8);
      return `data:image/png;base64,${buffer.subarray(pngStart, end).toString('base64')}`;
    }
  }
  return undefined;
}

function wa2PcThumbnail(buffer) {
  const end = WA2_PC_THUMBNAIL_OFFSET + WA2_PC_THUMBNAIL_BYTES;
  if (buffer.length < end) return undefined;
  // The PC format stores a fixed 128x128 top-down BGRA bitmap, with an opaque
  // alpha byte. Wrapping it as a top-down BMP keeps the save payload intact.
  let opaque = 0;
  for (let offset = WA2_PC_THUMBNAIL_OFFSET + 3; offset < end; offset += 4) {
    if (buffer[offset] === 0xff) opaque += 1;
  }
  if (opaque < WA2_PC_THUMBNAIL_WIDTH * WA2_PC_THUMBNAIL_HEIGHT * 0.95) return undefined;
  const bitmap = Buffer.alloc(54 + WA2_PC_THUMBNAIL_BYTES);
  bitmap.write('BM', 0, 2, 'ascii');
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(WA2_PC_THUMBNAIL_WIDTH, 18);
  bitmap.writeInt32LE(-WA2_PC_THUMBNAIL_HEIGHT, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(32, 28);
  bitmap.writeUInt32LE(WA2_PC_THUMBNAIL_BYTES, 34);
  buffer.copy(bitmap, 54, WA2_PC_THUMBNAIL_OFFSET, end);
  return `data:image/bmp;base64,${bitmap.toString('base64')}`;
}

function wa2CustomCharacterIndex(code) {
  for (const [start, end, location] of WA2_CUSTOM_CODE_RANGES) {
    if (code >= start && code < end) return location + code - start;
  }
  return -1;
}

async function loadWa2ChineseMapping(mappingPath = WA2_CHINESE_MAPPING_PATH) {
  const load = async () => {
    const text = await fs.readFile(mappingPath, 'utf8');
    // The reference decoder removes all Unicode whitespace, including U+3000.
    // Keeping those padding characters shifts every custom glyph mapping.
    return Array.from(text.replace(/^\uFEFF/, '').replace(/\s/gu, ''));
  };
  if (path.resolve(mappingPath) !== path.resolve(WA2_CHINESE_MAPPING_PATH)) return load();
  if (!wa2ChineseMappingPromise) wa2ChineseMappingPromise = load();
  return wa2ChineseMappingPromise;
}

function decodeWa2PatchedText(raw, characterMapping) {
  if (!Buffer.isBuffer(raw) || !Array.isArray(characterMapping)) return '';
  const shiftJis = new TextDecoder('shift_jis');
  let decoded = '';
  for (let offset = 0; offset < raw.length && raw[offset] !== 0; ) {
    const first = raw[offset];
    if (first < 0x80) {
      decoded += String.fromCharCode(first);
      offset += 1;
      continue;
    }
    if (offset + 1 >= raw.length) break;
    const code = raw.readUInt16BE(offset);
    const index = wa2CustomCharacterIndex(code);
    decoded += index >= 0 && index < characterMapping.length
      ? characterMapping[index]
      : shiftJis.decode(raw.subarray(offset, offset + 2));
    offset += 2;
  }
  return decoded;
}

function cleanWa2Message(decoded) {
  return decoded
    .replace(/\0.*$/s, '')
    .replace(/<F\d+/gi, '')
    .replace(/>/g, '')
    .replace(/\|n/gi, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();
}

function defaultGameDirectories() {
  const configured = typeof process.env.WA2_GAME_DIR === 'string' && process.env.WA2_GAME_DIR.trim()
    ? [process.env.WA2_GAME_DIR.trim()]
    : [];
  if (process.platform !== 'win32') return configured;
  const common = [];
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    common.push(
      path.win32.join(drive, 'Game', 'WHITE ALBUM2'),
      path.win32.join(drive, 'Games', 'WHITE ALBUM2'),
      path.win32.join(drive, 'Game', 'WHITE ALBUM 2'),
      path.win32.join(drive, 'Games', 'WHITE ALBUM 2'),
    );
  }
  return [...new Set([...configured, 'E:\\Game\\WHITE ALBUM2', ...common])];
}

async function isChinesePatchDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) return false;
  try {
    const entries = await fs.readdir(path.resolve(directory), { withFileTypes: true });
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
    return WA2_CHINESE_PATCH_FILES.every((name) => files.has(name.toLowerCase()));
  } catch {
    return false;
  }
}

async function detectChineseGameDirectory(candidates) {
  const detect = async (directories) => {
    for (const directory of directories) {
      if (await isChinesePatchDirectory(directory)) return path.resolve(directory);
    }
    return null;
  };
  if (Array.isArray(candidates)) return detect(candidates);
  if (!detectedChineseGameDirectoryPromise) {
    detectedChineseGameDirectoryPromise = detect(defaultGameDirectories());
  }
  return detectedChineseGameDirectoryPromise;
}

function decodeWa2PcMessage(buffer, options = {}) {
  if (buffer.length < WA2_PC_THUMBNAIL_OFFSET) return {};
  const raw = buffer.subarray(24, WA2_PC_THUMBNAIL_OFFSET);
  if (options.characterMapping) {
    const text = cleanWa2Message(decodeWa2PatchedText(raw, options.characterMapping));
    return { text: text || undefined, encoding: text ? 'ck-gal-custom' : undefined };
  }
  let decoded = '';
  try {
    decoded = new TextDecoder('shift_jis').decode(raw);
  } catch {
    decoded = raw.toString('latin1');
  }
  const text = cleanWa2Message(decoded);
  const asciiLetters = (text.match(/[A-Za-z]/g) || []).length;
  if (!/[\u3040-\u30ff]/.test(text) && asciiLetters < 2) return {};
  return { text, encoding: 'shift-jis' };
}

function readWa2PcScriptName(buffer) {
  for (const offset of WA2_PC_SCRIPT_NAME_OFFSETS) {
    if (buffer.length < offset + WA2_PC_SCRIPT_NAME_BYTES) continue;
    const field = buffer.subarray(offset, offset + WA2_PC_SCRIPT_NAME_BYTES);
    const nullOffset = field.indexOf(0);
    const scriptName = field.subarray(0, nullOffset >= 0 ? nullOffset : field.length).toString('ascii');
    if (/^\d{4}(?:_\d+)*$/.test(scriptName)) return scriptName;
  }
  return undefined;
}

function chapterFromWa2ScriptName(scriptName) {
  if (typeof scriptName !== 'string') return undefined;
  if (/^1\d{3}(?:_\d+)*$/.test(scriptName)) return 'Introductory Chapter';
  if (/^2\d{3}(?:_\d+)*$/.test(scriptName)) return 'Closing Chapter';
  if (/^3\d{3}(?:_\d+)*$/.test(scriptName)) return 'CODA';
  return undefined;
}

function parseWa2PcSave(buffer, options = {}) {
  if (buffer.length < WA2_PC_THUMBNAIL_OFFSET + WA2_PC_THUMBNAIL_BYTES || buffer.readUInt32LE(0) !== WA2_PC_VERSION) return null;
  const year = buffer.readUInt16LE(8);
  const month = buffer.readUInt16LE(10);
  const day = buffer.readUInt16LE(14);
  const hour = buffer.readUInt16LE(16);
  const minute = buffer.readUInt16LE(18);
  const second = buffer.readUInt16LE(20);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (year < 2000 || year > 2100 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const thumbnail = wa2PcThumbnail(buffer);
  if (!thumbnail) return null;
  const message = decodeWa2PcMessage(buffer, options);
  const scriptName = readWa2PcScriptName(buffer);
  return {
    date,
    scriptId: buffer.readUInt32LE(4),
    textSnippet: message.text,
    textEncoding: message.encoding,
    scriptName,
    chapter: chapterFromWa2ScriptName(scriptName),
    thumbnail,
  };
}

function parseJsonMetadata(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('{')) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function stableId(relativePath) {
  return crypto.createHash('sha256').update(relativePath.replaceAll('\\', '/').toLowerCase()).digest('hex').slice(0, 24);
}

function makeDestinationName(sourceName, targetSlot) {
  const extension = path.extname(sourceName) || '.dat';
  const parsed = parseSlotFromName(sourceName);
  if (parsed.recognized) {
    const fileSlot = parsed.fileBase === 0 ? targetSlot - 1 : targetSlot;
    const digits = String(fileSlot).padStart(parsed.digitWidth, '0');
    return sourceName.replace(/\d+/, digits);
  }
  return `save_${String(targetSlot - 1).padStart(2, '0')}${extension}`;
}

async function uniqueBackupPath(filePath) {
  const first = `${filePath}.bak`;
  try {
    await fs.access(first);
  } catch {
    return first;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${filePath}.bak.${index}`;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  fail('BACKUP_FAILED', `Unable to allocate a backup name for ${path.basename(filePath)}.`);
}

async function backupFile(filePath) {
  const destination = await uniqueBackupPath(filePath);
  await fs.copyFile(filePath, destination);
  return destination;
}

function patchSlotField(buffer, slot, descriptor) {
  if (!descriptor || !Number.isInteger(descriptor.offset) || descriptor.offset < 0) return buffer;
  const width = descriptor.width === 2 || descriptor.width === 4 ? descriptor.width : 1;
  if (descriptor.offset + width > buffer.length) {
    fail('SLOT_FIELD_INVALID', 'The configured slot field is outside the save payload.');
  }
  const copy = Buffer.from(buffer);
  const endian = descriptor.endian === 'be' ? 'BE' : 'LE';
  const method = `writeUInt${width * 8}${endian}`;
  if (typeof copy[method] !== 'function') fail('SLOT_FIELD_INVALID', 'Unsupported slot field width.');
  if (descriptor.expected !== undefined && copy[`readUInt${width * 8}${endian}`](descriptor.offset) !== descriptor.expected) {
    fail('SLOT_FIELD_MISMATCH', 'The save does not match the configured slot-field signature.');
  }
  copy[method](slot, descriptor.offset);
  return copy;
}

async function readSidecar(filePath) {
  const sidecarPath = `${filePath}.json`;
  try {
    const text = await fs.readFile(sidecarPath, 'utf8');
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function readSample(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function parseSaveFile(root, entry, index, options = {}) {
  const relativePath = path.relative(root, entry).replaceAll('\\', '/');
  const name = path.basename(entry);
  const parsedName = parseSlotFromName(name);
  const stat = await fs.stat(entry);
  const inspect = await readSample(entry, options.inspectBytes || 1024 * 1024);
  const wa2 = parseWa2PcSave(inspect, options);
  // The verified WA2 layout already gives us its date, scene id and bitmap.
  // Avoid running three full-buffer text decoders for every 348 KB save.
  const strings = wa2 ? [] : printableStrings(inspect);
  const metadata = (await readSidecar(entry)) || parseJsonMetadata(inspect) || {};
  const embeddedDate = wa2?.date || parseEmbeddedDate(strings.join('\n'));
  const slot = Number.isInteger(metadata.slot) && metadata.slot > 0 ? metadata.slot : (parsedName.slot || index + 1);
  const routeMarker = wa2 ? undefined : inspect.toString('utf8').match(/\b(?:IC|CC|CODA)\b/i)?.[0];
  const route = typeof metadata.route === 'string' ? metadata.route : (wa2?.chapter || strings.find((value) => ROUTE_PATTERN.test(value)) || routeMarker || 'Unknown');
  const fallbackTextSnippet = typeof metadata.textSnippet === 'string'
    ? metadata.textSnippet
    : (strings
      .filter((value) => !/^https?:\/\//i.test(value) && !ROUTE_PATTERN.test(value) && !parseEmbeddedDate(value))
      .sort((a, b) => b.length - a.length)[0] || '未解析存档文本');
  const textSnippet = typeof metadata.textSnippet === 'string'
    ? metadata.textSnippet
    : (wa2?.textSnippet || (wa2 ? '文本未解析' : fallbackTextSnippet));
  const modified = embeddedDate || stat.mtime;
  return {
    id: stableId(relativePath),
    empty: false,
    slot,
    date: typeof metadata.date === 'string' ? metadata.date : formatDate(modified),
    thumbnail: typeof metadata.thumbnail === 'string' ? metadata.thumbnail : (wa2?.thumbnail || embeddedThumbnail(inspect)),
    textSnippet,
    route,
    fileName: name,
    relativePath,
    size: stat.size,
    format: metadata.format || (wa2 ? 'wa2-pc-v2' : 'opaque'),
    scriptId: wa2?.scriptId,
    scriptName: wa2?.scriptName,
    textEncoding: wa2?.textEncoding,
    recognized: parsedName.recognized,
    modifiedAt: stat.mtime.toISOString(),
    warnings: parsedName.recognized ? [] : ['文件名未匹配已知存档命名规则，槽位按扫描顺序推断'],
  };
}

function materializeSlots(saves, maxSlots = MAX_SAVE_SLOTS) {
  const bySlot = new Map();
  for (const save of saves) {
    if (Number.isInteger(save.slot) && save.slot >= 1 && save.slot <= maxSlots && !bySlot.has(save.slot)) {
      bySlot.set(save.slot, save);
    }
  }
  return Array.from({ length: maxSlots }, (_, index) => {
    const slot = index + 1;
    return bySlot.get(slot) || {
      id: `empty-slot-${String(slot).padStart(3, '0')}`,
      empty: true,
      slot,
      date: '',
      textSnippet: '',
      route: '',
      format: 'empty',
      warnings: [],
    };
  });
}

async function prepareListOptions(options = {}) {
  if (options.characterMapping) return options;
  let gameDirectory = options.gameDirectory;
  let useChinesePatch = options.useChinesePatch;
  if (useChinesePatch !== false) {
    if (!gameDirectory) gameDirectory = await detectChineseGameDirectory();
    if (useChinesePatch === true || (gameDirectory && await isChinesePatchDirectory(gameDirectory))) {
      useChinesePatch = true;
    }
  }
  return {
    ...options,
    gameDirectory,
    characterMapping: useChinesePatch ? await loadWa2ChineseMapping(options.mappingPath) : undefined,
  };
}

async function listSaves(directory, options = {}) {
  const root = normalizeRoot(directory);
  const preparedOptions = await prepareListOptions(options);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    fail('READ_FAILED', `Unable to read save directory: ${error.message}`);
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .filter((entry) => !/^(?:Sys|save_Q)\.sav$/i.test(entry.name))
    .filter((entry) => !entry.name.toLowerCase().endsWith('.bak'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const saves = [];
  for (let index = 0; index < files.length; index += 1) {
    try {
      saves.push(await parseSaveFile(root, path.join(root, files[index].name), index, preparedOptions));
    } catch (error) {
      if (options.skipUnreadable !== false) continue;
      throw error;
    }
  }
  const sorted = saves.sort((a, b) => a.slot - b.slot || a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
  return preparedOptions.includeEmpty ? materializeSlots(sorted, preparedOptions.maxSlots || MAX_SAVE_SLOTS) : sorted;
}

function validateSlot(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 100) fail('INVALID_SLOT', 'Slot must be an integer between 1 and 100.');
}

async function resolveRecords(root, ids, options = {}) {
  const saves = await listSaves(root, { ...options, includeEmpty: false });
  const byId = new Map(saves.map((save) => [save.id, save]));
  return ids.map((id) => {
    const record = byId.get(id);
    if (!record) fail('SAVE_NOT_FOUND', `Save ${id} was not found.`, { id });
    return record;
  });
}

async function atomicWrite(filePath, buffer) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const handle = await fs.open(temporary, 'w');
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function reorderSaves(directory, orderedIds, options = {}) {
  const root = normalizeRoot(directory);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { saves: await listSaves(root), backups: [] };
  const records = await resolveRecords(root, orderedIds, options);
  const seen = new Set();
  for (const id of orderedIds) {
    if (seen.has(id)) fail('DUPLICATE_ID', 'A save can only appear once in a reorder operation.');
    seen.add(id);
  }
  const targetSlots = records.map((record) => record.slot).sort((a, b) => a - b);
  const moves = records.map((record, index) => ({ id: record.id, targetSlot: targetSlots[index] }));
  return moveSaves(root, moves, options);
}

async function moveSaves(directory, moves, options = {}) {
  const root = normalizeRoot(directory);
  if (!Array.isArray(moves) || moves.length === 0) return { saves: await listSaves(root), backups: [] };
  const moveIds = moves.map((move) => move.id);
  if (new Set(moveIds).size !== moveIds.length) fail('DUPLICATE_ID', 'A save can only appear once in a move operation.');
  const records = await resolveRecords(root, moveIds, options);
  const byId = new Map(records.map((record) => [record.id, record]));
  const destinations = new Map();
  for (const move of moves) {
    validateSlot(move.targetSlot);
    if (destinations.has(move.targetSlot)) fail('DUPLICATE_SLOT', 'Two saves cannot use the same destination slot.');
    const record = byId.get(move.id);
    const targetName = makeDestinationName(record.fileName, move.targetSlot);
    destinations.set(move.targetSlot, { record, targetName, targetPath: safeChild(root, targetName), targetSlot: move.targetSlot });
  }
  const sourcePaths = new Set(records.map((record) => safeChild(root, record.relativePath)));
  for (const destination of destinations.values()) {
    try {
      await fs.access(destination.targetPath);
      if (!sourcePaths.has(destination.targetPath) && options.overwrite !== true) {
        fail('DESTINATION_EXISTS', `Destination ${destination.targetName} already exists.`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const backups = [];
  if (options.backup !== false) {
    for (const record of records) backups.push(await backupFile(safeChild(root, record.relativePath)));
    if (options.overwrite === true) {
      for (const destination of destinations.values()) {
        if (!sourcePaths.has(destination.targetPath)) {
          try { backups.push(await backupFile(destination.targetPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
    }
  }
  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const temporaryPaths = [];
  try {
    for (const record of records) {
      const sourcePath = safeChild(root, record.relativePath);
      const temporary = safeChild(root, `.${record.fileName}.${token}.tmp`);
      await fs.rename(sourcePath, temporary);
      temporaryPaths.push({ record, temporary });
    }
    for (const destination of destinations.values()) {
      if (options.overwrite === true && !sourcePaths.has(destination.targetPath)) {
        await fs.rm(destination.targetPath, { force: true });
      }
    }
    for (const item of temporaryPaths) {
      const destination = [...destinations.values()].find((candidate) => candidate.record.id === item.record.id);
      const payload = options.slotField ? patchSlotField(await fs.readFile(item.temporary), destination.targetSlot, options.slotField) : null;
      if (payload) await atomicWrite(item.temporary, payload);
      await fs.rename(item.temporary, destination.targetPath);
    }
  } catch (error) {
    for (const item of temporaryPaths) {
      try {
        const original = safeChild(root, item.record.relativePath);
        await fs.rename(item.temporary, original);
      } catch { /* best-effort recovery; backups remain available */ }
    }
    throw error;
  }
  return { saves: await listSaves(root, options), backups };
}

async function copySaves(directory, ids, options = {}) {
  const root = normalizeRoot(directory);
  const records = await resolveRecords(root, ids, options);
  const usedSlots = new Set((await listSaves(root, { ...options, includeEmpty: false })).map((save) => save.slot));
  const targets = options.targetSlots || records.map(() => {
    let slot = 1;
    while (usedSlots.has(slot)) slot += 1;
    usedSlots.add(slot);
    return slot;
  });
  if (!Array.isArray(targets) || targets.length !== records.length) fail('INVALID_TARGETS', 'One target slot is required for every copied save.');
  const backups = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    validateSlot(targets[index]);
    const destination = safeChild(root, makeDestinationName(record.fileName, targets[index]));
    let destinationExists = false;
    try {
      await fs.access(destination);
      destinationExists = true;
      if (options.overwrite !== true) fail('DESTINATION_EXISTS', `Destination ${path.basename(destination)} already exists.`);
      if (options.backup !== false) backups.push(await backupFile(destination));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const source = await fs.readFile(safeChild(root, record.relativePath));
    const payload = options.slotField ? patchSlotField(source, targets[index], options.slotField) : source;
    if (destinationExists) await fs.rm(destination, { force: true });
    await atomicWrite(destination, payload);
  }
  return { saves: await listSaves(root, options), backups };
}

async function deleteSaves(directory, ids, options = {}) {
  const root = normalizeRoot(directory);
  const records = await resolveRecords(root, ids, options);
  const backups = [];
  for (const record of records) {
    const filePath = safeChild(root, record.relativePath);
    if (options.backup !== false) backups.push(await backupFile(filePath));
    await fs.unlink(filePath);
  }
  return { saves: await listSaves(root, options), backups };
}

function defaultSaveDirectories() {
  const documents = path.join(os.homedir(), 'Documents');
  return [
    path.join(documents, 'Leaf', 'WHITE ALBUM2'),
    path.join(documents, 'Leaf', 'WHITE ALBUM 2'),
    path.join(documents, 'White Album 2'),
    path.join(documents, 'WHITE ALBUM 2'),
    path.join(documents, 'AQUAPLUS', 'WHITE ALBUM2'),
    path.join(documents, 'save'),
  ];
}

async function discoverSaveDirectories(options = {}) {
  const candidates = [...new Set(defaultSaveDirectories())];
  const result = [];
  for (const directory of candidates) {
    try {
      const stat = await fs.stat(directory);
      if (stat.isDirectory()) result.push({ path: directory, saves: await listSaves(directory, options) });
    } catch { /* candidate does not exist */ }
  }
  return result;
}

class SaveService {
  constructor() {
    this.queue = Promise.resolve();
  }

  run(task) {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  list(directory, options) { return this.run(() => listSaves(directory, options)); }
  move(directory, moves, options) { return this.run(() => moveSaves(directory, moves, options)); }
  reorder(directory, ids, options) { return this.run(() => reorderSaves(directory, ids, options)); }
  copy(directory, ids, options) { return this.run(() => copySaves(directory, ids, options)); }
  delete(directory, ids, options) { return this.run(() => deleteSaves(directory, ids, options)); }
}

module.exports = {
  SaveService,
  SaveServiceError,
  listSaves,
  moveSaves,
  reorderSaves,
  copySaves,
  deleteSaves,
  discoverSaveDirectories,
  defaultSaveDirectories,
  defaultGameDirectories,
  detectChineseGameDirectory,
  isChinesePatchDirectory,
  loadWa2ChineseMapping,
  decodeWa2PatchedText,
  cleanWa2Message,
  readWa2PcScriptName,
  chapterFromWa2ScriptName,
  materializeSlots,
  patchSlotField,
  parseSlotFromName,
};
