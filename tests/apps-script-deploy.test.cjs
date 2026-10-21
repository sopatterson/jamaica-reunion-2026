const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const scriptId = '123456789012345678901234567890';
const deploymentId = 'AKfy-existing';
const baseline = "const SPREADSHEET_ID = 'sheet';\nfunction doGet() {}\nfunction doPost() {}\n";
const updated = baseline + '\nfunction setupTshirtManager() {}\n';
const manifest = { timeZone: 'America/New_York', webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' } };

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jamaica-deploy-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'index.html'), `const rsvpEndpoint = 'https://script.google.com/macros/s/${deploymentId}/exec';`);
    await fs.writeFile(path.join(root, 'google-apps-script.gs'), baseline);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', 'google-apps-script.gs'], { cwd: root });
    execFileSync('git', [
        '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
        'commit', '--quiet', '--no-gpg-sign', '-m', 'Fixture'
    ], { cwd: root });
    const files = new Map([
        ['Code.js', baseline], ['appsscript.json', JSON.stringify(manifest)],
        ['Extra.js', 'const remoteOnlyHelper = true;\n']
    ]);
    const calls = [];
    const state = { version: 18, wrongDeployment: false, skipPush: false };
    const run = async (args, cwd) => {
        calls.push(args);
        const command = args[0];
        if (command === 'list-deployments') return state.wrongDeployment ? [] : [{ deploymentId, versionNumber: state.version }];
        if (command === 'clone-script') {
            assert.equal(args[1], scriptId);
            await fs.mkdir(path.join(cwd, 'src'));
            await fs.writeFile(path.join(cwd, '.clasp.json'), JSON.stringify({ scriptId, rootDir: 'src' }));
            for (const [name, contents] of files) await fs.writeFile(path.join(cwd, 'src', name), contents);
        } else if (command === 'push') {
            if (state.skipPush) return;
            const names = await fs.readdir(path.join(cwd, 'src'));
            files.clear();
            for (const name of names) files.set(name, await fs.readFile(path.join(cwd, 'src', name), 'utf8'));
        } else if (command === 'pull') {
            for (const [name, contents] of files) await fs.writeFile(path.join(cwd, 'src', name), contents);
        } else if (command === 'create-version') {
            return { versionNumber: state.version + 1 };
        } else if (command === 'update-deployment') {
            assert.equal(args[1], deploymentId);
            state.version = Number(args[args.indexOf('--versionNumber') + 1]);
            return { deploymentId, versionNumber: state.version };
        } else {
            throw new Error('Unexpected clasp command: ' + command);
        }
    };
    const automation = await import('../scripts/apps-script-deploy.mjs');
    return { root, files, calls, state, run, ...automation };
}

test('link identifies the existing project/deployment without modifying Google files', async t => {
    const app = await fixture(t);
    const result = await app.linkProject(scriptId, app);
    assert.equal(result.deploymentId, deploymentId);
    assert.equal(result.backendFile, 'Code.js');
    assert.equal(result.versionNumber, 18);
    assert.equal(app.files.get('Code.js'), baseline);
    assert.ok(app.calls.every(args => !['push', 'create-version', 'update-deployment'].includes(args[0])));
    const entries = await fs.readdir(path.join(app.root, '.apps-script'));
    assert.deepEqual(entries, ['link.json']);
});

test('deployment preserves manifest and remote-only files and updates the same endpoint to a verified version', async t => {
    const app = await fixture(t);
    await app.linkProject(scriptId, app);
    await fs.writeFile(path.join(app.root, 'google-apps-script.gs'), updated);
    const changedManifest = { ...manifest, dependencies: { enabledAdvancedServices: [] } };
    app.files.set('appsscript.json', JSON.stringify(changedManifest));
    const result = await app.deployProject({ ...app, description: 'Manager notifications' });
    assert.equal(result.deploymentId, deploymentId);
    assert.equal(result.versionNumber, 19);
    assert.equal(result.previousVersionNumber, 18);
    assert.equal(app.files.get('Code.js'), updated);
    assert.equal(app.files.get('Extra.js'), 'const remoteOnlyHelper = true;\n');
    assert.deepEqual(JSON.parse(app.files.get('appsscript.json')), changedManifest);
    assert.deepEqual([...app.files.keys()].sort(), ['Code.js', 'Extra.js', 'appsscript.json']);
    assert.ok(app.calls.some(args => args[0] === 'pull'));
    assert.ok(!app.calls.some(args => args[0] === 'create-deployment' || args.includes('--force')));
    assert.deepEqual(await fs.readdir(path.join(app.root, '.apps-script')), ['link.json']);
});

test('unknown remote edits stop deployment before any push or version change', async t => {
    const app = await fixture(t);
    await app.linkProject(scriptId, app);
    await fs.writeFile(path.join(app.root, 'google-apps-script.gs'), updated);
    app.files.set('Code.js', baseline + '// Changed in the Google editor\n');
    await assert.rejects(app.deployProject(app), /changed in Google/);
    assert.ok(!app.calls.some(args => args[0] === 'push'));
    assert.equal(app.state.version, 18);
    assert.equal(await fs.readFile(path.join(app.root, 'google-apps-script.gs'), 'utf8'), updated);
});

test('a wrong script or deployment cannot be linked or accidentally receive a new deployment', async t => {
    const app = await fixture(t);
    app.state.wrongDeployment = true;
    await assert.rejects(app.linkProject(scriptId, app), /does not contain the versioned web-app deployment/);
    assert.ok(!app.calls.some(args => args[0] === 'clone-script'));
});

test('link refuses remote source that has not been integrated locally', async t => {
    const app = await fixture(t);
    app.files.set('Code.js', baseline + '// Unmerged remote change\n');
    await assert.rejects(app.linkProject(scriptId, app), /Merge the remote changes/);
    assert.ok(!app.calls.some(args => args[0] === 'push'));
});

test('a skipped or failed upload never produces a success-shaped deployment', async t => {
    const app = await fixture(t);
    await app.linkProject(scriptId, app);
    await fs.writeFile(path.join(app.root, 'google-apps-script.gs'), updated);
    app.state.skipPush = true;
    await assert.rejects(app.deployProject(app), /pushed source did not match/);
    assert.equal(app.state.version, 18);
    assert.ok(!app.calls.some(args => args[0] === 'update-deployment'));
});

test('tampering with the linked endpoint stops before a remote operation', async t => {
    const app = await fixture(t);
    await app.linkProject(scriptId, app);
    const before = app.calls.length;
    await fs.writeFile(path.join(app.root, 'index.html'), "const rsvpEndpoint = 'https://script.google.com/macros/s/OTHER/exec';");
    await assert.rejects(app.deployProject(app), /no longer matches this website/);
    assert.equal(app.calls.length, before);
});

test('public-site staging excludes OAuth, Apps Script, packages, and deployment sources', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jamaica-site-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const directory of ['.apps-script', 'node_modules', 'scripts', 'images', 'vendor']) {
        await fs.mkdir(path.join(root, directory));
    }
    for (const file of ['index.html', 'tshirts.js', 'google-apps-script.gs', '.clasp.json', 'package.json', '.env.js']) {
        await fs.writeFile(path.join(root, file), file);
    }
    for (const file of ['.apps-script/secret.json', 'node_modules/package.js', 'scripts/private.js', 'images/photo.jpg', 'vendor/xlsx.js']) {
        await fs.writeFile(path.join(root, file), file);
    }
    const { prepareSite } = await import('../scripts/prepare-site.mjs');
    const output = await prepareSite(root);
    assert.deepEqual((await fs.readdir(output)).sort(), ['images', 'index.html', 'tshirts.js', 'vendor']);
    assert.equal(await fs.readFile(path.join(output, 'images', 'photo.jpg'), 'utf8'), 'images/photo.jpg');
    assert.equal(await fs.readFile(path.join(output, 'vendor', 'xlsx.js'), 'utf8'), 'vendor/xlsx.js');
    await fs.writeFile(path.join(output, 'stale.json'), 'not public');
    await prepareSite(root);
    assert.ok(!(await fs.readdir(output)).includes('stale.json'));
});
