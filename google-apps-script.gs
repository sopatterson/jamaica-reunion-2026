const SPREADSHEET_ID = '1CnTfSMjKRbHTd1RVeWkvCULY-ds1HmdrC3HMQetoMuk';
const SHEET_NAME = 'RSVP';
const ARCHIVE_SHEET_NAME = 'RSVP Archive';
const FLIGHT_SHEET_NAME = 'Flights';
const FLIGHT_ARCHIVE_SHEET_NAME = 'Flight Archive';
const PHOTO_REVIEW_EMAIL = 'mrpatterson@gmail.com';
const PHOTO_UPLOAD_FOLDER_NAME = 'Pending Jamaica Reunion Photos';
const PHOTO_APPROVED_FOLDER_NAME = 'Approved Jamaica Reunion Photos';
const PHOTO_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_REVIEW_PROPERTY_PREFIX = 'photoReview:';

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
const LEGACY_FLIGHT_HEADERS = ['ID', 'Family Name', 'Arrival Day & Time', 'Departure Day & Time'];
const FLIGHT_HEADERS = [
  'ID',
  'RSVP ID',
  'Family Name',
  'Direction',
  'Day & Time',
  'Airline',
  'Flight Number',
  'Airport',
  'Travelers',
  'Bus Needed',
  'Location'
];
const FLIGHT_ARCHIVE_HEADERS = [...FLIGHT_HEADERS, 'Archived At'];

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

const FLIGHT_DIRECTION_OPTIONS = ['Arrival', 'Departure'];
const BUS_NEEDED_OPTIONS = ['Yes', 'No'];

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
  setupFlightSheets(spreadsheet);
}

function doGet(event) {
  try {
    const action = event.parameter.action || 'list';

    if (action === 'list') {
      return jsonResponse({ success: true, rsvps: getRsvps() });
    }

    if (action === 'listFlights') {
      return jsonResponse({ success: true, flights: getFlights() });
    }

    if (action === 'listBusPlan') {
      return jsonResponse({ success: true, busGroups: getBusPlan() });
    }

    if (action === 'listApprovedPhotos') {
      return jsonResponse({ success: true, photos: getApprovedPhotos() });
    }

    if (action === 'reviewPhoto') {
      return renderPhotoReviewPage(event.parameter);
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

    if (request.action === 'upsertFlight') {
      return jsonResponse({
        success: true,
        flight: upsertFlight(request.flight)
      });
    }

    if (request.action === 'submitPhoto') {
      return jsonResponse({
        success: true,
        photo: submitPhotoForReview(request.photo)
      });
    }

    if (request.action === 'reviewPhoto') {
      return renderPhotoDecisionPage(request);
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

function submitPhotoForReview(photo) {
  if (!photo || typeof photo !== 'object') {
    throw new Error('Photo data is required.');
  }

  const submitter = sanitizeText(photo.submitter).trim();
  const fileName = sanitizeText(photo.fileName).trim();
  const mimeType = String(photo.mimeType || '').trim().toLowerCase();
  const encodedData = String(photo.data || '');
  if (!submitter) {
    throw new Error('Your name is required.');
  }
  if (!fileName || !PHOTO_UPLOAD_TYPES.includes(mimeType)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }

  const bytes = Utilities.base64Decode(encodedData);
  if (bytes.length === 0 || bytes.length > PHOTO_UPLOAD_MAX_BYTES) {
    throw new Error('The photo must be smaller than 8 MB.');
  }

  const folder = getOrCreatePhotoFolder(PHOTO_UPLOAD_FOLDER_NAME);
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._ -]/g, '_');
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, timestamp + '-' + safeFileName));
  file.setDescription('Submitted by ' + submitter + ' for review before adding to the Jamaica Reunion carousel.');

  const token = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    PHOTO_REVIEW_PROPERTY_PREFIX + file.getId(),
    JSON.stringify({ token, status: 'pending', submitter, fileName })
  );
  const reviewUrl = ScriptApp.getService().getUrl() + '?action=reviewPhoto&id=' +
    encodeURIComponent(file.getId()) + '&token=' + encodeURIComponent(token);

  const subject = 'Jamaica Reunion photo awaiting review';
  const body = [
    submitter + ' submitted a family photo for the reunion carousel.',
    '',
    'Original file: ' + fileName,
    'Review and approve photo: ' + reviewUrl,
    '',
    'The photo has not been added to the website.'
  ].join('\n');
  MailApp.sendEmail({
    to: PHOTO_REVIEW_EMAIL,
    subject,
    body,
    htmlBody: '<p><strong>' + escapeHtmlForEmail(submitter) + '</strong> submitted a family photo for the reunion carousel.</p>' +
      '<p>Original file: ' + escapeHtmlForEmail(fileName) + '</p>' +
        '<p><a href="' + reviewUrl + '" style="background:#075a36;border-radius:4px;color:#ffffff;display:inline-block;font-weight:bold;padding:12px 18px;text-decoration:none;">Review &amp; Approve</a></p>' +
        '<p><a href="' + file.getUrl() + '">Open the original photo in Google Drive</a></p>' +
      '<p>The photo has not been added to the website.</p>'
  });

  return { submitted: true };
}

function getApprovedPhotos() {
  const files = getOrCreatePhotoFolder(PHOTO_APPROVED_FOLDER_NAME).getFiles();
  const photos = [];
  while (files.hasNext()) {
    const file = files.next();
    if (PHOTO_UPLOAD_TYPES.includes(file.getMimeType())) {
      photos.push({
        id: file.getId(),
        name: file.getName(),
        url: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w1600'
      });
    }
  }
  return photos;
}

function renderPhotoReviewPage(parameters) {
  const fileId = String(parameters.id || '');
  const token = String(parameters.token || '');
  const review = getPhotoReview(fileId, token);
  const file = DriveApp.getFileById(fileId);
  const previewBlob = file.getThumbnail() || file.getBlob();
  const imageUrl = 'data:' + previewBlob.getContentType() + ';base64,' + Utilities.base64Encode(previewBlob.getBytes());
  const serviceUrl = ScriptApp.getService().getUrl();
  const disabled = review.status === 'pending' ? '' : ' disabled';
  const statusText = review.status === 'pending'
    ? 'Choose whether this photo should appear in the public family carousel.'
    : 'This photo was already ' + review.status + '.';
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Review reunion photo</title></head><body style="background:#f4f1e8;color:#17352b;font-family:Arial,sans-serif;margin:0;padding:24px;">' +
    '<main style="margin:0 auto;max-width:720px;"><h1 style="font-size:28px;">Review reunion photo</h1>' +
    '<p><strong>Submitted by:</strong> ' + escapeHtmlForEmail(review.submitter) + '</p>' +
    '<p>' + escapeHtmlForEmail(statusText) + '</p>' +
    '<img src="' + imageUrl + '" alt="Submitted family photo" style="display:block;height:auto;max-height:65vh;max-width:100%;object-fit:contain;">' +
    '<form method="post" action="' + serviceUrl + '" style="display:flex;gap:12px;margin-top:20px;">' +
    '<input type="hidden" name="action" value="reviewPhoto"><input type="hidden" name="id" value="' + escapeHtmlForEmail(fileId) + '">' +
    '<input type="hidden" name="token" value="' + escapeHtmlForEmail(token) + '">' +
    '<button name="decision" value="approve"' + disabled + ' style="background:#075a36;border:0;border-radius:4px;color:white;font-size:16px;font-weight:bold;padding:12px 18px;">Approve</button>' +
    '<button name="decision" value="reject"' + disabled + ' style="background:#8b1e1e;border:0;border-radius:4px;color:white;font-size:16px;font-weight:bold;padding:12px 18px;">Reject</button>' +
    '</form><p><a href="' + file.getUrl() + '" target="_blank">Open original in Google Drive</a></p></main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Review reunion photo');
}

function renderPhotoDecisionPage(request) {
  const fileId = String(request.id || '');
  const token = String(request.token || '');
  const decision = String(request.decision || '');
  if (!['approve', 'reject'].includes(decision)) {
    throw new Error('Choose Approve or Reject.');
  }

  const review = getPhotoReview(fileId, token);
  if (review.status !== 'pending') {
    return photoReviewResultPage('Already reviewed', 'This photo was already ' + review.status + '.');
  }

  const file = DriveApp.getFileById(fileId);
  if (decision === 'approve') {
    file.moveTo(getOrCreatePhotoFolder(PHOTO_APPROVED_FOLDER_NAME));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    file.setDescription('Approved by email review for the Jamaica Reunion carousel. Submitted by ' + review.submitter + '.');
  } else {
    file.setTrashed(true);
  }
  review.status = decision === 'approve' ? 'approved' : 'rejected';
  PropertiesService.getScriptProperties().setProperty(PHOTO_REVIEW_PROPERTY_PREFIX + fileId, JSON.stringify(review));
  const message = decision === 'approve'
    ? 'The photo is approved and will appear in the public carousel on the next page load.'
    : 'The photo was rejected and removed from the review queue.';
  return photoReviewResultPage(decision === 'approve' ? 'Photo approved' : 'Photo rejected', message);
}

function getPhotoReview(fileId, token) {
  const stored = PropertiesService.getScriptProperties().getProperty(PHOTO_REVIEW_PROPERTY_PREFIX + fileId);
  if (!stored) {
    throw new Error('This review link is invalid or expired.');
  }
  const review = JSON.parse(stored);
  if (review.token !== token) {
    throw new Error('This review link is invalid or expired.');
  }
  return review;
}

function photoReviewResultPage(title, message) {
  return HtmlService.createHtmlOutput('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtmlForEmail(title) + '</title></head><body style="background:#f4f1e8;color:#17352b;font-family:Arial,sans-serif;padding:24px;">' +
    '<main style="margin:10vh auto;max-width:600px;"><h1>' + escapeHtmlForEmail(title) + '</h1><p>' + escapeHtmlForEmail(message) + '</p></main></body></html>')
    .setTitle(title);
}

function getOrCreatePhotoFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function escapeHtmlForEmail(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  validateLinkedFlightCounts(savedRsvp);
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
  syncLinkedFlightDetails(savedRsvp);

  return savedRsvp;
}

function validateLinkedFlightCounts(rsvp) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const flightSheet = spreadsheet.getSheetByName(FLIGHT_SHEET_NAME);
  if (!flightSheet || flightSheet.getLastRow() < 2 || flightSheet.getLastColumn() < FLIGHT_HEADERS.length) {
    return;
  }

  const linkedRows = flightSheet.getRange(2, 1, flightSheet.getLastRow() - 1, FLIGHT_HEADERS.length)
    .getDisplayValues()
    .filter(row => row[1] === rsvp.id);
  const oversizedGroup = linkedRows.find(row => toNonNegativeInteger(row[8]) > rsvp.total);
  if (oversizedGroup) {
    throw new Error('Total in Family cannot be lower than the linked flight group of ' + oversizedGroup[8] + ' travelers.');
  }
}

function syncLinkedFlightDetails(rsvp) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const flightSheet = spreadsheet.getSheetByName(FLIGHT_SHEET_NAME);
  if (!flightSheet || flightSheet.getLastRow() < 2 || flightSheet.getLastColumn() < FLIGHT_HEADERS.length) {
    return;
  }

  const values = flightSheet.getRange(2, 1, flightSheet.getLastRow() - 1, FLIGHT_HEADERS.length).getValues();
  let changed = false;
  values.forEach(row => {
    if (String(row[1]) !== rsvp.id) return;
    row[2] = rsvp.familyName;
    row[10] = rsvp.location;
    changed = true;
  });
  if (changed) {
    flightSheet.getRange(2, 1, values.length, FLIGHT_HEADERS.length).setValues(values);
  }
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
  archiveFlightsForRsvp(cleanId);
  sheet.deleteRow(rowNumber);
}

function archiveFlightsForRsvp(rsvpId) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const flightSheet = spreadsheet.getSheetByName(FLIGHT_SHEET_NAME);
  const archiveSheet = spreadsheet.getSheetByName(FLIGHT_ARCHIVE_SHEET_NAME);
  if (!flightSheet || !archiveSheet || flightSheet.getLastRow() < 2) {
    return;
  }

  for (let rowNumber = flightSheet.getLastRow(); rowNumber >= 2; rowNumber -= 1) {
    const rowValues = flightSheet.getRange(rowNumber, 1, 1, FLIGHT_HEADERS.length).getValues()[0];
    if (String(rowValues[1]) !== rsvpId) continue;
    archiveSheet.appendRow([...rowValues, new Date()]);
    flightSheet.deleteRow(rowNumber);
  }
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

function setupFlightSheets(spreadsheet) {
  let flightSheet = spreadsheet.getSheetByName(FLIGHT_SHEET_NAME);
  if (!flightSheet) {
    flightSheet = spreadsheet.insertSheet(FLIGHT_SHEET_NAME);
  }
  migrateLegacyFlightSheet(flightSheet, false);
  formatFlightSheet(flightSheet, FLIGHT_HEADERS, '#028090');
  flightSheet.getRange('E:E').setNumberFormat('@');

  let archiveSheet = spreadsheet.getSheetByName(FLIGHT_ARCHIVE_SHEET_NAME);
  if (!archiveSheet) {
    archiveSheet = spreadsheet.insertSheet(FLIGHT_ARCHIVE_SHEET_NAME);
  }
  migrateLegacyFlightSheet(archiveSheet, true);
  formatFlightSheet(archiveSheet, FLIGHT_ARCHIVE_HEADERS, '#5a1f1f');
  archiveSheet.getRange('E:E').setNumberFormat('@');
  archiveSheet.getRange('L:L').setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function migrateLegacyFlightSheet(sheet, isArchive) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < LEGACY_FLIGHT_HEADERS.length) {
    return;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const isLegacy = LEGACY_FLIGHT_HEADERS.every((header, index) => existingHeaders[index] === header);
  if (!isLegacy || existingHeaders[1] === 'RSVP ID') {
    return;
  }

  const lastRow = sheet.getLastRow();
  const legacyWidth = isArchive ? LEGACY_FLIGHT_HEADERS.length + 1 : LEGACY_FLIGHT_HEADERS.length;
  const legacyRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, legacyWidth).getValues()
    : [];
  const rsvpsByName = getRsvps().reduce((map, rsvp) => {
    map[String(rsvp.familyName).trim().toLowerCase()] = rsvp;
    return map;
  }, {});
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const migratedRows = [];

  legacyRows.forEach(row => {
    if (!row[0]) return;
    const rsvp = rsvpsByName[String(row[1]).trim().toLowerCase()] || null;
    const commonValues = [
      rsvp ? rsvp.id : '',
      rsvp ? rsvp.familyName : sanitizeText(row[1]).trim(),
      '',
      '',
      '',
      '',
      'MBJ',
      rsvp ? rsvp.total : 0,
      'Yes',
      rsvp ? rsvp.location : ''
    ];
    const archivedAt = isArchive ? row[4] : null;
    [
      { direction: 'Arrival', dateTime: normalizeDateTime(row[2], timeZone), id: row[0] },
      { direction: 'Departure', dateTime: normalizeDateTime(row[3], timeZone), id: Utilities.getUuid() }
    ].forEach(group => {
      if (!group.dateTime) return;
      const values = [group.id, ...commonValues];
      values[3] = group.direction;
      values[4] = group.dateTime;
      if (isArchive) values.push(archivedAt || new Date());
      migratedRows.push(values);
    });
  });

  sheet.clearContents();
  if (migratedRows.length > 0) {
    sheet.getRange(2, 1, migratedRows.length, isArchive ? FLIGHT_ARCHIVE_HEADERS.length : FLIGHT_HEADERS.length)
      .setValues(migratedRows);
  }
}

function formatFlightSheet(sheet, headers, headerColor) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground(headerColor)
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}

function getFlights() {
  const sheet = getFlightSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  return sheet.getRange(2, 1, lastRow - 1, FLIGHT_HEADERS.length)
    .getValues()
    .filter(row => row[0])
    .map(row => ({
      id: row[0],
      rsvpId: row[1],
      familyName: row[2],
      direction: normalizeOption(row[3], FLIGHT_DIRECTION_OPTIONS, 'Arrival'),
      dateTime: normalizeDateTime(row[4], timeZone),
      airline: row[5],
      flightNumber: row[6],
      airport: row[7] || 'MBJ',
      travelers: toNonNegativeInteger(row[8]),
      busNeeded: normalizeOption(row[9], BUS_NEEDED_OPTIONS, 'Yes'),
      location: row[10]
    }));
}

function getBusPlan() {
  const groups = {};
  getFlights()
    .filter(flight => flight.busNeeded === 'Yes' && flight.dateTime && flight.travelers > 0)
    .forEach(flight => {
      const key = [flight.direction, flight.dateTime, flight.airport, flight.location].join('|');
      if (!groups[key]) {
        groups[key] = {
          direction: flight.direction,
          dateTime: flight.dateTime,
          airport: flight.airport,
          location: flight.location,
          totalTravelers: 0,
          families: []
        };
      }
      groups[key].totalTravelers += flight.travelers;
      groups[key].families.push({
        familyName: flight.familyName,
        travelers: flight.travelers,
        airline: flight.airline,
        flightNumber: flight.flightNumber
      });
    });

  return Object.keys(groups)
    .map(key => groups[key])
    .sort((first, second) => first.direction.localeCompare(second.direction) || first.dateTime.localeCompare(second.dateTime));
}

function upsertFlight(flight) {
  if (!flight || typeof flight !== 'object') {
    throw new Error('Flight data is required.');
  }

  const rsvpId = sanitizeText(flight.rsvpId).trim();
  if (!rsvpId) {
    throw new Error('Select a family from the RSVP list.');
  }
  const rsvp = getRsvps().find(entry => entry.id === rsvpId);
  if (!rsvp) {
    throw new Error('The selected RSVP family was not found. Refresh the RSVP list and try again.');
  }
  if (rsvp.coming === 'Unfortunately No') {
    throw new Error('Flight information cannot be added for a family that is not attending.');
  }

  const travelers = toNonNegativeInteger(flight.travelers);
  if (travelers < 1 || travelers > rsvp.total) {
    throw new Error('Travelers must be between 1 and the RSVP family total of ' + rsvp.total + '.');
  }
  const dateTime = normalizeDateTime(flight.dateTime);
  if (!dateTime) {
    throw new Error('A valid flight day and time is required.');
  }

  const sheet = getFlightSheet();
  const savedFlight = {
    id: sanitizeText(flight.id).trim() || Utilities.getUuid(),
    rsvpId: rsvp.id,
    familyName: rsvp.familyName,
    direction: normalizeOption(flight.direction, FLIGHT_DIRECTION_OPTIONS, 'Arrival'),
    dateTime,
    airline: sanitizeText(flight.airline).trim(),
    flightNumber: sanitizeText(flight.flightNumber).trim().toUpperCase(),
    airport: sanitizeText(flight.airport).trim().toUpperCase() || 'MBJ',
    travelers,
    busNeeded: normalizeOption(flight.busNeeded, BUS_NEEDED_OPTIONS, 'Yes'),
    location: rsvp.location
  };
  const values = [[
    savedFlight.id,
    savedFlight.rsvpId,
    savedFlight.familyName,
    savedFlight.direction,
    savedFlight.dateTime,
    savedFlight.airline,
    savedFlight.flightNumber,
    savedFlight.airport,
    savedFlight.travelers,
    savedFlight.busNeeded,
    savedFlight.location
  ]];
  const existingRow = findRowById(sheet, savedFlight.id);

  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, FLIGHT_HEADERS.length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
  return savedFlight;
}

function deleteFlight(id) {
  const cleanId = sanitizeText(id).trim();
  if (!cleanId) {
    throw new Error('Flight ID is required.');
  }

  const sheet = getFlightSheet();
  const rowNumber = findRowById(sheet, cleanId);
  if (!rowNumber) {
    throw new Error('Flight entry was not found.');
  }

  const spreadsheet = sheet.getParent();
  const rowValues = sheet.getRange(rowNumber, 1, 1, FLIGHT_HEADERS.length).getValues()[0];
  spreadsheet.getSheetByName(FLIGHT_ARCHIVE_SHEET_NAME).appendRow([...rowValues, new Date()]);
  sheet.deleteRow(rowNumber);
}

function getFlightSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(FLIGHT_SHEET_NAME);
  if (!sheet) {
    throw new Error('The "' + FLIGHT_SHEET_NAME + '" tab does not exist. Run setupRsvpSheet first.');
  }
  return sheet;
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
  if (!event) {
    throw new Error('The request body is empty.');
  }
  if (event.parameter && event.parameter.action) {
    return event.parameter;
  }
  if (!event.postData || !event.postData.contents) {
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

function normalizeDateTime(value, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone || Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
  }
  const dateTime = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTime) ? dateTime : '';
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