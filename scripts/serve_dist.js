import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const decoded = decodeURIComponent(url.pathname);
    let filePath = path.join(DIST, path.normalize(decoded));
    if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let stat = await fs.stat(filePath).catch(() => null);
    if ((!stat || stat.isDirectory()) && !path.extname(decoded)) {
      filePath = path.join(DIST, 'index.html');
      stat = await fs.stat(filePath).catch(() => null);
    }
    if (!stat) {
      res.writeHead(404).end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(await fs.readFile(filePath));
  } catch (err) {
    console.error('serve error:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving dist/ at http://${HOST}:${PORT}`);
});
