/**
 * Hue Reflex — results collector (Google Apps Script web app)
 * Logging style: ONE ROW PER TRIAL (Option A).
 *
 * SETUP (one time):
 *   1. Go to https://script.google.com  ->  New project.
 *   2. Delete the sample code, paste THIS whole file, click Save.
 *   3. (Optional) Run `setup` once to create the sheet + authorize.
 *      The execution log prints the Sheet URL.
 *   4. Deploy  ->  New deployment  ->  type: Web app
 *         - Execute as: Me
 *         - Who has access: Anyone
 *      Deploy, authorize, copy the Web app URL (ends in /exec),
 *      and paste it into SCRIPT_URL in script.js.
 *
 * UPDATING THIS CODE LATER (important!):
 *   Editing the code does NOT change what the live /exec URL runs.
 *   After pasting changes:  Deploy -> Manage deployments ->
 *   (pencil/Edit) -> Version: "New version" -> Deploy.
 *   That keeps the SAME URL but serves the new code.
 *
 * The spreadsheet is created automatically on first use and its ID is
 * remembered, so every submission appends to the same sheet.
 */

var SHEET_NAME = "Results";
var HEADER = [
  "Timestamp", "Name", "Session", "Trial #",
  "Gray Level (0-255)", "Target Hex", "Reaction (ms)", "User Agent"
];

/** Returns { ss, sheet }, creating the spreadsheet on first use. */
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  var ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create("Hue Reflex Results");
    props.setProperty("SHEET_ID", ss.getId());
  }
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  sheet.setName(SHEET_NAME);
  ensureHeader_(sheet);
  return { ss: ss, sheet: sheet };
}

/** Writes/repairs the header. Safely upgrades an empty old-format sheet. */
function ensureHeader_(sheet) {
  var last = sheet.getLastRow();
  if (last === 0) {
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
    return;
  }
  if (last === 1) {
    var width = Math.max(sheet.getLastColumn(), HEADER.length);
    var cur = sheet.getRange(1, 1, 1, width).getValues()[0];
    var same = HEADER.every(function (h, i) { return cur[i] === h; });
    if (!same) {
      sheet.getRange(1, 1, 1, width).clearContent();
      sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
      sheet.setFrozenRows(1);
    }
  }
}

/** Receives a submission and appends one row per trial. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_().sheet;
    var trials = data.trials || [];
    var now = new Date();

    var rows = trials.map(function (t) {
      return [
        now,
        data.name || "(no name)",
        data.session || "",
        t.trial,
        t.gray,
        t.hex || "",
        t.rt,
        data.userAgent || ""
      ];
    });

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length)
           .setValues(rows);
    }
    return json_({ ok: true, added: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Visiting the URL in a browser shows status + the Sheet link. */
function doGet() {
  var ss = getSheet_().ss;
  return ContentService.createTextOutput(
    "Hue Reflex collector is running.\nResults sheet: " + ss.getUrl()
  ).setMimeType(ContentService.MimeType.TEXT);
}

/** Run once manually to create the sheet and see its URL in the log. */
function setup() {
  Logger.log("Results spreadsheet: " + getSheet_().ss.getUrl());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
