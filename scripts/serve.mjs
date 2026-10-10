import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['demo/index.html', 'text/html'], '/eh-search-tool.user.js': ['dist/eh-search-tool.user.js', 'text/javascript'] };
createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(await readFile(file[0])); }
  catch { res.writeHead(500).end('Run npm run build first.'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${process.env.PORT || 4173}`));
