/** Minimal xlsx reader: sheet cells from a workbook ArrayBuffer. No extra packages. */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import("node:zlib");
  return zlib.inflateRawSync(Buffer.from(bytes));
}

export async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const files = {};
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig === CENTRAL_SIG || sig === 0x06054b50) break;
    if (sig !== LOCAL_SIG) break;
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const start = offset + 30 + nameLen + extraLen;
    const payload = bytes.subarray(start, start + compressed);
    let content = payload;
    if (method === 8) content = await inflateRaw(payload);
    else if (method !== 0) throw new Error(`Unsupported zip method ${method}.`);
    files[name] = decoder.decode(content);
    offset = start + compressed;
  }
  return files;
}

const decoder = new TextDecoder("utf-8");

function xmlEscapeDecode(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const si = xml.match(/<si\b[\s\S]*?<\/si>/g) || [];
  for (const block of si) {
    const parts = [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => xmlEscapeDecode(match[1]));
    strings.push(parts.join(""));
  }
  return strings;
}

function colRow(ref) {
  const match = String(ref).match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(match[2]) - 1 };
}

function cellValue(cellXml, shared) {
  const type = (cellXml.match(/\bt="([^"]+)"/) || [])[1] || "";
  const inline = cellXml.match(/<is\b[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
  if (inline) return xmlEscapeDecode(inline[1]);
  const raw = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
  if (!raw) return "";
  const value = raw[1];
  if (type === "s") return shared[Number(value)] || "";
  if (type === "b") return value === "1" ? true : false;
  if (type === "str" || type === "inlineStr") return xmlEscapeDecode(value);
  if (value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : xmlEscapeDecode(value);
}

export function sheetToGrid(xml, shared = []) {
  const cells = xml.match(/<c\b[\s\S]*?<\/c>/g) || [];
  let width = 0;
  let height = 0;
  const placed = [];
  for (const cell of cells) {
    const ref = (cell.match(/\br="([A-Z]+\d+)"/) || [])[1];
    const pos = colRow(ref);
    if (!pos) continue;
    const value = cellValue(cell, shared);
    placed.push({ ...pos, value });
    width = Math.max(width, pos.col + 1);
    height = Math.max(height, pos.row + 1);
  }
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ""));
  for (const cell of placed) grid[cell.row][cell.col] = cell.value;
  return grid;
}

export async function readXlsx(buffer) {
  const files = await unzip(buffer);
  const workbook = files["xl/workbook.xml"];
  if (!workbook) throw new Error("That file is not a workbook.");
  const shared = parseSharedStrings(files["xl/sharedStrings.xml"]);
  const names = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*\/?>/g)].map((match) => xmlEscapeDecode(match[1]));
  const rels = files["xl/_rels/workbook.xml.rels"] || "";
  const ridToTarget = {};
  for (const match of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    ridToTarget[match[1]] = match[2].replace(/^\//, "").replace(/^\.\//, "");
  }
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = xmlEscapeDecode((tag.match(/name="([^"]+)"/) || [])[1] || "");
    const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
    if (!name || !rid) continue;
    const target = ridToTarget[rid];
    if (!target) continue;
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    const sheetXml = files[path];
    if (sheetXml) names[names.indexOf(name)] = name;
  }
  const sheets = {};
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = xmlEscapeDecode((tag.match(/name="([^"]+)"/) || [])[1] || "");
    const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
    const target = ridToTarget[rid];
    if (!name || !target) continue;
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    if (!files[path]) continue;
    sheets[name] = sheetToGrid(files[path], shared);
  }
  return { sheetNames: Object.keys(sheets), sheets };
}

export function excelSerialToIso(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}
