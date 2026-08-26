import { deflateRawSync } from "node:zlib";

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(index) {
  let n = index + 1;
  let text = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function sheetXml(grid) {
  const rows = grid.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${colLetter(colIndex)}${rowIndex + 1}`;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value ?? "")}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const [name, text] of Object.entries(files)) {
    const data = encoder.encode(text);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const nameBytes = encoder.encode(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const localPart = Buffer.concat([local, Buffer.from(nameBytes), compressed]);
    chunks.push(localPart);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 8);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, Buffer.from(nameBytes)]));
    offset += localPart.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

export function buildWorkbookXlsx(sheets) {
  const names = Object.keys(sheets);
  const sheetFiles = {};
  names.forEach((name, index) => {
    sheetFiles[`xl/worksheets/sheet${index + 1}.xml`] = sheetXml(sheets[name]);
  });
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names.map((name, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
</Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
  return zip({
    "[Content_Types].xml": types,
    "_rels/.rels": rootRels,
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": rels,
    ...sheetFiles,
  });
}

export function fakeHouseholdWorkbook() {
  return {
    Main: [
      ["Item", "Month", "Cost", "Purchased", "", "skip", "skip"],
      ["MOT", "August 2026", 180, false],
      ["Sofa", "December 2026", 400, false],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      ["Main Table"],
      [],
      [],
      [],
      ["What", "In and Out", "Allowed Expenses", "Credit Card", "Expense Month lookup", "Planned Day of Month", "Planned Date", "", "", "", "", "", "", "", "", "", "Happened", "Section"],
      ["Income"],
      ["Alex take-home", 2500, "", "", "", 25, "", "", "", "", "", "", "", "", "", "", false, "Income"],
      ["Sam take-home", 1800, "", "", "", 25, "", "", "", "", "", "", "", "", "", "", false, "Income"],
      ["Cash Out"],
      ["Mortgage", 900, "", "", "", 1, "", "", "", "", "", "", "", "", "", "", true, "Cash Out"],
      ["Council tax", 140, "", "", "", 10, "", "", "", "", "", "", "", "", "", "", false, "Cash Out"],
      ["Weekly Expenses"],
      ["Food shop", 70, "", "", "", "", "", "", "", "", "", "", "", "", "", "", true, "Weekly Expenses"],
      ["Monthly Expenses"],
      ["MOT", 180, "", "", "", "", "", "", "", "", "", "", "", "", "", "", false, "Monthly Expenses"],
      ["Phone contract", 35, "", "", "", 8, "", "", "", "", "", "", "", "", "", "", false, "Monthly Expenses"],
      ["Credit Card Out"],
      ["Streaming", 12, "", "", "", 5, "", "", "", "", "", "", "", "", "", "", false, "Credit Card Out"],
      ["Pending"],
      ["Flight hold", 60, "", "", "", "", "", "", "", "", "", "", "", "", "", "", false, "Pending"],
      ["Credit Card"],
      ["Card one", 220, "", 220, "", "", "", "", "", "", "", "", "", "", "", "", false, "Credit Card"],
      ["Cash in Reserve"],
      ["Insurance saving", 80, "", "", "", "", "", "", "", "", "", "", "", "", "", "", false, "Cash in Reserve"],
      ["Post 1st"],
      ["Table 1"],
    ],
    Payslips: [
      ["Name", "Tax Year", "Start Date", "Month", "Pay Period", "Tax Code", "Salary", "Gross Per Month", "Bonus", "Benefits", "Salary Sacrifice Pension", "Tax", "NI", "Net", "Note", "Month of money", "Cycle scheme"],
      ["Alex", "2026-27", "2026-04-01", "April", "2026-04", "1257L", 3500, 3500, 0, 0, 200, 600, 280, 2420, "", "2026-04", 40],
      ["Alex", "2026-27", "2026-09-01", "September", "2026-09", "1257L", 3500, 3500, 0, 0, 200, 600, 280, 2420, "TEMP forecast", "2026-09", 0],
    ],
    Annually: [
      ["For what", "Who gets paid", "How much", "Renewal time"],
      ["Car insurance", "Insurer", 1200, "March"],
      ["Total", "", 1200, ""],
    ],
    "Where's the money": [
      ["Pot", "2026-01-01", "2026-08-01", "", "Pension", "Status", "Person", "Last value", "Date"],
      ["Emergency", 1000, 1500, "", "Workplace", "active", "Alex", 8000, "2026-08-01"],
      ["Bills", "", 400, "", "", "", "", "", ""],
    ],
    Charity: [
      ["Who Gave", "Donation", "Date", "Tax Year", "Amount", "Gift Aid", "Gross"],
      ["Alex", "Example Trust", "2026-05-02", "2026-27", 80, true, 100],
      ["", "", "", "", -1, "", ""],
    ],
  };
}
