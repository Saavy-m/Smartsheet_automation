function columnsByTitle(sheetOrColumns) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  return Object.fromEntries(columns.map((column) => [column.title, column]));
}

function findColumnByTitle(sheetOrColumns, title, aliases = []) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  const expected = [title, ...aliases].map(normalizeLookupKey).filter(Boolean);

  return columns.find((column) => expected.includes(normalizeLookupKey(column.title)))
    || columns.find((column) => expected.some((item) => normalizeLookupKey(column.title).includes(item)))
    || null;
}

function primaryColumn(sheet) {
  return (sheet.columns || []).find((column) => column.primary) || sheet.columns?.[0];
}

function cellValue(row, columnId) {
  const cell = (row.cells || []).find((item) => item.columnId === columnId);
  return cell?.displayValue ?? cell?.value;
}

function findRowByPrimaryValue(sheet, value, aliases = []) {
  const primary = primaryColumn(sheet);
  if (!primary) {
    return null;
  }

  const expected = [value, ...aliases].map(normalizeLookupKey).filter(Boolean);
  return (sheet.rows || []).find((row) => expected.includes(normalizeLookupKey(cellValue(row, primary.id))))
    || (sheet.rows || []).find((row) => expected.some((item) => normalizeLookupKey(cellValue(row, primary.id)).includes(item)))
    || null;
}

function normalizeLookupKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/paterson/g, 'patterson')
    .replace(/[^a-z0-9]+/g, '');
}

function buildCell(column, value) {
  return { columnId: column.id, value, strict: false };
}

module.exports = {
  buildCell,
  cellValue,
  columnsByTitle,
  findColumnByTitle,
  findRowByPrimaryValue,
  normalizeLookupKey,
  primaryColumn
};