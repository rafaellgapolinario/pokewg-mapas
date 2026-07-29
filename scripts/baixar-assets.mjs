#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Baixa os ativos PESADOS que nao ficam no git:
//   - os mapas   -> dados/map/<slug>.json   (325 arquivos, ~198 MB no total)
//   - os atlas   -> dados/atlas/*.webp|png  (~41 MB)
//
// Tudo vem do CDN publico do proprio jogo (https://pokewg.com). Sao as MESMAS
// URLs que o navegador de qualquer jogador baixa ao entrar no mapa - nada aqui
// e privado nem exige login.
//
// Uso:
//   npm run fetch-assets                      # baixa o conjunto padrao (cerulean + amigos)
//   npm run fetch-assets -- cerulean abra     # baixa mapas especificos
//   npm run fetch-assets -- --todos           # baixa TODOS os 325 mapas (~198 MB)
//   npm run fetch-assets -- --atlas           # so os atlas
//   npm run fetch-assets -- cerulean --forcar # rebaixa mesmo se ja existir
//
// Por padrao baixa SO as paginas de atlas que os mapas escolhidos realmente usam
// (o cerulean sozinho usa uma fracao das 41 paginas). `--atlas-completo` traz todas.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_MAPA = path.join(RAIZ, 'dados', 'map');
const DIR_ATLAS = path.join(RAIZ, 'dados', 'atlas');
const BASE = process.env.POKEWG_BASE || 'https://pokewg.com';

// mapas que vem por padrao: o cerulean e o mapa do laudo (a loja de roupas fica nele);
// os outros dois dao um comparativo rapido de cidade e de hunt.
const PADRAO = ['cerulean', 'viridian', 'abra'];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const TODOS = flag('--todos') || flag('--all');
const FORCAR = flag('--forcar') || flag('--force');
const SO_ATLAS = flag('--atlas');
const ATLAS_COMPLETO = flag('--atlas-completo');
const SEM_ATLAS = flag('--sem-atlas');
const slugsArg = args.filter((a) => !a.startsWith('--'));

function lerJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function mb(n) {
  return (n / 1048576).toFixed(1) + ' MB';
}

async function baixar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buf);
  return buf.length;
}

async function main() {
  fs.mkdirSync(DIR_MAPA, { recursive: true });
  fs.mkdirSync(DIR_ATLAS, { recursive: true });

  const indice = lerJson(path.join(RAIZ, 'dados', 'maps-index.json'));
  const validos = new Set(indice.map((m) => m.slug));

  let slugs = [];
  if (!SO_ATLAS) {
    slugs = TODOS ? indice.map((m) => m.slug) : slugsArg.length ? slugsArg : PADRAO;
    const invalidos = slugs.filter((s) => !validos.has(s));
    if (invalidos.length) {
      console.error(`✗ mapa desconhecido: ${invalidos.join(', ')}`);
      console.error('  (a lista completa esta em dados/maps-index.json)');
      process.exit(1);
    }
  }

  // ── 1. mapas ───────────────────────────────────────────────────────────────
  let baixados = 0;
  let bytes = 0;
  for (const slug of slugs) {
    const destino = path.join(DIR_MAPA, slug + '.json');
    if (!FORCAR && fs.existsSync(destino)) {
      console.log(`· ${slug}.json ja existe (use --forcar pra rebaixar)`);
      continue;
    }
    const n = await baixar(`${BASE}/map/${slug}.json`, destino);
    baixados++;
    bytes += n;
    console.log(`✓ ${slug}.json  ${mb(n)}`);
  }
  if (slugs.length) console.log(`\n${baixados} mapa(s) baixado(s), ${mb(bytes)}\n`);

  if (SEM_ATLAS) return;

  // ── 2. atlas ───────────────────────────────────────────────────────────────
  // O manifest lista as paginas; o jogo referencia cada uma pelo NOME DO ARQUIVO
  // (`pages[i].image.split('/').pop()`), servido em /atlas/<arquivo>.
  const manifest = lerJson(path.join(DIR_MAPA, 'manifest.json'));
  const paginas = Object.values(manifest.categories)[0].pages;

  let indicesNecessarios;
  if (ATLAS_COMPLETO || SO_ATLAS) {
    indicesNecessarios = new Set(paginas.map((_, i) => i));
  } else {
    // so as paginas que os mapas presentes em dados/map/ realmente usam
    indicesNecessarios = new Set();
    const presentes = fs
      .readdirSync(DIR_MAPA)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((s) => validos.has(s));
    for (const slug of presentes) {
      const mp = lerJson(path.join(DIR_MAPA, slug + '.json'));
      for (const t of mp.tiles) {
        const a0 = manifest.assets[t[3]];
        if (a0) for (const f of a0.frames) indicesNecessarios.add(f.page);
        for (const it of t[4] || []) {
          const a = manifest.assets[it[0]];
          if (a) for (const f of a.frames) indicesNecessarios.add(f.page);
        }
      }
    }
    console.log(`Os mapas presentes usam ${indicesNecessarios.size} de ${paginas.length} paginas de atlas.`);
  }

  // paginas diferentes podem apontar pro mesmo arquivo (o johto repete) - deduplica
  const arquivos = new Set([...indicesNecessarios].map((i) => paginas[i].image.split('/').pop()));

  let atlasBaixados = 0;
  let atlasBytes = 0;
  for (const arq of arquivos) {
    const destino = path.join(DIR_ATLAS, arq);
    if (!FORCAR && fs.existsSync(destino)) continue;
    const n = await baixar(`${BASE}/atlas/${arq}`, destino);
    atlasBaixados++;
    atlasBytes += n;
    console.log(`✓ atlas/${arq}  ${mb(n)}`);
  }
  console.log(
    atlasBaixados
      ? `\n${atlasBaixados} pagina(s) de atlas, ${mb(atlasBytes)}`
      : '\nAtlas ja estava completo (nada a baixar).'
  );
  console.log('\nPronto. Agora rode:  npm run dev');
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
