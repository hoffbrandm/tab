import {
  emptyHousehold,
  isoDate,
  monthKey,
  ukTaxYearFromDate,
} from "./household.js";

const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MAIN_TICK_COL = 16;
const MAIN_SECTION_COL = 17;
const PAYSLIP_SOURCE_COLS = 31;
const SECTION_NAMES = [
  "income",
  "cash out",
  "cash in reserve",
  "credit card out",
  "weekly expenses",
  "monthly expenses",
  "exceptions",
  "pending",
  "credit card",
];

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function text(value) {
  if (value == null || value === false) return "";
  if (value === true) return "TRUE";
  return String(value).trim();
}

function isExcelError(value) {
  const raw = text(value).toLowerCase();
  return raw.startsWith("#") || raw === "-1/0" || raw === "1/0";
}

function moneyToPence(value) {
  if (value == null || value === "") return 0;
  if (isExcelError(value)) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const cleaned = String(value).replace(/[£,\s]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function hasRecordedMoney(value) {
  if (value == null || value === "") return false;
  if (typeof value === "boolean") return false;
  if (isExcelError(value)) return false;
  return true;
}

function truthy(value) {
  if (value === true || value === 1) return true;
  const textValue = text(value).toLowerCase();
  return textValue === "true" || textValue === "yes" || textValue === "y" || textValue === "1";
}

function asMonth(value, fallbackYear = new Date().getFullYear()) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    const iso = excelishDate(value);
    return iso ? iso.slice(0, 7) : "";
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  const named = raw.toLowerCase();
  if (MONTH_NAMES[named]) return `${fallbackYear}-${String(MONTH_NAMES[named]).padStart(2, "0")}`;
  const pair = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (pair && MONTH_NAMES[pair[1].toLowerCase()]) {
    return `${pair[2]}-${String(MONTH_NAMES[pair[1].toLowerCase()]).padStart(2, "0")}`;
  }
  return "";
}

function excelishDate(value) {
  if (typeof value !== "number" || value < 20000 || value > 80000) return "";
  const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function asDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") return excelishDate(value);
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const uk = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  return "";
}

function headerIndex(row, aliases, options = {}) {
  const { from = 0, to = Infinity } = options;
  const cells = (row || []).map((cell) => text(cell).toLowerCase().replace(/\s+/g, " "));
  const end = Math.min(cells.length, to);
  const wanted = (Array.isArray(aliases) ? aliases : [aliases]).map((alias) => alias.toLowerCase());
  for (const alias of wanted) {
    const index = cells.findIndex((cell, index) => index >= from && index < end && cell === alias);
    if (index >= 0) return index;
  }
  for (const alias of wanted) {
    const index = cells.findIndex((cell, index) => index >= from && index < end && cell.includes(alias));
    if (index >= 0) return index;
  }
  return -1;
}

function findRow(grid, ...needles) {
  return grid.findIndex((row) => {
    const joined = (row || []).map((cell) => text(cell).toLowerCase()).join(" | ");
    return needles.every((needle) => joined.includes(needle.toLowerCase()));
  });
}

function findSheet(sheets, ...aliases) {
  const keys = Object.keys(sheets || {});
  for (const alias of aliases) {
    const match = keys.find((key) => key.toLowerCase() === alias.toLowerCase());
    if (match) return { name: match, grid: sheets[match] };
  }
  for (const alias of aliases) {
    const match = keys.find((key) => key.toLowerCase().includes(alias.toLowerCase()));
    if (match) return { name: match, grid: sheets[match] };
  }
  return null;
}

function personIdFor(household, name) {
  const wanted = text(name) || "You";
  const existing = household.people.find((person) => person.name.toLowerCase() === wanted.toLowerCase());
  if (existing) return existing.id;
  const person = { id: uid(), name: wanted };
  household.people.push(person);
  return person.id;
}

function personFromIncomeLabel(household, name) {
  const cleaned = text(name).replace(/\s+(take-?home|salary|income|pay|net)$/i, "").trim();
  return personIdFor(household, cleaned || name);
}

function skipRowName(name) {
  const value = text(name).toLowerCase();
  if (!value) return true;
  return (
    value.startsWith("total")
    || value === "what"
    || value === "item"
    || value === "expected"
    || value === "main table"
    || value === "post 1st"
    || value === "table 1"
    || value.includes("index")
    || value.includes("lookup")
  );
}

function markSkipped(report, why) {
  report.skipped += 1;
  if (why && !report.skippedWhy.includes(why)) report.skippedWhy.push(why);
}

function isSinkingFundLine(name, annualBills) {
  const value = text(name).toLowerCase();
  if (!value) return false;
  if (value.includes("insurance saving") || value.includes("sinking fund") || value.includes("annual reserve")) {
    return true;
  }
  return (annualBills || []).some((bill) => {
    const billName = text(bill.name).toLowerCase();
    return billName && value.includes(billName) && /(saving|reserve|sinking)/.test(value);
  });
}

function importExpected(grid, household, report) {
  const header = findRow(grid, "item", "purchased");
  if (header < 0) return;
  const row = grid[header];
  const itemCol = headerIndex(row, ["item"]);
  const monthCol = headerIndex(row, ["month"]);
  const costCol = headerIndex(row, ["cost", "amount"]);
  const boughtCol = headerIndex(row, ["purchased"]);
  const year = new Date().getFullYear();
  for (let index = header + 1; index < Math.min(grid.length, header + 18); index += 1) {
    const cells = grid[index] || [];
    const name = text(cells[itemCol]);
    if (skipRowName(name) || name.toLowerCase() === "expected") break;
    if (!name) continue;
    const month = asMonth(cells[monthCol], year);
    if (!month && !hasRecordedMoney(cells[costCol])) continue;
    household.oneOffs.push({
      id: uid(),
      name,
      month: month || `${year}-01`,
      estimatePence: moneyToPence(cells[costCol]),
      purchased: truthy(cells[boughtCol]),
    });
    report.oneOffs += 1;
  }
}

function importMainTable(grid, household, report) {
  const header = findRow(grid, "what", "in and out") >= 0
    ? findRow(grid, "what", "in and out")
    : findRow(grid, "what");
  if (header < 0) return;
  const row = grid[header];
  const what = headerIndex(row, ["what"]);
  const amount = headerIndex(row, ["in and out"]);
  const allowed = headerIndex(row, ["allowed expenses"]);
  const cardCol = headerIndex(row, ["credit card"]);
  const dayCol = headerIndex(row, ["planned day of month", "planned day", "due"]);
  const labelledTick = headerIndex(row, ["happened", "paid", "tick"]);
  const labelledSection = headerIndex(row, ["section", "category"]);
  const tickCol = labelledTick >= 0 ? labelledTick : MAIN_TICK_COL;
  const sectionCol = labelledSection >= 0 ? labelledSection : MAIN_SECTION_COL;
  const expectedNames = new Set(household.oneOffs.map((item) => item.name.toLowerCase()));
  const annualBills = household.annualBills || [];
  let section = "";
  const month = monthKey();

  for (let index = header + 1; index < grid.length; index += 1) {
    const cells = grid[index] || [];
    const name = text(cells[what] ?? cells[0]);
    const sectionHint = text(cells[sectionCol]);
    if (sectionHint) section = sectionHint;
    const sectionLike = SECTION_NAMES.includes(name.toLowerCase());
    if (sectionLike) {
      section = name;
      continue;
    }
    if (skipRowName(name)) {
      if (name) markSkipped(report, "scratch");
      continue;
    }
    const bucket = section.toLowerCase();
    const amountCell = hasRecordedMoney(cells[amount]) ? cells[amount] : cells[allowed];
    const pence = bucket === "credit card" && !bucket.includes("out") && hasRecordedMoney(cells[cardCol])
      ? moneyToPence(cells[cardCol])
      : moneyToPence(hasRecordedMoney(amountCell) ? amountCell : cells[cardCol]);
    if (!name || (!pence && !hasRecordedMoney(amountCell) && !hasRecordedMoney(cells[cardCol]))) {
      if (name) markSkipped(report, "empty template");
      continue;
    }
    const dueDay = Number(cells[dayCol]) || 1;
    const ticked = truthy(cells[tickCol]);

    if (bucket.includes("income")) {
      household.incomes.push({
        id: uid(),
        personId: personFromIncomeLabel(household, name),
        label: name,
        amountPence: pence,
      });
      report.incomes += 1;
      continue;
    }
    if (bucket.includes("weekly")) {
      household.envelopes.push({
        id: uid(),
        name,
        weeklyPence: pence,
        happenedDates: ticked ? [`${month}-01`] : [],
      });
      report.envelopes += 1;
      continue;
    }
    if (bucket.includes("credit card out")) {
      household.cardSubs.push({
        id: uid(),
        name,
        amountPence: pence,
        dueDay,
        paidMonths: ticked ? [month] : [],
      });
      report.cardSubs += 1;
      continue;
    }
    if (bucket.includes("pending")) {
      household.pendings.push({ id: uid(), name, amountPence: pence });
      report.pendings += 1;
      continue;
    }
    if (bucket === "credit card") {
      household.cards.push({
        id: uid(),
        name,
        balancePence: pence,
        pendingPence: 0,
        updatedOn: isoDate(),
      });
      report.cards += 1;
      continue;
    }
    if (bucket.includes("cash in reserve") || bucket.includes("exceptions") || isSinkingFundLine(name, annualBills)) {
      markSkipped(report, bucket.includes("exceptions") ? "exceptions" : "annual reserve");
      continue;
    }
    if (bucket.includes("monthly") && expectedNames.has(name.toLowerCase())) {
      markSkipped(report, "Expected lookups");
      continue;
    }
    if (bucket.includes("cash out") || bucket.includes("monthly")) {
      household.bills.push({
        id: uid(),
        name,
        amountPence: pence,
        dueDay,
        paidMonths: ticked ? [month] : [],
      });
      report.bills += 1;
    }
  }
}

function importPayslips(grid, household, report) {
  if (!grid?.length) return;
  const header = findRow(grid, "name", "tax year");
  if (header < 0) return;
  const row = grid[header];
  const inLedger = { to: PAYSLIP_SOURCE_COLS };
  const col = {
    name: headerIndex(row, ["name"], inLedger),
    taxYear: headerIndex(row, ["tax year"], inLedger),
    period: headerIndex(row, ["pay period", "month"], inLedger),
    start: headerIndex(row, ["start date"], inLedger),
    taxCode: headerIndex(row, ["tax code"], inLedger),
    salary: headerIndex(row, ["salary"], inLedger),
    gross: headerIndex(row, ["gross per month", "gross"], inLedger),
    bonus: headerIndex(row, ["bonus"], inLedger),
    benefits: headerIndex(row, ["benefits"], inLedger),
    sacrifice: headerIndex(row, ["salary sacrifice pension"], inLedger),
    tax: headerIndex(row, ["tax"], inLedger),
    ni: headerIndex(row, ["ni"], inLedger),
    net: headerIndex(row, ["net"], inLedger),
    note: headerIndex(row, ["note"], inLedger),
    lands: headerIndex(row, ["month of money", "month the money"], inLedger),
  };
  const deductionHeaders = [
    "will writing",
    "critical illness ee",
    "critical illness dp",
    "payroll giving",
    "gym flex",
    "dental",
    "cycle scheme",
    "jury service",
    "smp",
    "enhanced maternity",
    "enhanced paternity",
    "ospp",
    "non salary sacrifice pension",
  ];
  const deductionCols = deductionHeaders
    .map((label) => ({ label, index: headerIndex(row, [label], inLedger) }))
    .filter((item) => item.index >= 0 && item.index < PAYSLIP_SOURCE_COLS);

  for (let index = header + 1; index < grid.length; index += 1) {
    const cells = grid[index] || [];
    const name = text(cells[col.name]);
    if (!name || skipRowName(name)) continue;
    if (!moneyToPence(cells[col.gross]) && !moneyToPence(cells[col.salary]) && !moneyToPence(cells[col.net])) {
      continue;
    }
    const periodMonth = asMonth(cells[col.period] || cells[col.start]) || monthKey();
    const note = text(cells[col.note]);
    const forecast = /temp|forecast|future\s+leave|future leave/i.test(note);
    const otherDeductions = deductionCols.map((item) => ({
      id: uid(),
      label: item.label.replace(/\b\w/g, (char) => char.toUpperCase()),
      amountPence: moneyToPence(cells[item.index]),
    })).filter((item) => item.amountPence);
    household.payslips.push({
      id: uid(),
      personId: personIdFor(household, name),
      taxYear: text(cells[col.taxYear]) || ukTaxYearFromDate(`${periodMonth}-15`),
      periodMonth,
      salaryPence: moneyToPence(cells[col.salary]),
      grossPence: moneyToPence(cells[col.gross]),
      bonusPence: moneyToPence(cells[col.bonus]),
      benefitsPence: moneyToPence(cells[col.benefits]),
      salarySacrificePensionPence: moneyToPence(cells[col.sacrifice]),
      otherDeductions,
      taxPence: moneyToPence(cells[col.tax]),
      niPence: moneyToPence(cells[col.ni]),
      netPence: moneyToPence(cells[col.net]),
      note,
      moneyLandsMonth: asMonth(cells[col.lands]) || periodMonth,
      forecast,
      taxCode: text(cells[col.taxCode]),
    });
    report.payslips += 1;
  }
}

function importAnnually(grid, household, report) {
  if (!grid?.length) return;
  const header = findRow(grid, "for what") >= 0 ? findRow(grid, "for what") : findRow(grid, "what");
  if (header < 0) return;
  const row = grid[header];
  const nameCol = headerIndex(row, ["for what", "what"]);
  const amountCol = headerIndex(row, ["how much", "amount"]);
  const whenCol = headerIndex(row, ["renewal time", "month"]);
  for (let index = header + 1; index < grid.length; index += 1) {
    const cells = grid[index] || [];
    const name = text(cells[nameCol]);
    if (skipRowName(name) || name.toLowerCase().includes("total")) continue;
    const amountPence = moneyToPence(cells[amountCol]);
    if (!amountPence) continue;
    const month = Number(asMonth(cells[whenCol], 2026).slice(5)) || undefined;
    const item = { id: uid(), name, amountPence };
    if (month) item.month = month;
    household.annualBills.push(item);
    report.annualBills += 1;
  }
}

function looksLikeIdentifierHeader(label) {
  const value = text(label).toLowerCase();
  return /policy|ni number|nino|national insurance/.test(value);
}

function importPots(grid, household, report) {
  if (!grid?.length) return;
  const header = grid[0] || [];
  const dates = header
    .map((cell, index) => ({ index, date: asDate(cell) || (asMonth(cell) ? `${asMonth(cell)}-01` : "") }))
    .filter((item) => item.index > 0 && item.date);
  if (dates.length) {
    for (let index = 1; index < grid.length; index += 1) {
      const cells = grid[index] || [];
      const name = text(cells[0]);
      if (skipRowName(name) || /pension|policy|ni number|nino/i.test(name)) break;
      let latest = null;
      for (const date of dates) {
        if (!hasRecordedMoney(cells[date.index])) continue;
        latest = { amountPence: moneyToPence(cells[date.index]), updatedOn: date.date };
      }
      if (!latest) continue;
      household.pots.push({ id: uid(), name, ...latest });
      report.pots += 1;
    }
  }

  const pensionHeader = findRow(grid, "pension") >= 0 ? findRow(grid, "pension") : findRow(grid, "status");
  if (pensionHeader < 0) return;
  const row = grid[pensionHeader];
  const nameCol = headerIndex(row, ["pension"]);
  const statusCol = headerIndex(row, ["status"]);
  const valueCol = headerIndex(row, ["last value", "value", "amount"]);
  const dateCol = headerIndex(row, ["date", "as at"]);
  const personCol = headerIndex(row, ["person", "who"]);
  for (let index = pensionHeader + 1; index < grid.length; index += 1) {
    const cells = grid[index] || [];
    const name = text(nameCol >= 0 ? cells[nameCol] : cells[0]);
    if (skipRowName(name)) continue;
    if (looksLikeIdentifierHeader(name)) continue;
    const statusRaw = text(cells[statusCol]).toLowerCase();
    const status = ["active", "deferred", "drawing"].includes(statusRaw) ? statusRaw : "other";
    const noteBits = [];
    if (personCol >= 0 && text(cells[personCol])) noteBits.push(text(cells[personCol]));
    if (dateCol >= 0 && asDate(cells[dateCol])) noteBits.push(asDate(cells[dateCol]));
    if (valueCol >= 0 && hasRecordedMoney(cells[valueCol])) {
      noteBits.push(`£${(moneyToPence(cells[valueCol]) / 100).toFixed(2)}`);
    }
    household.pensions.push({
      id: uid(),
      name,
      status,
      note: noteBits.join(" · ").slice(0, 120),
    });
    report.pensions += 1;
  }
}

function importCharity(grid, household, report) {
  if (!grid?.length) return;
  const header = findRow(grid, "who") >= 0 ? findRow(grid, "who") : findRow(grid, "donation");
  if (header < 0) return;
  const row = grid[header];
  const whoCol = headerIndex(row, ["who gave", "who"]);
  const charityCol = headerIndex(row, ["donation", "charity"]);
  const dateCol = headerIndex(row, ["date"]);
  const amountCol = headerIndex(row, ["amount"]);
  const giftCol = headerIndex(row, ["gift aid"]);
  for (let index = header + 1; index < grid.length; index += 1) {
    const cells = grid[index] || [];
    const who = text(cells[whoCol]);
    const charity = text(cells[charityCol]);
    const rawAmount = cells[amountCol];
    if (!who || !charity) {
      if (who || charity) markSkipped(report, "empty template");
      continue;
    }
    if (!hasRecordedMoney(rawAmount) || isExcelError(rawAmount) || moneyToPence(rawAmount) <= 0) {
      markSkipped(report, "charity leftover");
      continue;
    }
    household.donations.push({
      id: uid(),
      who,
      charity,
      date: asDate(cells[dateCol]) || isoDate(),
      amountPence: moneyToPence(rawAmount),
      giftAid: truthy(cells[giftCol]),
    });
    report.donations += 1;
  }
}

export function emptyImportReport() {
  return {
    incomes: 0,
    bills: 0,
    envelopes: 0,
    cardSubs: 0,
    cards: 0,
    pendings: 0,
    oneOffs: 0,
    annualBills: 0,
    pots: 0,
    pensions: 0,
    payslips: 0,
    donations: 0,
    skipped: 0,
    skippedWhy: [],
    sheets: [],
  };
}

export function householdFromWorkbook(workbook) {
  const household = emptyHousehold();
  household.people = [];
  const report = emptyImportReport();
  const sheets = workbook?.sheets || {};
  report.sheets = Object.keys(sheets);

  const payslips = findSheet(sheets, "Payslips");
  if (payslips) importPayslips(payslips.grid, household, report);
  const annually = findSheet(sheets, "Annually");
  if (annually) importAnnually(annually.grid, household, report);
  const main = findSheet(sheets, "Main");
  if (main) {
    importExpected(main.grid, household, report);
    importMainTable(main.grid, household, report);
  }
  const pots = findSheet(sheets, "Where's the money", "Wheres the money", "Where the money");
  if (pots) importPots(pots.grid, household, report);
  const charity = findSheet(sheets, "Charity");
  if (charity) importCharity(charity.grid, household, report);

  if (!household.people.length) {
    household.people = emptyHousehold().people;
  }
  if (household.incomes.length && household.people.length) {
    household.incomes.forEach((item, index) => {
      if (!household.people.some((person) => person.id === item.personId)) {
        item.personId = household.people[index % household.people.length].id;
      }
    });
  }

  return { household, report };
}

export function applyHouseholdImport(store, household, { overwrite = true } = {}) {
  return {
    version: 1,
    friends: store.friends,
    transactions: store.transactions,
    household: overwrite ? household : store.household,
  };
}

export function importHasData(report) {
  return Boolean(
    report.incomes
    || report.bills
    || report.envelopes
    || report.cardSubs
    || report.cards
    || report.pendings
    || report.oneOffs
    || report.annualBills
    || report.pots
    || report.pensions
    || report.payslips
    || report.donations,
  );
}

export function reportLines(report) {
  const landed = [
    ["Income", report.incomes],
    ["Monthly", report.bills],
    ["Weekly", report.envelopes],
    ["Card subs", report.cardSubs],
    ["Cards", report.cards],
    ["Pending", report.pendings],
    ["Planned", report.oneOffs],
    ["Annual", report.annualBills],
    ["Pots", report.pots],
    ["Pensions", report.pensions],
    ["Payslips", report.payslips],
    ["Giving", report.donations],
  ].filter((item) => item[1] > 0);
  return {
    landed,
    skipped: report.skipped,
    skippedWhy: report.skippedWhy || [],
    sheets: report.sheets,
  };
}
