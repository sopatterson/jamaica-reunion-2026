import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authFile = path.join(homedir(), '.config', 'jamaica-reunion', 'clasp-auth.json');

function codeHash(code) {
    return createHash('sha256').update(code.replace(/\r\n/g, '\n').trim()).digest('hex');
}

function runProcess(command, args, options) {
    const result = spawnSync(command, args, options);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${path.basename(command)} exited with status ${result.status}.`);
    return result.stdout;
}

function claspRunner(root) {
    return async (args, cwd, json = false) => {
        const output = runProcess(process.execPath, [
            path.join(root, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js'),
            '--auth', authFile, ...(json ? ['--json'] : []), ...args
        ], { cwd, encoding: 'utf8', stdio: json ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
        return json ? JSON.parse(output) : undefined;
    };
}

async function endpointFor(root) {
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    const match = html.match(/const rsvpEndpoint = '(https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec)'/);
    if (!match) throw new Error('The existing Apps Script endpoint could not be identified in index.html.');
    return { endpoint: match[1], deploymentId: match[2] };
}

async function stageProject(root, scriptId, run) {
    const privateRoot = path.join(root, '.apps-script');
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(path.join(privateRoot, 'stage-'));
    try {
        await run(['clone-script', scriptId, '--rootDir', 'src'], directory);
        return directory;
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}

function requireDeployment(deployments, deploymentId) {
    const existing = Array.isArray(deployments) && deployments.find(item => item.deploymentId === deploymentId);
    if (!existing || !Number.isInteger(existing.versionNumber)) {
        throw new Error('This script does not contain the versioned web-app deployment used by the website. No changes were pushed.');
    }
    return existing;
}

async function saveState(root, state) {
    await writeFile(path.join(root, '.apps-script', 'link.json'), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export async function linkProject(scriptId, { root = repository, run = claspRunner(root) } = {}) {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(scriptId || '')) throw new Error('Provide the existing Script ID from Apps Script Project Settings.');
    const { deploymentId, endpoint } = await endpointFor(root);
    const deployments = await run(['list-deployments', scriptId], root, true);
    const existing = requireDeployment(deployments, deploymentId);
    const stage = await stageProject(root, scriptId, run);
    try {
        const sourceDirectory = path.join(stage, 'src');
        const candidates = [];
        for (const file of await readdir(sourceDirectory)) {
            if (!/\.(js|gs)$/.test(file)) continue;
            const code = await readFile(path.join(sourceDirectory, file), 'utf8');
            if (/function doGet\s*\(/.test(code) && /function doPost\s*\(/.test(code) && code.includes('SPREADSHEET_ID')) {
                candidates.push({ file, code });
            }
        }
        if (candidates.length !== 1) throw new Error('Could not identify exactly one remote reunion backend file. Inspect the project before linking.');
        const localCode = await readFile(path.join(root, 'google-apps-script.gs'), 'utf8');
        const committedCode = runProcess('git', ['show', 'HEAD:google-apps-script.gs'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
        const remoteHash = codeHash(candidates[0].code);
        if (remoteHash !== codeHash(localCode) && remoteHash !== codeHash(committedCode)) {
            throw new Error('The remote backend differs from both local and committed code. Merge the remote changes before linking; nothing was overwritten.');
        }
        const state = {
            scriptId, deploymentId, endpoint, backendFile: candidates[0].file,
            remoteCodeHash: remoteHash, versionNumber: existing.versionNumber
        };
        await saveState(root, state);
        return state;
    } finally {
        await rm(stage, { recursive: true, force: true });
    }
}

export async function deployProject({ root = repository, run = claspRunner(root), description = 'Reunion backend update' } = {}) {
    const state = JSON.parse(await readFile(path.join(root, '.apps-script', 'link.json'), 'utf8'));
    const endpoint = await endpointFor(root);
    if (state.deploymentId !== endpoint.deploymentId || state.endpoint !== endpoint.endpoint ||
        typeof state.backendFile !== 'string' || path.basename(state.backendFile) !== state.backendFile || !/\.(js|gs)$/.test(state.backendFile)) {
        throw new Error('The linked project no longer matches this website. Run the link command again before deploying.');
    }
    const deployments = await run(['list-deployments', state.scriptId], root, true);
    const existing = requireDeployment(deployments, state.deploymentId);
    const stage = await stageProject(root, state.scriptId, run);
    try {
        const remoteFile = path.join(stage, 'src', state.backendFile);
        const remoteHash = codeHash(await readFile(remoteFile, 'utf8'));
        const localHash = codeHash(await readFile(path.join(root, 'google-apps-script.gs'), 'utf8'));
        if (remoteHash !== state.remoteCodeHash && remoteHash !== localHash) {
            throw new Error('The backend changed in Google since the last sync. Merge those changes first; no files were pushed.');
        }
        const manifestFile = path.join(stage, 'src', 'appsscript.json');
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        await copyFile(path.join(root, 'google-apps-script.gs'), remoteFile);
        await run(['push'], stage);
        await run(['pull'], stage);
        if (codeHash(await readFile(remoteFile, 'utf8')) !== localHash) {
            throw new Error('The pushed source did not match the local backend. The live deployment was not changed.');
        }
        if (JSON.stringify(JSON.parse(await readFile(manifestFile, 'utf8'))) !== JSON.stringify(manifest)) {
            throw new Error('The remote manifest changed during deployment. The live deployment was not changed.');
        }
        const version = await run(['create-version', description], stage, true);
        if (!Number.isInteger(version.versionNumber)) throw new Error('Apps Script did not return a valid version. The live deployment was not changed.');
        const deployed = await run([
            'update-deployment', state.deploymentId,
            '--versionNumber', String(version.versionNumber), '--description', description
        ], stage, true);
        if (deployed.deploymentId !== state.deploymentId || deployed.versionNumber !== version.versionNumber) {
            throw new Error('The deployment result could not be verified. Check Manage deployments before continuing.');
        }
        const updated = {
            ...state, remoteCodeHash: localHash,
            previousVersionNumber: existing.versionNumber, versionNumber: deployed.versionNumber
        };
        await saveState(root, updated);
        return updated;
    } finally {
        await rm(stage, { recursive: true, force: true });
    }
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const run = claspRunner(repository);
    if (command === 'login') {
        await mkdir(path.dirname(authFile), { recursive: true, mode: 0o700 });
        await chmod(path.dirname(authFile), 0o700);
        await run(['login'], repository);
        await chmod(authFile, 0o600);
    } else if (command === 'status') {
        await run(['show-authorized-user'], repository);
    } else if (command === 'link') {
        const state = await linkProject(args[0]);
        console.log(`Linked the existing backend at version ${state.versionNumber}. Public endpoint unchanged.`);
    } else if (command === 'deploy') {
        const tests = (await readdir(path.join(repository, 'tests'))).filter(file => file.endsWith('.test.cjs')).map(file => path.join('tests', file));
        if (tests.length === 0) throw new Error('No regression tests found. Deployment stopped.');
        runProcess(process.execPath, ['--test', ...tests], { cwd: repository, stdio: 'inherit' });
        const state = await deployProject({ description: args.join(' ') || 'Reunion backend update' });
        console.log(`Verified deployment version ${state.versionNumber}: ${state.endpoint}`);
    } else if (command === 'open') {
        const state = JSON.parse(await readFile(path.join(repository, '.apps-script', 'link.json'), 'utf8'));
        await run(['open-script', state.scriptId], repository);
    } else {
        throw new Error('Usage: scripts/apps-script.sh login | status | link SCRIPT_ID | deploy [description] | open');
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
