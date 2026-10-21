const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const XLSX = require('../vendor/xlsx.full.min.js');

const script = fs.readFileSync(path.join(__dirname, '../tshirt-orders.js'), 'utf8');
const token = 'de'.repeat(32);
const firstOrder = {
    id: '11111111-1111-4111-8111-111111111111',
    contactName: 'Anderson', email: 'family@example.com', memberCount: 2,
    members: [{ name: 'Person One', size: 'XS' }, { name: 'Person Two', size: 'XL' }]
};
const secondOrder = {
    id: '22222222-2222-4222-8222-222222222222',
    contactName: 'Brown', email: 'other@example.com', memberCount: 1,
    members: [{ name: '=TEXT IS NOT A FORMULA', size: 'XS' }]
};

async function manager({ orders = [firstOrder], hash = '#token=' + token, excel = XLSX } = {}) {
    const elements = new Map();
    const createElement = () => ({
        children: [],
        textContent: '',
        hidden: true,
        disabled: false,
        listeners: {},
        classList: { toggle() {} },
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
        addEventListener(event, handler) { this.listeners[event] = handler; }
    });
    const element = id => {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
    };
    let currentOrders = orders;
    let failure;
    let download;
    const requests = [];
    const context = vm.createContext({
        document: { getElementById: element, createElement },
        window: { addEventListener() {} },
        location: { hash },
        URLSearchParams, AbortController, setTimeout, clearTimeout,
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (failure) return { ok: true, json: async () => ({ success: false, error: failure }) };
            return { ok: true, json: async () => ({ success: true, orders: currentOrders }) };
        },
        XLSX: excel ? {
            ...excel,
            writeFile(workbook, filename, options) {
                download = { filename, data: XLSX.write(workbook, { ...options, type: 'buffer' }) };
            }
        } : undefined
    });
    vm.runInContext(script, context);
    await new Promise(resolve => setImmediate(resolve));
    return {
        context, element, requests,
        setOrders(value) { currentOrders = value; },
        fail(message) { failure = message; },
        async download() {
            await element('downloadOrders').listeners.click();
            return download;
        }
    };
}

test('private manager loads all orders using only a POST body token and displays shirt totals', async () => {
    const app = await manager({ orders: [firstOrder, secondOrder] });
    assert.equal(app.element('downloadOrders').disabled, false);
    assert.equal(app.element('orderData').hidden, false);
    assert.equal(app.element('orderTotals').textContent, '2 family orders / 3 shirts');
    assert.equal(app.element('personRows').children.length, 3);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].options.method, 'POST');
    assert.ok(!app.requests[0].url.includes(token));
    assert.deepEqual(JSON.parse(app.requests[0].options.body), { action: 'listTshirtOrders', managerToken: token });
});

test('combined download refreshes existing and new orders into a real XLS with exact person rows and size totals', async () => {
    const app = await manager();
    app.setOrders([firstOrder, secondOrder]);
    const result = await app.download();
    assert.equal(app.requests.length, 2);
    assert.equal(result.filename, 'jamaica-reunion-2026-tshirt-orders.xls');
    assert.equal(Buffer.from(result.data).subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const workbook = XLSX.read(result.data);
    assert.deepEqual(workbook.SheetNames, ['Orders', 'Size Totals']);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Orders, { header: 1 });
    assert.deepEqual(rows, [
        ['Contact Name', 'Email Address', 'Family Shirt Count', 'Family Member Name', 'T-Shirt Size', 'Order Reference'],
        ['Anderson', 'family@example.com', 2, 'Person One', 'XS', firstOrder.id],
        ['Anderson', 'family@example.com', 2, 'Person Two', 'XL', firstOrder.id],
        ['Brown', 'other@example.com', 1, '=TEXT IS NOT A FORMULA', 'XS', secondOrder.id]
    ]);
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['Size Totals'], { header: 1 }), [
        ['T-Shirt Size', 'Quantity'],
        ['XS', 2], ['S', 0], ['M', 0], ['L', 0], ['XL', 1], ['XXL', 0],
        ['Total Shirts', 3], ['Family Orders', 2]
    ]);
    assert.equal(workbook.Sheets.Orders.D4.t, 's');
    assert.equal(workbook.Sheets.Orders.D4.f, undefined);
    assert.ok(!JSON.stringify(rows).includes(token));
    assert.match(app.element('managerStatus').textContent, /downloaded in one Excel file/);
});

test('missing manager links never request data or enable downloads', async () => {
    const app = await manager({ hash: '' });
    assert.equal(app.requests.length, 0);
    assert.equal(app.element('orderData').hidden, true);
    assert.equal(app.element('downloadOrders').disabled, true);
    assert.match(app.element('managerStatus').textContent, /full private manager link/);
    assert.equal(await app.download(), undefined);
});

test('a failed refresh cannot download stale orders or claim an empty successful export', async () => {
    const app = await manager();
    app.fail('This private manager link is invalid.');
    assert.equal(await app.download(), undefined);
    assert.equal(app.element('orderData').hidden, true);
    assert.equal(app.element('downloadOrders').disabled, true);
    assert.match(app.element('managerStatus').textContent, /Could not load orders:.*invalid/);
});

test('an empty order list still exports a single workbook with both worksheets and zero totals', async () => {
    const app = await manager({ orders: [] });
    const workbook = XLSX.read((await app.download()).data);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Orders, { header: 1 }).length, 1);
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['Size Totals'], { header: 1 }).slice(-2), [
        ['Total Shirts', 0], ['Family Orders', 0]
    ]);
});

test('invalid order shapes, counts, or sizes are reported instead of silently excluding shirts', async () => {
    const invalid = [
        null, {},
        [{ ...firstOrder, memberCount: 3 }],
        [{ ...firstOrder, members: [{ name: 'Person', size: 'INVALID' }, firstOrder.members[1]] }],
        [{ ...firstOrder, members: [{ name: ' ', size: 'M' }, firstOrder.members[1]] }]
    ];
    for (const orders of invalid) {
        const app = await manager({ orders });
        assert.equal(app.element('downloadOrders').disabled, true);
        assert.equal(await app.download(), undefined);
        assert.match(app.element('managerStatus').textContent, /saved order list is incomplete/);
    }
});

test('missing Excel writer reports an actionable download error without returning a file', async () => {
    const app = await manager({ excel: null });
    assert.equal(await app.download(), undefined);
    assert.match(app.element('managerStatus').textContent, /Excel download tool did not load/);
});
