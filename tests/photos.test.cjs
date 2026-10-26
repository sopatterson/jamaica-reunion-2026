const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../google-apps-script.gs'), 'utf8');
const uploadScript = html.slice(html.indexOf("        const photoUploadForm ="), html.indexOf("        document.getElementById('addRsvp')"));

function uploader(files) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            disabled: false, hidden: id === 'retryPhotos', value: 'Pat Patterson',
            files, textContent: '', handlers: {}, resets: 0,
            addEventListener(name, handler) { this.handlers[name] = handler; },
            reset() { this.resets += 1; },
            requestSubmit() { return this.handlers.submit({ preventDefault() {} }); }
        });
        return elements.get(id);
    };
    const requests = [];
    const statuses = [];
    const failures = new Set();
    let active = 0;
    let maxActive = 0;
    const context = vm.createContext({
        document: { getElementById: element },
        FileReader: class {
            readAsDataURL(file) {
                if (file.unreadable) return this.onerror();
                if (file.aborted) return this.onabort();
                this.result = 'data:' + file.type + ';base64,aGVsbG8=';
                this.onload();
            }
        },
        async requestRsvp(action, data) {
            active += 1;
            maxActive = Math.max(maxActive, active);
            requests.push({ action, ...data });
            statuses.push(element('photoUploadStatus').textContent);
            assert.equal(element('choosePhoto').disabled, true);
            assert.equal(element('photoSubmitter').disabled, true);
            await Promise.resolve();
            active -= 1;
            if (failures.has(data.photo.fileName)) throw new Error('Upload unavailable');
            return { success: true };
        }
    });
    vm.runInContext(uploadScript, context);
    return {
        element, requests, statuses, failures,
        submit: () => element('photoUploadForm').requestSubmit(),
        get maxActive() { return maxActive; }
    };
}

function photo(name = 'family.jpg', changes = {}) {
    return { name, type: 'image/jpeg', size: 1024, ...changes };
}

test('file picker supports multiple photos and preserves supported formats', () => {
    assert.match(html, /<input[^>]+id="photoFile"[^>]+accept="image\/jpeg,image\/png,image\/webp"[^>]+\bmultiple\b/);
    assert.match(html, /id="retryPhotos"[^>]+type="submit" hidden/);
});

test('multiple photos upload sequentially with per-file progress and submitter data', async () => {
    const app = uploader([photo(), photo('second.png', { type: 'image/png', size: 8 * 1024 * 1024 })]);
    await app.submit();
    assert.equal(app.maxActive, 1);
    assert.deepEqual(app.requests.map(request => request.photo.fileName), ['family.jpg', 'second.png']);
    assert.ok(app.requests.every(request => request.action === 'submitPhoto' && request.photo.submitter === 'Pat Patterson' && request.photo.data === 'aGVsbG8='));
    assert.match(app.statuses[0], /photo 1 of 2: family.jpg/);
    assert.match(app.statuses[1], /photo 2 of 2: second.png/);
    assert.match(app.element('photoUploadStatus').textContent, /2 of 2 photos submitted/);
    assert.equal(app.element('photoUploadForm').resets, 1);
    assert.equal(app.element('retryPhotos').hidden, true);
    assert.equal(app.element('choosePhoto').disabled, false);
    assert.equal(app.element('photoFile').disabled, false);
});

test('a single photo still uploads and empty or invalid selections send nothing', async () => {
    const single = uploader([photo()]);
    await single.submit();
    assert.equal(single.requests.length, 1);
    for (const files of [
        [], [photo(), photo('bad.gif', { type: 'image/gif' })],
        [photo('large.jpg', { size: 8 * 1024 * 1024 + 1 })], [photo('empty.jpg', { size: 0 })]
    ]) {
        const app = uploader(files);
        await app.submit();
        assert.equal(app.requests.length, 0);
        assert.match(app.element('photoUploadStatus').textContent, /Choose/);
        assert.equal(app.element('choosePhoto').disabled, false);
    }
});

test('failed uploads do not stop the batch and retry does not duplicate successful photos', async () => {
    const app = uploader([photo('first.jpg'), photo('failed.jpg'), photo('last.jpg')]);
    app.failures.add('failed.jpg');
    await app.submit();
    assert.equal(app.requests.length, 3);
    assert.match(app.element('photoUploadStatus').textContent, /2 of 3 photos submitted.*failed.jpg: Upload unavailable/);
    assert.equal(app.element('retryPhotos').hidden, false);
    assert.equal(app.element('photoUploadForm').resets, 0);
    app.failures.clear();
    await app.submit();
    assert.deepEqual(app.requests.map(request => request.photo.fileName), ['first.jpg', 'failed.jpg', 'last.jpg', 'failed.jpg']);
    assert.equal(app.element('retryPhotos').hidden, true);
    assert.equal(app.element('photoUploadForm').resets, 1);
});

test('read errors and canceled reads are visible and other photos still upload', async () => {
    const app = uploader([photo('broken.jpg', { unreadable: true }), photo('canceled.jpg', { aborted: true }), photo()]);
    await app.submit();
    assert.equal(app.requests.length, 1);
    assert.match(app.element('photoUploadStatus').textContent, /broken.jpg: The selected photo could not be read/);
    assert.match(app.element('photoUploadStatus').textContent, /canceled.jpg: Reading the selected photo was canceled/);
});

test('new selections replace failed retry queues and duplicate submits are ignored', async () => {
    const app = uploader([photo('failed.jpg')]);
    app.failures.add('failed.jpg');
    await app.submit();
    app.element('photoFile').files = [photo('new.jpg')];
    app.element('photoFile').handlers.change();
    await app.submit();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(app.requests.map(request => request.photo.fileName), ['failed.jpg', 'new.jpg']);
    assert.equal(app.element('retryPhotos').hidden, true);
});

function reviewer() {
    const properties = new Map([['photoReview:photo-id', JSON.stringify({
        token: 'private-token', status: 'pending', submitter: 'Pat <Patterson>', fileName: 'family.jpg'
    })]]);
    const file = {
        moves: 0, sharing: 0, trashed: false,
        getThumbnail: () => ({ getContentType: () => 'image/jpeg', getBytes: () => [1, 2, 3] }),
        getUrl: () => 'https://drive.google.com/file/d/photo-id/view',
        getId: () => 'photo-id',
        getName: () => 'family.jpg',
        getMimeType: () => 'image/jpeg',
        moveTo() { this.moves += 1; },
        setSharing(access, permission) {
            assert.equal(access, 'ANYONE_WITH_LINK');
            assert.equal(permission, 'VIEW');
            this.sharing += 1;
        },
        setDescription() {},
        setTrashed(value) { this.trashed = value; }
    };
    let released = 0;
    const output = text => ({ text, setTitle() { return this; }, setMimeType() { return this; } });
    const context = vm.createContext({
        PropertiesService: { getScriptProperties: () => ({
            getProperty: key => properties.get(key),
            setProperty: (key, value) => properties.set(key, value)
        }) },
        ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }) },
        DriveApp: {
            Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
            getFileById: () => file,
            getFoldersByName: () => ({
                hasNext: () => true,
                next: () => ({ getFiles: () => {
                    let pending = file.moves > 0 && !file.trashed;
                    return { hasNext: () => pending, next: () => { pending = false; return file; } };
                } })
            })
        },
        HtmlService: { createHtmlOutput: output },
        ContentService: { MimeType: { JSON: 'json' }, createTextOutput: output },
        Utilities: { base64Encode: () => 'AQID' },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { released += 1; } }) },
        console: { error() {} }
    });
    vm.runInContext(source, context);
    return {
        context, file, properties,
        get released() { return released; },
        review: parameters => context.doGet({ parameter: { action: 'reviewPhoto', id: 'photo-id', token: 'private-token', ...parameters } }),
        decide: parameters => context.doPost({ parameter: { action: 'reviewPhoto', id: 'photo-id', token: 'private-token', decision: 'approve', ...parameters } }),
        approved: () => JSON.parse(context.doGet({ parameter: { action: 'listApprovedPhotos' } }).text)
    };
}

test('emailed review links render a top-level POST form without publishing on GET', () => {
    const app = reviewer();
    const page = app.review().text;
    assert.match(page, /<form method="post" action="https:\/\/script.google.com\/macros\/s\/test\/exec" target="_top"/);
    assert.match(page, /name="token" value="private-token"/);
    assert.match(page, /name="decision" value="approve"/);
    assert.match(page, /name="decision" value="reject"/);
    assert.match(page, /Pat &lt;Patterson&gt;/);
    assert.equal(app.file.moves, 0);
    assert.equal(app.file.sharing, 0);
    assert.equal(app.approved().photos.length, 0);
});

test('approval publishes once, rejection trashes, and invalid review credentials cannot mutate files', () => {
    const app = reviewer();
    assert.match(app.decide().text, /Photo approved/);
    assert.equal(app.file.moves, 1);
    assert.equal(app.file.sharing, 1);
    assert.equal(app.released, 1);
    assert.equal(app.approved().photos[0].id, 'photo-id');
    assert.match(app.decide().text, /Already reviewed/);
    assert.equal(app.file.moves, 1);
    assert.match(app.review().text, /value="approve" disabled/);

    const rejected = reviewer();
    assert.match(rejected.decide({ decision: 'reject' }).text, /Photo rejected/);
    assert.equal(rejected.file.trashed, true);
    assert.equal(rejected.file.sharing, 0);
    assert.equal(rejected.approved().photos.length, 0);
    for (const parameters of [{ token: 'wrong' }, { id: 'missing' }, { decision: 'invalid' }]) {
        const invalid = reviewer();
        assert.equal(JSON.parse(invalid.decide(parameters).text).success, false);
        assert.equal(invalid.file.moves, 0);
        assert.equal(invalid.file.trashed, false);
        assert.equal(invalid.released, 1);
    }
});
