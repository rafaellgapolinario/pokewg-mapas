#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Servidor estatico minimo (zero dependencias) so pra abrir o visualizador.
// Existe porque `file://` bloqueia fetch() de JSON - abrir o index.html no dedo
// nao funciona. Nada aqui e servidor "de jogo": e um `http.createServer` que
// devolve arquivo do disco.
//
//   npm run dev        -> http://localhost:8788
//   PORTA=9000 npm run dev
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORTA || process.env.PORT || 8788);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const servidor = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/visualizador/index.html';

  // trava de seguranca: nada de sair da raiz do repo com ../
  const alvo = path.join(RAIZ, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!alvo.startsWith(RAIZ)) {
    res.writeHead(403).end('403');
    return;
  }

  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 - nao encontrado: ' + rel + '\n\nFalta baixar os ativos? Rode: npm run fetch-assets');
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(alvo).pipe(res);
  });
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n✗ a porta ${PORTA} já está em uso.`);
    console.error(`  Feche o outro servidor ou escolha outra porta:  PORTA=9000 npm run dev\n`);
    process.exit(1);
  }
  throw e;
});

servidor.listen(PORTA, () => {
  console.log(`\n  Visualizador de mapas do PokeWG`);
  console.log(`  → http://localhost:${PORTA}\n`);
  const dirMapa = path.join(RAIZ, 'dados', 'map');
  const mapas = fs
    .readdirSync(dirMapa)
    .filter((f) => f.endsWith('.json') && !['manifest.json', 'offsets.json', 'draworder.json', 'collision.json'].includes(f));
  const atlas = fs.existsSync(path.join(RAIZ, 'dados', 'atlas'))
    ? fs.readdirSync(path.join(RAIZ, 'dados', 'atlas')).filter((f) => /\.(webp|png)$/.test(f))
    : [];
  console.log(`  mapas baixados: ${mapas.length}   paginas de atlas: ${atlas.length}`);
  if (!mapas.length || !atlas.length) console.log('  ⚠ falta baixar ativos → npm run fetch-assets\n');
  else console.log('');
});
