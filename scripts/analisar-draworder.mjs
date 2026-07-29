#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Reproduz, em cima dos arquivos deste repo, o criterio do laudo da comunidade:
//
//   "id que aparece no mapa, com altura > 32px, que NAO e isGround e NAO esta
//    em draworder.top nem em draworder.toppers, deveria passar na frente de
//    quem esta atras dele."
//
// No cerulean isso da 1036 ids distintos / 16.209 usos, dos quais 296 estao
// hoje em draworder.bottom (a classe de coisa deitada no chao) - que e o caso
// da arara da loja de roupas.
//
// Uso:
//   node scripts/analisar-draworder.mjs                    # mapas baixados
//   node scripts/analisar-draworder.mjs cerulean --top 20
//   node scripts/analisar-draworder.mjs --todos            # todos os baixados
//   node scripts/analisar-draworder.mjs cerulean --json    # exporta candidatos
//   node scripts/analisar-draworder.mjs cerulean --aplicar # gera draworder corrigido
//
// Filtros de `--aplicar` (o laudo recomenda comecar pelo mais conservador):
//   --so-64            so ids 64x64 (default do --aplicar)
//   --so-blocking      so ids que bloqueiam passagem
//   --tudo             todos os candidatos (grosso, gera falso-positivo)
//
// NADA e escrito por cima dos dados originais: a saida vai pra saida/.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_MAPA = path.join(RAIZ, 'dados', 'map');
const DIR_SAIDA = path.join(RAIZ, 'saida');
const SUPORTE = ['manifest.json', 'offsets.json', 'draworder.json', 'collision.json'];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n, padrao) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};

const lerJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const manifest = lerJson(path.join(DIR_MAPA, 'manifest.json'));
const draworder = lerJson(path.join(DIR_MAPA, 'draworder.json'));
const collision = lerJson(path.join(DIR_MAPA, 'collision.json'));
const offsets = lerJson(path.join(DIR_MAPA, 'offsets.json'));

const assets = manifest.assets;
const TOP = new Set([...(draworder.top || []), ...(draworder.toppers || [])]);
const BOTTOM_PURO = new Set(draworder.bottom || []);
const BOTTOM = new Set([...(draworder.bottom || []), ...(draworder.borders || []), ...(draworder.onbottom || [])]);
const BLOCK = new Set(collision.blocking || []);

// mesma lista de ids que o cliente ignora ao desenhar (ver README, secao "ids ignorados")
const IGNORE = new Set([7124, 1510, 8274, 46638, 46639, 46620, 46621, 1511, 1024]);

// classe atual de cada id, indexada uma vez (includes em array de 22 mil e lento em laco).
// Prioridade top > toppers > bottom > borders > onbottom; sem entrada = "mid" (objeto comum).
const CLASSE = new Map();
for (const [nome, lista] of [
  ['top', draworder.top],
  ['toppers', draworder.toppers],
  ['bottom', draworder.bottom],
  ['borders', draworder.borders],
  ['onbottom', draworder.onbottom],
]) {
  for (const id of lista || []) if (!CLASSE.has(id)) CLASSE.set(id, nome);
}
const classe = (id) => CLASSE.get(id) || 'mid';

function mapasDisponiveis() {
  return fs
    .readdirSync(DIR_MAPA)
    .filter((f) => f.endsWith('.json') && !SUPORTE.includes(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function analisar(slug) {
  const mp = lerJson(path.join(DIR_MAPA, slug + '.json'));
  const usos = new Map(); // id -> quantas vezes aparece no mapa
  for (const t of mp.tiles) {
    for (const it of t[4] || []) {
      const id = it[0];
      if (!id || IGNORE.has(id)) continue;
      usos.set(id, (usos.get(id) || 0) + 1);
    }
  }
  const candidatos = [];
  for (const [id, n] of usos) {
    const a = assets[id];
    if (!a) continue;
    if (a.isGround) continue;
    if (a.height <= 32) continue;
    if (TOP.has(id)) continue;
    candidatos.push({
      id,
      usos: n,
      largura: a.width,
      altura: a.height,
      classe: classe(id),
      bloqueia: BLOCK.has(id),
      elevacao: offsets.elev?.[id] || 0,
    });
  }
  candidatos.sort((a, b) => b.usos - a.usos);
  const emBottom = candidatos.filter((c) => c.classe === 'bottom');
  return {
    slug,
    tiles: mp.tiles.length,
    idsDistintos: usos.size,
    candidatos,
    usosCandidatos: candidatos.reduce((a, c) => a + c.usos, 0),
    emBottom,
    usosEmBottom: emBottom.reduce((a, c) => a + c.usos, 0),
    emBottomLike: candidatos.filter((c) => BOTTOM.has(c.id)).length,
  };
}

function relatorio(r, topN) {
  console.log(`\n── ${r.slug} ──────────────────────────────────────────`);
  console.log(`tiles: ${r.tiles}   ids distintos no mapa: ${r.idsDistintos}`);
  console.log(`candidatos (h>32, nao-ground, fora de top+toppers): ${r.candidatos.length}  | usos: ${r.usosCandidatos}`);
  console.log(`  destes, em bottom/borders/onbottom: ${r.emBottomLike}`);
  console.log(`  destes, especificamente em draworder.bottom: ${r.emBottom.length}  | usos: ${r.usosEmBottom}`);
  console.log(`top + toppers (uniao global): ${TOP.size}`);
  if (topN > 0) {
    console.log(`\n  usos | id     | tamanho | classe   | bloqueia`);
    for (const c of r.candidatos.slice(0, topN)) {
      console.log(
        `  ${String(c.usos).padStart(4)} | ${String(c.id).padEnd(6)} | ${(c.largura + 'x' + c.altura).padEnd(7)} | ${c.classe.padEnd(8)} | ${c.bloqueia ? 'sim' : 'nao'}`
      );
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const disponiveis = mapasDisponiveis();
if (!disponiveis.length) {
  console.error('✗ nenhum mapa em dados/map/. Rode:  npm run fetch-assets');
  process.exit(1);
}
const pedidos = args.filter((a) => !a.startsWith('--') && disponiveis.includes(a));
const alvos = flag('--todos') ? disponiveis : pedidos.length ? pedidos : disponiveis;
const topN = Number(valor('--top', 20));

const resultados = alvos.map(analisar);
for (const r of resultados) relatorio(r, topN);

if (alvos.length > 1) {
  const uniao = new Map();
  for (const r of resultados) for (const c of r.candidatos) uniao.set(c.id, (uniao.get(c.id) || 0) + c.usos);
  console.log(`\n══ agregado (${alvos.length} mapas) ══`);
  console.log(`ids candidatos distintos: ${uniao.size}   usos somados: ${[...uniao.values()].reduce((a, b) => a + b, 0)}`);
}

if (flag('--json')) {
  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  for (const r of resultados) {
    const p = path.join(DIR_SAIDA, `candidatos-${r.slug}.json`);
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          criterio: 'altura > 32px E nao isGround E fora de draworder.top/toppers',
          mapa: r.slug,
          gerado: new Date().toISOString(),
          totalCandidatos: r.candidatos.length,
          totalUsos: r.usosCandidatos,
          candidatos: r.candidatos,
        },
        null,
        1
      )
    );
    console.log(`\n→ ${path.relative(RAIZ, p)}`);
  }
}

if (flag('--aplicar')) {
  const soBloqueia = flag('--so-blocking');
  const tudo = flag('--tudo');
  const so64 = flag('--so-64') || (!tudo && !soBloqueia);

  const promover = new Set();
  for (const r of resultados) {
    for (const c of r.candidatos) {
      if (tudo) promover.add(c.id);
      else if (so64 && c.largura === 64 && c.altura === 64 && c.bloqueia) promover.add(c.id);
      else if (soBloqueia && c.bloqueia) promover.add(c.id);
    }
  }

  // monta o draworder novo: o id sai de bottom/borders/onbottom e entra em top
  const novo = JSON.parse(JSON.stringify(draworder));
  for (const chave of ['bottom', 'borders', 'onbottom']) {
    novo[chave] = (novo[chave] || []).filter((id) => !promover.has(id));
  }
  novo.top = [...new Set([...(novo.top || []), ...promover])].sort((a, b) => a - b);

  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  const pSaida = path.join(DIR_SAIDA, 'draworder.json');
  fs.writeFileSync(pSaida, JSON.stringify(novo));
  const pPatch = path.join(DIR_SAIDA, 'propostas.json');
  fs.writeFileSync(
    pPatch,
    JSON.stringify(
      {
        gerado: new Date().toISOString(),
        mapasAnalisados: alvos,
        criterio: tudo ? 'todos os candidatos' : soBloqueia ? 'candidatos que bloqueiam passagem' : '64x64 E bloqueia passagem',
        promovidosParaTop: [...promover].sort((a, b) => a - b),
      },
      null,
      1
    )
  );
  console.log(`\n${promover.size} ids promovidos p/ draworder.top`);
  console.log(`→ ${path.relative(RAIZ, pSaida)}   (arquivo completo, pronto pra virar dados/map/draworder.json)`);
  console.log(`→ ${path.relative(RAIZ, pPatch)}  (so a lista do que mudou, pra revisao no PR)`);
  console.log(`\nAntes de abrir o PR: rode o visualizador com esse draworder e OLHE na tela.`);
}
