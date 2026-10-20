const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const XLSX = require('../vendor/xlsx.full.min.js');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const script = inlineScript.slice(0, inlineScript.lastIndexOf('\n        renderRsvps();'));

function tracker(rsvps, flights, excel = XLSX) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            textContent: '',
            innerHTML: '',
            handlers: {},
            addEventListener(event, handler) { this.handlers[event] = handler; }
        });
        return elements.get(id);
    };
    let download;
    const context = vm.createContext({
        document: {
            getElementById: element,
            createElement() {
                return {
                    set textContent(value) { this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
                };
            }
        },
        localStorage: {
            getItem(key) { return JSON.stringify(key.endsWith('-rsvps') ? rsvps : flights); }
        },
        XLSX: excel && {
            ...excel,
            writeFile(workbook, filename, options) {
                download = { filename, data: XLSX.write(workbook, { ...options, type: 'buffer' }) };
            }
        }
    });
    vm.runInContext(script, context);
    return {
        context,
        element,
        download() {
            element('downloadFlights').handlers.click();
            return download;
        },
        async downloadBusPlan() {
            await element('downloadBusPlan').handlers.click();
            return download;
        }
    };
}

const family = (id, familyName, coming = 'Yes') => ({
    id, familyName, coming, total: 3, adults: 3, children: 0, location: 'Waves'
});
const flight = (rsvpId, direction, fields = {}) => ({
    id: `${rsvpId}-${direction}`, rsvpId, direction, familyName: 'Old name',
    dateTime: '2026-11-23T14:30', airline: 'Airline', flightNumber: '0012',
    airport: 'MBJ', travelers: 2, busNeeded: 'Yes', location: 'Offsite', ...fields
});

test('XLS download mirrors alphabetical family groups with arrival before departure', () => {
    const app = tracker([
        family('z', 'Zimmerman'), family('b', 'brown'), family('a', 'Anderson'),
        family('no', 'Absent', 'Unfortunately No'), family('', 'Unsaved'),
        family('blank', ' '), family('maybe', 'Campbell', 'Will Know By 15 Sept')
    ], [
        flight('z', 'Departure'), flight('a', 'Departure'),
        flight('a', 'Arrival', { id: '', airline: '=LOCAL EDIT', flightNumber: '0007' }),
        flight('no', 'Arrival'), flight('orphan', 'Arrival')
    ]);
    vm.runInContext('renderFlightRows()', app.context);
    const rendered = app.element('flightRows').innerHTML;
    assert.ok(rendered.indexOf('Anderson<span>') < rendered.indexOf('brown<span>'));
    assert.ok(rendered.indexOf('brown<span>') < rendered.indexOf('Campbell<span>'));
    assert.ok(rendered.indexOf('Campbell<span>') < rendered.indexOf('Zimmerman<span>'));
    const result = app.download();
    assert.equal(result.filename, 'jamaica-reunion-2026-flights.xls');
    assert.equal(Buffer.from(result.data).subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const workbook = XLSX.read(result.data, { type: 'buffer', cellFormula: true });
    const sheet = workbook.Sheets['Flight Tracker'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    assert.equal(rows.length, 9);
    assert.deepEqual(rows.slice(1).map(row => row.slice(0, 2)), [
        ['Anderson', 'Arrival'], ['', 'Departure'],
        ['brown', 'Arrival'], ['', 'Departure'],
        ['Campbell', 'Arrival'], ['', 'Departure'],
        ['Zimmerman', 'Arrival'], ['', 'Departure']
    ]);
    assert.deepEqual(rows[1].slice(2), ['2026-11-23 14:30', '=LOCAL EDIT', '0007', 'MBJ', 2, 'Yes', 'Waves']);
    assert.deepEqual(rows[3].slice(2), ['', '', '', 'MBJ', 3, 'Yes', 'Waves']);
    assert.equal(sheet.D2.t, 's');
    assert.equal(sheet.D2.f, undefined);
    assert.equal(sheet['!merges'].length, 4);
    assert.deepEqual(sheet['!merges'][0], { s: { c: 0, r: 1 }, e: { c: 0, r: 2 } });
    assert.match(app.element('flightSaveStatus').textContent, /downloaded/);
    assert.deepEqual(Array.from(vm.runInContext('rsvps.map(rsvp => rsvp.id)', app.context)), ['z', 'b', 'a', 'no', '', 'blank', 'maybe']);
    const firstIndex = Number(rendered.match(/<tr data-index="(\d+)"/)[1]);
    assert.equal(vm.runInContext(`flights[${firstIndex}].rsvpId`, app.context), 'a');
});

test('export includes both legs even without rendering first', () => {
    const app = tracker([family('a', 'Anderson')], []);
    const workbook = XLSX.read(app.download().data);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Flight Tracker'], { header: 1 });
    assert.equal(rows.length, 3);
    assert.equal(rows[1][1], 'Arrival');
    assert.equal(rows[2][1], 'Departure');
});

test('empty flight tracker exports a header-only workbook', () => {
    const app = tracker([], []);
    const workbook = XLSX.read(app.download().data);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['Flight Tracker'], { header: 1 }).length, 1);
});

test('missing Excel writer reports an actionable error instead of claiming success', () => {
    const app = tracker([family('a', 'Anderson')], [], undefined);
    vm.runInContext('XLSX = undefined', app.context);
    assert.equal(app.download(), undefined);
    assert.match(app.element('flightSaveStatus').textContent, /Could not download flight list:.*Refresh the page/);
});

test('Excel generation failures are reported', () => {
    const app = tracker([], [], { utils: { aoa_to_sheet() { throw new Error('Export failed'); } } });
    assert.equal(app.download(), undefined);
    assert.equal(app.element('flightSaveStatus').textContent, 'Could not download flight list: Export failed');
});

test('bus plan downloads real XLS with shared seat totals and alphabetical families', async () => {
    const app = tracker([], []);
    app.context.fetch = async url => {
        assert.equal(new URL(url).searchParams.get('action'), 'listBusPlan');
        return {
            ok: true,
            json: async () => ({
                success: true,
                busGroups: [{
                    direction: 'Arrival', dateTime: '2026-11-23T14:30',
                    airport: 'MBJ', location: 'Waves', totalTravelers: 5,
                    families: [
                        { familyName: 'Zimmerman', travelers: 2, airline: 'JetBlue', flightNumber: '0007' },
                        { familyName: 'anderson', travelers: 3, airline: '', flightNumber: '' }
                    ]
                }]
            })
        };
    };
    const result = await app.downloadBusPlan();
    assert.equal(result.filename, 'jamaica-reunion-2026-bus-plan.xls');
    assert.equal(Buffer.from(result.data).subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const workbook = XLSX.read(result.data);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Bus Plan'], { header: 1 });
    assert.deepEqual(rows, [
        ['Direction', 'Day & Time', 'Airport', 'Destination', 'Bus Seats', 'Family Groups'],
        ['Arrival', '2026-11-23 14:30', 'MBJ', 'Waves', 5, 'anderson (3); Zimmerman (2) - JetBlue 0007']
    ]);
    assert.match(app.element('flightSaveStatus').textContent, /downloaded as an Excel file/);
});

test('empty bus plan downloads a header-only XLS', async () => {
    const app = tracker([], []);
    app.context.fetch = async () => ({ ok: true, json: async () => ({ success: true, busGroups: [] }) });
    const workbook = XLSX.read((await app.downloadBusPlan()).data);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['Bus Plan'], { header: 1 }).length, 1);
});

test('bus plan reports missing Excel writer without requesting shared data', async () => {
    const app = tracker([], []);
    vm.runInContext('XLSX = undefined', app.context);
    assert.equal(await app.downloadBusPlan(), undefined);
    assert.match(app.element('flightSaveStatus').textContent, /Could not prepare bus plan:.*Refresh the page/);
});

test('bus plan request failures do not produce a download', async () => {
    const app = tracker([], []);
    app.context.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await app.downloadBusPlan(), undefined);
    assert.equal(app.element('flightSaveStatus').textContent, 'Could not prepare bus plan: Spreadsheet request failed (503).');
});
