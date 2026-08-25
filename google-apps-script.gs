const SPREADSHEET_ID = '1CnTfSMjKRbHTd1RVeWkvCULY-ds1HmdrC3HMQetoMuk';
const SHEET_NAME = 'RSVP';
const ARCHIVE_SHEET_NAME = 'RSVP Archive';

const HEADERS = [
  'ID',
  'Family Name',
  'Total in Family',
  'Age 17 and Below',
  'Age 18 and Above',
  'Are You Coming',
  'Location'
];
const ARCHIVE_HEADERS = [...HEADERS, 'Archived At'];

const ATTENDANCE_OPTIONS = [
  'Yes',
  'Unfortunately No',
  'Will Know By 15 Sept'
];

const LOCATION_OPTIONS = [
  'Selection',
  'Waves',
  'Offsite'
];

function setupRsvpSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  const existingHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    : [];
  const teenColumn = existingHeaders.indexOf('Age 14 to 17') + 1;
  if (teenColumn > 0) {
    const childColumn = existingHeaders.indexOf('Age 13 and Below') + 1;
    const lastRow = sheet.getLastRow();
    if (childColumn > 0 && lastRow > 1) {
      const childValues = sheet.getRange(2, childColumn, lastRow - 1, 1).getValues();
      const teenValues = sheet.getRange(2, teenColumn, lastRow - 1, 1).getValues();
      const combinedValues = childValues.map((row, index) => [
        toNonNegativeInteger(row[0]) + toNonNegativeInteger(teenValues[index][0])
      ]);
      sheet.getRange(2, childColumn, combinedValues.length, 1).setValues(combinedValues);
    }
    sheet.deleteColumn(teenColumn);
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setBackground('#075a36')
    .setFontColor('#ffd83d')
    .setFontWeight('bold');

  const dataRowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const attendanceValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(ATTENDANCE_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  const locationValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(LOCATION_OPTIONS, true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, 6, dataRowCount, 1).setDataValidation(attendanceValidation);
  sheet.getRange(2, 7, dataRowCount, 1).setDataValidation(locationValidation);
  sheet.autoResizeColumns(1, HEADERS.length);
  getArchiveSheet(spreadsheet);
}

function doGet(event) {
  try {
    const action = event.parameter.action || 'list';

    if (action === 'list') {
      return jsonResponse({ success: true, rsvps: getRsvps() });
    }

    if (action === 'health') {
      return jsonResponse({
        success: true,
        message: 'Jamaica Reunion RSVP endpoint is running.'
      });
    }

    return jsonResponse({ success: false, error: 'Unknown GET action.' });
  } catch (error) {
    return errorResponse(error);
  }
}

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
    const request = parseRequest(event);

    if (request.action === 'upsert') {
      return jsonResponse({
        success: true,
        rsvp: upsertRsvp(request.rsvp)
      });
    }

    if (request.action === 'delete') {
      deleteRsvp(request.id);
      return jsonResponse({ success: true, id: request.id, archived: true });
    }

    return jsonResponse({ success: false, error: 'Unknown POST action.' });
  } catch (error) {
    return errorResponse(error);
  } finally {
    lock.releaseLock();
  }
}

function getRsvps() {
  const sheet = getRsvpSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, HEADERS.length)
    .getDisplayValues()
    .filter(row => row[0])
    .map(row => ({
      id: row[0],
      familyName: row[1],
      total: Number(row[2]) || 0,
      children: Number(row[3]) || 0,
      adults: Number(row[4]) || 0,
      coming: normalizeOption(row[5], ATTENDANCE_OPTIONS, 'Yes'),
      location: normalizeOption(row[6], LOCATION_OPTIONS, 'Selection')
    }));
}

function upsertRsvp(rsvp) {
  if (!rsvp || typeof rsvp !== 'object') {
    throw new Error('RSVP data is required.');
  }

  const familyName = sanitizeText(rsvp.familyName).trim();
  if (!familyName) {
    throw new Error('Family name is required.');
  }

  const sheet = getRsvpSheet();
  const id = sanitizeText(rsvp.id).trim() || Utilities.getUuid();
  const savedRsvp = {
    id,
    familyName,
    total: toNonNegativeInteger(rsvp.total),
    children: toNonNegativeInteger(rsvp.children),
    adults: toNonNegativeInteger(rsvp.adults),
    coming: normalizeOption(rsvp.coming, ATTENDANCE_OPTIONS, 'Yes'),
    location: normalizeOption(rsvp.location, LOCATION_OPTIONS, 'Selection')
  };
  const totalByAge = savedRsvp.children + savedRsvp.adults;
  if (savedRsvp.total !== totalByAge) {
    throw new Error('Total in Family must equal both age groups combined.');
  }
  const values = [[
    savedRsvp.id,
    savedRsvp.familyName,
    savedRsvp.total,
    savedRsvp.children,
    savedRsvp.adults,
    savedRsvp.coming,
    savedRsvp.location
  ]];
  const existingRow = findRowById(sheet, id);

  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }

  return savedRsvp;
}

function deleteRsvp(id) {
  const cleanId = sanitizeText(id).trim();
  if (!cleanId) {
    throw new Error('RSVP ID is required.');
  }

  const sheet = getRsvpSheet();
  const rowNumber = findRowById(sheet, cleanId);
  if (!rowNumber) {
    throw new Error('RSVP was not found.');
  }

  const rowValues = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  const archiveSheet = getArchiveSheet(sheet.getParent());
  archiveSheet.appendRow([...rowValues, new Date()]);
  sheet.deleteRow(rowNumber);
}

function getArchiveSheet(spreadsheet) {
  let archiveSheet = spreadsheet.getSheetByName(ARCHIVE_SHEET_NAME);
  if (!archiveSheet) {
    archiveSheet = spreadsheet.insertSheet(ARCHIVE_SHEET_NAME);
  }

  archiveSheet.getRange(1, 1, 1, ARCHIVE_HEADERS.length).setValues([ARCHIVE_HEADERS]);
  archiveSheet.setFrozenRows(1);
  archiveSheet.getRange(1, 1, 1, ARCHIVE_HEADERS.length)
    .setBackground('#5a1f1f')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  archiveSheet.getRange('H:H').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  archiveSheet.autoResizeColumns(1, ARCHIVE_HEADERS.length);
  return archiveSheet;
}

function findRowById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
  const index = ids.indexOf(id);
  return index === -1 ? null : index + 2;
}

function getRsvpSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('The "' + SHEET_NAME + '" tab does not exist. Run setupRsvpSheet first.');
  }
  return sheet;
}

function parseRequest(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error('The request body is empty.');
  }
  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error('The request body must contain valid JSON.');
  }
}

function normalizeOption(value, options, fallback) {
  const option = String(value || '');
  return options.includes(option) ? option : fallback;
}

function toNonNegativeInteger(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function sanitizeText(value) {
  const text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(error) {
  console.error(error);
  return jsonResponse({
    success: false,
    error: error.message || 'An unexpected error occurred.'
  });
}