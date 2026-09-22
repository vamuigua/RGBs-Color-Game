/**
  * dev-server.mjs — zero-dependency static server for local testing.
 *
 *   node dev-server.mjs [port]
 *
 * The game uses ES modules and a service worker, so it cannot be opened from
 * file:// — both require an http origin. This exists purely so the project
 * still needs no build step and no npm install.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.ico': 'image/x-icon',
};

createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`);
	let pathname = decodeURIComponent(url.pathname);
	if (pathname.endsWith('/')) pathname += 'index.html';

	// normalize() collapses ../ segments so a request cannot escape ROOT.
	const file = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

	try {
		const body = await readFile(file);
		res.writeHead(200, {
			'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
			'Cache-Control': 'no-store',   // always serve the current edit
		});
		res.end(body);
	} catch {
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('404');
	}
}).listen(PORT, () => {
	console.log(`The RGBs Game -> http://localhost:${PORT}`);
});
