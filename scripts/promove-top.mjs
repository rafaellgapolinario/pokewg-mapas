#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// promove-top.mjs — acha, em TODOS os mapas baixados, as pecas que deveriam
// cobrir o personagem e ainda nao estao em `draworder.top`.
//
// POR QUE ISSO EXISTE
// Hoje o jogador anda POR CIMA de arvore, telhado, poste e montanha. Metade do
// conserto e' o laco de desenho (codigo do cliente); a outra metade e' este
// arquivo de dados: se o id nao esta em `top`, nenhuma ordenacao o salva, porque
// bottom/borders/onbottom nem entram na fila ordenada — vao pro canvas achatado.
//
// O CRITERIO, E POR QUE ELE E' SEGURO DE AUTOMATIZAR
//   1. o sprite passa da altura do proprio tile  (height > 32)
//   2. nao e' chao                               (!isGround)
//   3. ainda nao esta em top nem toppers
//   4. **bloqueia passagem**                     (collision.blocking)
//
// O item 4 e' o que torna isto automatizavel. Se a peca bloqueia, o personagem
// NUNCA ocupa o tile dela — entao promover pra `top` so' pode melhorar: ele passa
// atras. Sem esse filtro aparece o artefato do vaso: peca que nao bloqueia, o
// jogador pisa dentro dela, e como `top` ele fica ENTERRADO embaixo do sprite.
//
// Descoberto na marra em 29/07/2026: no dado publicado, um portal de porta
// (18270) e um balcao (11822) sao indistinguiveis — 64x64, nao bloqueiam, mesma
// elevacao. Um precisa virar `top`, o outro nao pode. Nenhum campo do
// manifest.json separa os dois. Por isso peca que NAO bloqueia fica de fora daqui
// e so' entra na mao, olhando na tela.
//
// Uso:
//   node scripts/promove-top.mjs                 # so' relata, nao escreve nada
//   node scripts/promove-top.mjs --escrever      # aplica em dados/map/draworder.json
//   node scripts/promove-top.mjs --escrever --saida /tmp/draworder.json
//   node scripts/promove-top.mjs --mapas cerulean,viridian
//   node scripts/promove-top.mjs --relatorio propostas-auto.json
//
// Sai com codigo 1 se nao houver mapa nenhum baixado (senao um `--todos` que
// falhou passa despercebido e o relatorio sai vazio parecendo "nada a fazer").
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_MAPA = path.join(RAIZ, 'dados', 'map');

// arquivos que moram em dados/map mas NAO sao mapa
const NAO_MAPA = new Set(['manifest.json', 'collision.json', 'draworder.json', 'offsets.json']);

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n, padrao) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const ESCREVER = flag('--escrever');
const SAIDA = valor('--saida', path.join(DIR_MAPA, 'draworder.json'));
const RELATORIO = valor('--relatorio', null);
const SO_ESTES = valor('--mapas', null)?.split(',').map((s) => s.trim()).filter(Boolean);

const lerJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ─── entrada ────────────────────────────────────────────────────────────────

const manifest = lerJson(path.join(DIR_MAPA, 'manifest.json'));
const ASSETS = manifest.assets || manifest;
const colisao = lerJson(path.join(DIR_MAPA, 'collision.json'));
const ordem = lerJson(path.join(DIR_MAPA, 'draworder.json'));

const bloqueia = new Set(colisao.blocking || []);
const jaTop = new Set([...(ordem.top || []), ...(ordem.toppers || [])]);

let mapas = fs
  .readdirSync(DIR_MAPA)
  .filter((f) => f.endsWith('.json') && !NAO_MAPA.has(f))
  .map((f) => f.replace(/\.json$/, ''));

if (SO_ESTES) mapas = mapas.filter((m) => SO_ESTES.includes(m));

if (!mapas.length) {
  console.error('nenhum mapa baixado em dados/map. Rode antes:');
  console.error('  npm run fetch-assets -- --todos --sem-atlas');
  process.exit(1);
}

// ─── varre os mapas ─────────────────────────────────────────────────────────
// Guarda quantas vezes cada id aparece e em quantos mapas distintos. As duas
// contas servem pra ordenar o relatorio: id usado em 200 mapas importa mais que
// id usado 200 vezes num mapa so'.

const usos = new Map();
const mapasDoId = new Map();
let tilesLidos = 0;

for (const nome of mapas) {
  const mapa = lerJson(path.join(DIR_MAPA, nome + '.json'));
  const vistos = new Set();
  for (const t of mapa.tiles || []) {
    tilesLidos++;
    const ids = [];
    if (t[3]) ids.push(t[3]);
    for (const item of t[4] || []) if (item && item[0]) ids.push(item[0]);
    for (const id of ids) {
      usos.set(id, (usos.get(id) || 0) + 1);
      vistos.add(id);
    }
  }
  for (const id of vistos) mapasDoId.set(id, (mapasDoId.get(id) || 0) + 1);
}

// ─── aplica o criterio ──────────────────────────────────────────────────────

const promover = [];
const recusados = { naoBloqueia: 0, baixo: 0, chao: 0, jaEstaTop: 0 };

for (const [id, n] of usos) {
  const a = ASSETS[id] || ASSETS[String(id)];
  if (!a) continue;
  if (jaTop.has(id)) { recusados.jaEstaTop++; continue; }
  if (a.isGround === true) { recusados.chao++; continue; }
  if ((a.height || 0) <= 32) { recusados.baixo++; continue; }
  if (!bloqueia.has(id)) { recusados.naoBloqueia++; continue; }   // <- a trava do vaso
  promover.push({
    id,
    tamanho: `${a.width}x${a.height}`,
    de: ordem.bottom?.includes(id) ? 'bottom'
      : ordem.borders?.includes(id) ? 'borders'
      : ordem.onbottom?.includes(id) ? 'onbottom'
      : 'mid',
    para: 'top',
    bloqueia: true,
    usos: n,
    mapas: mapasDoId.get(id) || 0,
  });
}

promover.sort((a, b) => b.mapas - a.mapas || b.usos - a.usos);

// ─── novo draworder ─────────────────────────────────────────────────────────
// Promover NAO e' so' acrescentar em `top`: o id tem que sair de bottom, borders
// e onbottom, senao ele continua sendo desenhado na banda achatada tambem e
// aparece duas vezes. E' o mesmo que o visualizador faz ao baixar o arquivo.

const alvo = new Set(promover.map((p) => p.id));
const novo = { ...ordem };
novo.top = [...new Set([...(ordem.top || []), ...alvo])].sort((a, b) => a - b);
for (const k of ['bottom', 'borders', 'onbottom']) {
  if (novo[k]) novo[k] = novo[k].filter((id) => !alvo.has(id));
}

// ─── relato ─────────────────────────────────────────────────────────────────

const fmt = (n) => n.toLocaleString('pt-BR');

console.log(`\nmapas lidos            ${fmt(mapas.length)}  (${fmt(tilesLidos)} tiles)`);
console.log(`ids distintos em uso   ${fmt(usos.size)}`);
console.log(`\nPROMOVER PARA top      ${fmt(promover.length)}`);
console.log('  recusados:');
console.log(`    ja' esta em top      ${fmt(recusados.jaEstaTop)}`);
console.log(`    e' chao              ${fmt(recusados.chao)}`);
console.log(`    altura <= 32         ${fmt(recusados.baixo)}`);
console.log(`    NAO bloqueia         ${fmt(recusados.naoBloqueia)}   <- ficam de fora de proposito (caso do vaso)`);

const deOnde = {};
for (const p of promover) deOnde[p.de] = (deOnde[p.de] || 0) + 1;
console.log('\n  vindos de:', Object.entries(deOnde).map(([k, v]) => `${k} ${fmt(v)}`).join(' · '));

console.log(`\ndraworder.top          ${fmt((ordem.top || []).length)} -> ${fmt(novo.top.length)}`);
for (const k of ['bottom', 'borders', 'onbottom']) {
  const antes = (ordem[k] || []).length, depois = (novo[k] || []).length;
  if (antes !== depois) console.log(`draworder.${k.padEnd(10)} ${fmt(antes)} -> ${fmt(depois)}`);
}

console.log('\nos 15 mais espalhados pelo jogo:');
console.log('   mapas    usos   id        tamanho   classe hoje');
for (const p of promover.slice(0, 15)) {
  console.log(
    '  ' + String(p.mapas).padStart(6) + '  ' + String(p.usos).padStart(6) +
    '   ' + String(p.id).padEnd(8) + '  ' + p.tamanho.padEnd(8) + '  ' + p.de
  );
}

if (RELATORIO) {
  const rel = {
    gerado: new Date().toISOString(),
    criterio: 'height>32 && !isGround && !top && bloqueia passagem',
    porQueBloqueia:
      'peca que bloqueia nunca tem o jogador no proprio tile, entao promover so pode melhorar. ' +
      'peca que NAO bloqueia fica de fora: o jogador pisa dentro e como top ficaria enterrado.',
    mapasLidos: mapas.length,
    mudancas: promover,
  };
  fs.writeFileSync(RELATORIO, JSON.stringify(rel, null, 1));
  console.log(`\nrelatorio -> ${RELATORIO}`);
}

if (ESCREVER) {
  fs.writeFileSync(SAIDA, JSON.stringify(novo));
  console.log(`draworder -> ${SAIDA}`);
} else {
  console.log('\n(nada foi escrito — use --escrever)');
}
console.log();
