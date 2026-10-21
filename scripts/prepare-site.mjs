import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicExtensions = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.mp4']);

export async function prepareSite(root = repository) {
    const output = path.join(root, '_site');
    await rm(output, { recursive: true, force: true });
    await mkdir(output);
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if ((entry.isFile() && !entry.name.startsWith('.') && publicExtensions.has(path.extname(entry.name).toLowerCase())) ||
            (entry.isDirectory() && ['images', 'vendor'].includes(entry.name))) {
            await cp(path.join(root, entry.name), path.join(output, entry.name), { recursive: true });
        }
    }
    return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    prepareSite().then(output => console.log(`Public website prepared in ${output}`)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
