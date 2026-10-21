const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../google-apps-script.gs'), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const token = 'ab'.repeat(32);
const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function order(count = 2, changes = {}) {
    return {
        id, editToken: token, contactName: 'Pat Patterson', email: 'pat@example.com', memberCount: count,
        members: Array.from({ length: count }, (_, index) => ({ name: `Person ${index + 1}`, size: sizes[index % sizes.length] })),
        ...changes
    };
}

function backend() {
    let now = Date.parse('2026-10-21T02:20:00Z');
    let ready = true;
    let mailError = false;
    let released = 0;
    let quotaChecked = false;
    const rows = [];
    const emails = [];
    const errors = [];
    const sheet = {
        getLastRow: () => rows.length,
        getRange(row, column, rowCount = 1, columnCount = 1) {
            return {
                getValues: () => Array.from({ length: rowCount }, (_, index) =>
                    Array.from({ length: columnCount }, (_, offset) => rows[row - 1 + index]?.[column - 1 + offset] ?? '')),
                getDisplayValues() { return this.getValues().map(values => values.map(String)); },
                setValues(values) {
                    values.forEach((valuesRow, index) => {
                        rows[row - 1 + index] ??= [];
                        valuesRow.forEach((value, offset) => { rows[row - 1 + index][column - 1 + offset] = value; });
                    });
                    return this;
                },
                setBackground() { return this; },
                setFontColor() { return this; },
                setFontWeight() { return this; }
            };
        },
        appendRow(values) { rows.push(values); },
        setFrozenRows() {},
        autoResizeColumns() {},
        hideColumns(column) { this.hiddenColumn = column; }
    };
    const context = vm.createContext({
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        },
        SpreadsheetApp: {
            openById: () => ({
                getSheetByName: name => ready && name === 'T-Shirt Orders' ? sheet : null,
                insertSheet: () => { ready = true; return sheet; }
            })
        },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'sha256' },
            Charset: { UTF_8: 'utf8' },
            computeDigest: (algorithm, value, charset) => [...crypto.createHash(algorithm).update(value, charset).digest()],
            formatDate: (date, timeZone) => new Intl.DateTimeFormat('en-US', {
                timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
            }).format(date)
        },
        MailApp: {
            getRemainingDailyQuota: () => { quotaChecked = true; return 100; },
            sendEmail(message) {
                if (mailError) throw new Error('Email quota exhausted');
                emails.push(message);
            }
        },
        LockService: { getScriptLock: () => ({
            waitLock() {},
            releaseLock() { released += 1; }
        }) },
        ContentService: {
            MimeType: { JSON: 'application/json' },
            createTextOutput: text => ({ text, setMimeType() { return this; } })
        },
        console: { log() {}, error: message => errors.push(String(message)) }
    });
    vm.runInContext(source, context);
    rows.push(Array.from(vm.runInContext('TSHIRT_HEADERS', context)));
    return {
        context, rows, emails, errors, sheet,
        setNow: value => { now = Date.parse(value); },
        setReady: value => { ready = value; },
        setMailError: value => { mailError = value; },
        get released() { return released; },
        get quotaChecked() { return quotaChecked; },
        post(action, data = {}) {
            return JSON.parse(context.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action, ...data }) } }).text);
        },
        get(action, parameters = {}) {
            return JSON.parse(context.doGet({ parameter: { action, ...parameters } }).text);
        }
    };
}

test('setup creates the order tab without erasing orders and requests email authorization', () => {
    const app = backend();
    app.setReady(false);
    app.context.setupTshirtSheet();
    assert.equal(app.sheet.hiddenColumn, 27);
    assert.equal(app.quotaChecked, true);
    app.post('saveTshirtOrder', { order: order() });
    app.context.setupTshirtSheet();
    assert.equal(app.rows.length, 2);
});

test('public config supplies the exact Eastern cutoff, without exposing orders', () => {
    const app = backend();
    assert.deepEqual(app.get('tshirtConfig'), {
        success: true, deadline: '2026-10-26T00:00:00-04:00',
        timeZone: 'America/New_York', acceptingOrders: true
    });
    app.setReady(false);
    assert.match(app.get('tshirtConfig').error, /run setupTshirtSheet/);
});

test('all family sizes 1 through 10 save required member data and send a complete email copy', () => {
    for (let count = 1; count <= 10; count += 1) {
        const app = backend();
        const submitted = order(count);
        const result = app.post('saveTshirtOrder', { order: submitted });
        assert.equal(result.success, true);
        assert.equal(result.emailSent, true);
        assert.equal(app.rows.length, 2);
        assert.equal(app.rows[1].length, 27);
        assert.equal(result.order.memberCount, count);
        assert.equal(result.order.members.length, count);
        assert.equal(result.order.contactName, submitted.contactName);
        assert.equal(result.order.email, submitted.email);
        assert.equal(app.emails[0].to, submitted.email);
        for (let index = 0; index < count; index += 1) {
            assert.equal(app.rows[1][4 + index * 2], submitted.members[index].name);
            assert.equal(app.rows[1][5 + index * 2], submitted.members[index].size);
            assert.ok(app.emails[0].body.includes(`${submitted.members[index].name} - ${submitted.members[index].size}`));
        }
        assert.match(app.emails[0].body, /2026\/tshirts\.html#order=.*&token=/);
        assert.ok(app.emails[0].body.includes(token));
        assert.ok(app.emails[0].body.includes('October 25, 2026'));
        assert.ok(!JSON.stringify(result).includes(token));
        assert.ok(!JSON.stringify(app.rows).includes(token));
        assert.equal(app.rows[1][26], crypto.createHash('sha256').update(token).digest('hex'));
        assert.equal(app.released, 1);
    }
});

test('invalid or missing contacts, email, counts, names, and sizes cannot save or send email', () => {
    const invalid = [
        null, [], order(1, { contactName: '' }), order(1, { contactName: '   ' }),
        order(1, { contactName: 'a'.repeat(101) }),
        order(1, { email: 'not-an-email' }), order(1, { email: 'a@example.com\nBcc:other@example.com' }),
        order(1, { email: '  ' }), order(1, { memberCount: 0 }), order(1, { memberCount: 11 }),
        order(1, { memberCount: 1.5 }), order(1, { memberCount: '1' }),
        order(2, { members: [{ name: 'One', size: 'M' }] }), order(1, { members: [] }),
        order(1, { members: [null] }), order(1, { members: [{ name: ' ', size: 'M' }] }),
        order(1, { members: [{ name: 'Person', size: '' }] }),
        order(1, { members: [{ name: 'Person', size: 'Youth L' }] }),
        order(1, { members: [{ name: 'Person', size: 'xxl' }] }),
        order(1, { id: '' }), order(1, { editToken: 'short' })
    ];
    for (const invalidOrder of invalid) {
        const app = backend();
        const result = app.post('saveTshirtOrder', { order: invalidOrder });
        assert.equal(result.success, false, JSON.stringify(invalidOrder));
        assert.ok(result.error);
        assert.equal(app.rows.length, 1);
        assert.equal(app.emails.length, 0);
        assert.equal(app.errors.length, 1);
    }
});

test('private links load the order without returning the token or its hash', () => {
    const app = backend();
    app.post('saveTshirtOrder', { order: order() });
    const result = app.post('getTshirtOrder', { orderId: id, editToken: token });
    assert.deepEqual(result.order.members, order().members);
    assert.equal(result.order.contactName, 'Pat Patterson');
    assert.ok(!JSON.stringify(result).includes(token));
    assert.ok(!JSON.stringify(result).includes(app.rows[1][26]));
    assert.equal(app.get('getTshirtOrder', { orderId: id, editToken: token }).success, false);
    assert.equal(app.get('listTshirtOrders').success, false);
});

test('wrong or missing private tokens cannot read, overwrite, or resend another family order', () => {
    const app = backend();
    app.post('saveTshirtOrder', { order: order() });
    const original = JSON.stringify(app.rows);
    for (const badToken of ['', 'cd'.repeat(32)]) {
        assert.equal(app.post('getTshirtOrder', { orderId: id, editToken: badToken }).success, false);
        assert.equal(app.post('resendTshirtConfirmation', { orderId: id, editToken: badToken }).success, false);
        assert.equal(app.post('saveTshirtOrder', { order: order(1, { editToken: badToken, contactName: 'Intruder' }) }).success, false);
    }
    assert.equal(JSON.stringify(app.rows), original);
    assert.equal(app.emails.length, 1);
    const wrongToken = app.post('getTshirtOrder', { orderId: id, editToken: 'cd'.repeat(32) });
    const missingOrder = app.post('getTshirtOrder', { orderId: '22222222-2222-4222-8222-222222222222', editToken: token });
    assert.equal(wrongToken.error, missingOrder.error);
});

test('editing and retrying update one row, preserve creation time, and clear removed members', () => {
    const app = backend();
    app.post('saveTshirtOrder', { order: order(10) });
    const createdAt = app.rows[1][24];
    app.setNow('2026-10-22T15:00:00Z');
    const edited = order(1, { contactName: 'Updated Name', email: 'updated@example.com' });
    assert.equal(app.post('saveTshirtOrder', { order: edited }).success, true);
    assert.equal(app.post('saveTshirtOrder', { order: edited }).success, true);
    assert.equal(app.rows.length, 2);
    assert.equal(app.rows[1][24], createdAt);
    assert.notEqual(app.rows[1][25].getTime(), createdAt.getTime());
    assert.equal(app.rows[1][1], edited.contactName);
    assert.equal(app.rows[1][2], edited.email);
    assert.deepEqual(Array.from(app.rows[1].slice(6, 24)), Array(18).fill(''));
    assert.equal(app.emails.at(-1).to, edited.email);
});

test('the server accepts the last millisecond of Sunday and rejects orders and edits at midnight Eastern', () => {
    const app = backend();
    app.setNow('2026-10-26T03:59:59.999Z');
    assert.equal(app.post('saveTshirtOrder', { order: order() }).success, true);
    const original = JSON.stringify(app.rows);
    app.setNow('2026-10-26T04:00:00.000Z');
    assert.equal(app.get('tshirtConfig').acceptingOrders, false);
    assert.match(app.post('saveTshirtOrder', { order: order(1) }).error, /orders and edits closed/);
    assert.match(app.post('saveTshirtOrder', { order: order(1, { id: '22222222-2222-4222-8222-222222222222' }) }).error, /closed/);
    assert.equal(JSON.stringify(app.rows), original);
    assert.equal(app.post('getTshirtOrder', { orderId: id, editToken: token }).success, true);
    assert.equal(app.post('resendTshirtConfirmation', { orderId: id, editToken: token }).success, true);
});

test('an email failure preserves the order and explicitly supports retry without duplicate rows', () => {
    const app = backend();
    app.setMailError(true);
    const result = app.post('saveTshirtOrder', { order: order() });
    assert.equal(result.success, true);
    assert.equal(result.emailSent, false);
    assert.match(result.warning, /order was saved.*email could not be sent/);
    assert.equal(app.rows.length, 2);
    assert.equal(app.errors.length, 1);
    assert.equal(app.post('resendTshirtConfirmation', { orderId: id, editToken: token }).success, false);
    app.setMailError(false);
    assert.equal(app.post('resendTshirtConfirmation', { orderId: id, editToken: token }).emailSent, true);
    assert.equal(app.rows.length, 2);
    assert.equal(app.emails.length, 1);
});

test('sheet formula-like names and HTML-like names are stored and emailed safely', () => {
    const app = backend();
    const result = app.post('saveTshirtOrder', {
        order: order(2, {
            contactName: ' =SUM(1,2) ',
            members: [{ name: '@Name', size: 'XS' }, { name: '<img src=x onerror=alert(1)>', size: 'XXL' }]
        })
    });
    assert.equal(result.success, true);
    assert.equal(app.rows[1][1], "'=SUM(1,2)");
    assert.equal(app.rows[1][4], "'@Name");
    assert.ok(!app.emails[0].htmlBody.includes('<img'));
    assert.ok(app.emails[0].htmlBody.includes('&lt;img'));
});

test('existing health endpoint still responds and unknown actions remain errors', () => {
    const app = backend();
    assert.equal(app.get('health').success, true);
    assert.equal(app.post('unknown').success, false);
    assert.equal(app.get('unknown').success, false);
});
