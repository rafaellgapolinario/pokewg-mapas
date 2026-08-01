// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZADOR DE MAPAS DO POKEWG
//
// Isto e SO O DESENHO DO CENARIO, extraido do cliente do jogo (app/play/MapView.tsx).
// Nao ha combate, captura, PvP, boss, chat, montaria nem GM aqui - e proposital.
// O "boneco" na tela e uma SONDA de teste: existe so pra voce ver quem fica na
// frente e quem fica atras. Ele nao e o jogador e nao faz nada alem de andar.
//
// A matematica de posicao dos tiles e IDENTICA a do jogo. Se voce mudar o
// draworder.json e ficar certo aqui, fica certo la.
// ═══════════════════════════════════════════════════════════════════════════

const TILE = 32;

// Ids que o cliente do jogo NAO desenha (marcadores internos do editor de mapa,
// tapa-buraco de borda etc). Copiado do cliente pra o desenho bater 1:1.
const IGNORE = new Set([7124, 1510, 8274, 46638, 46639, 46620, 46621, 1511, 1024]);

// ═══ ORDEM DE DESENHO ═══════════════════════════════════════════════════════
// Cada ANDAR z e desenhado inteiro, do mais fundo (maxZ) pro mais alto (minZ).
// Um andar tem duas bandas:
//
//   CHAO  (o campo chao + tudo que esta em BOTTOM)
//         pintada na ordem de VARREDURA, no fundo do andar. Nao e ordenada de
//         proposito — ver o comentario em desenharTile().
//   ITEM  (mid e top) + a sonda
//         ordenada por  chave = profundidade(tx,ty) + prioridade + SALTO_ITEM
//
// O SALTO_ITEM poe a banda item inteira acima da banda chao do MESMO andar, sem
// disputa por y. Prioridade dentro da banda item:
//   objeto comum 0.3  <  sonda 0.4  <  topo (telhado/copa) 0.6
//
// O 0.4 da SONDA veio junto com a formula nova de profundidade, copiado do
// P_CRIATURA do PIW — antes era 0.5. Medido no PWG antes de ficar
// (ferramentas/mede-sonda.py), porque numero emprestado de outro jogo nao vale
// como verdade aqui: os dois valores caem no intervalo aberto (0.3, 0.6), e a
// chave de item so sobe de 0,001 em 0,001 dentro do tile, entao so um tile com
// mais de 100 pecas conseguiria cair entre 0.4 e 0.5. A maior pilha dos 330
// mapas publicados tem 33 pecas (cerulean, tile -45,8,7), em 8.188.199 tiles.
// 0.4 e 0.5 dao a MESMA ordem em todo o jogo — o 0.4 nao muda pixel, so alinha
// o nome do numero com o do PIW.
const P_BOTTOM = 0;
const P_MID = 0.3;
const P_SONDA = 0.4;
const P_TOP = 0.6;
const SALTO_ITEM = 8e6;

// A profundidade usa as DUAS coordenadas. O andar de cima e desenhado deslocado
// em x E y (fo = (z-GZ)*32 nas duas), entao a profundidade tem que andar na mesma
// diagonal — ordenar so por y deixa a parede do fundo cobrir a peca da frente.
// O 4*tx e o desempate lateral; 4096 e' folga pra ele nunca alcancar a linha
// seguinte.
const profundidade = (tx, ty) => (tx + ty) * 4096 + 4 * tx;

const CORES = {
  top: '#58c4ff',
  toppers: '#9b7cff',
  bottom: '#ff5f5f',
  borders: '#ffb347',
  onbottom: '#ffe066',
  mid: '#7ec8a0',
};

// ── estado ────────────────────────────────────────────────────────────────
let assets = {};          // manifest.assets: id -> { width, height, isGround, frameCount, frames[] }
let paginas = [];         // manifest.categories['map-items'].pages
let disp = {};            // offsets.disp: id -> [dx, dy]  (deslocamento de desenho do sprite)
let elev = {};            // offsets.elev: id -> px        (altura que o item empilha)
let draworder = null;     // arquivo cru (usado no export)
let CLASSE = new Map();   // id -> 'top'|'toppers'|'bottom'|'borders'|'onbottom'
let TOP_ORIG = new Set(); // top + toppers
let BOT_ORIG = new Set(); // bottom + borders + onbottom
let BORDERS = new Set();  // so borders — decide quem achata na banda de baixo
let TOP = new Set();      // efetivos = originais + propostas aplicadas
let BOTTOM = new Set();
let BLOCK = new Set();    // collision.blocking
let indiceMapas = [];     // dados/maps-index.json
let nomes = new Map();    // slug -> { nome, area, nivel } (de map-markers.json)

let slugAtual = null;
let tileAt = new Map();   // "x,y,z" -> tile
let shadowMap = new Map();// "x,y" (chao coberto) -> tiles de telhado que o cobrem
let esconderCache = { x: NaN, y: NaN, set: new Set() };
let GZ = 7, minZ = 0, maxZ = 11;
let minX = 0, minY = 0, maxX = 0, maxY = 0;
let NOCOVER = false;      // _meta.noFloorCover: mapa que nunca esconde telhado
let WALK = null;          // _meta.walk = [minX, minY, maxX, maxY] andavel
let spawns = [];          // pontos de spawn do dados/spawns/<slug>.json
let inicio = null;        // spawn.start
let paginasImg = new Map();// indice da pagina -> canvas ja decodificado

// camera / sonda
let escala = 1.6, camX = 0, camY = 0, seguir = true;
let sonda = { x: 0, y: 0, rx: 0, ry: 0, t0: 0, dur: 0, dir: 'down' };
let atravessar = false;
const teclas = Object.create(null);

// propostas de reclassificacao (o trabalho do dev)
let propostas = new Map(); // id -> 'top' | 'bottom' | 'mid'

// ── UM OFFSCREEN POR ANDAR ────────────────────────────────────────────────
// Antes era um offscreen achatado com tudo dentro, mais uma fila global por y.
// Isso fazia a parede interna do terreo (y alto) desenhar por cima do telhado
// do andar de cima (y baixo): o interior do predio vazava pra laje.
//
// Agora cada andar tem o seu, colado na ordem do andar. Quem esta num andar mais
// alto NUNCA perde pra quem esta num andar mais baixo, independente de y — que e
// o unico jeito de o telhado ficar inteiro.
//
// O QUE PRECISA SER POR ANDAR E A ORDEM DE PINTURA, NAO O CANVAS.
// Colar N canvas em sequencia da exatamente o mesmo pixel que pintar os N, na
// mesma sequencia, dentro de um so. Entao continuam sendo DOIS offscreens, como
// ja eram — o que muda e o que entra em cada um e em que ordem:
//
//   mapCv  andares z >= GZ (subsolo e o chao), do mais fundo pro chao
//   topCv  andares z <  GZ (os pavimentos de cima), do mais baixo pro mais alto
//
// Dentro de CADA andar: primeiro a banda chao (ordem de varredura), depois a
// banda item (ordenada por profundidade). E por isso que a laje do andar de cima
// para de ser furada pela parede do terreo.
//
// Medido nos 325 mapas: uma janela chega a tocar 15 andares. Um canvas por andar
// seria 15 canvas de tela cheia — por isso dois, com a ordem certa dentro.
const mapCv = document.createElement('canvas');
const mctx = mapCv.getContext('2d');
const topCv = document.createElement('canvas');
const tctx = topCv.getContext('2d');
let chaveCache = '', mapOx = 0, mapOy = 0;
let objQ = [];  // banda ITEM do andar do chao: fila viva, desenhada junto com a sonda
let itemQ = new Map(); // z -> banda ITEM dos demais andares
let dbgQ = [];  // mesma lista, mas com TUDO (inclusive chao/bottom), so pros overlays

const tela = document.getElementById('tela');
const ctx = tela.getContext('2d');
let tileSelecionado = null;

// ── util ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const chave3 = (x, y, z) => x + ',' + y + ',' + z;
const pegaTile = (x, y, z) => tileAt.get(chave3(x, y, z));

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error(`${r.status} em ${url}`), { status: r.status, url });
  return r.json();
}

function carregando(txt, erro) {
  const el = $('carregando');
  el.classList.toggle('on', !!txt);
  el.classList.toggle('erro', !!erro);
  $('carregando-txt').innerHTML = txt || '';
}

function classeDe(id) {
  return CLASSE.get(id) || 'mid';
}

// candidato pelo criterio do laudo: sobe acima do proprio tile, nao e chao,
// e nao esta classificado como topo. Deveria passar na frente de quem esta atras.
function ehCandidato(id) {
  const a = assets[id];
  return !!a && !a.isGround && a.height > TILE && !TOP_ORIG.has(id);
}
// candidato que ainda esta como "deitado no chao" = o caso da arara da loja
function ehCritico(id) {
  return ehCandidato(id) && BOT_ORIG.has(id);
}

// ── carga dos arquivos de suporte ─────────────────────────────────────────
async function carregarSuporte() {
  carregando('Carregando manifest, draworder, offsets e colisão…');
  const [mf, of_, dr, co, idx] = await Promise.all([
    json('/dados/map/manifest.json'),
    json('/dados/map/offsets.json'),
    json('/dados/map/draworder.json'),
    json('/dados/map/collision.json'),
    json('/dados/maps-index.json'),
  ]);
  const mk = await json('/dados/map-markers.json').catch(() => ({ hunts: [] }));

  assets = mf.assets;
  paginas = Object.values(mf.categories)[0].pages;
  disp = of_.disp || {};
  elev = of_.elev || {};
  draworder = dr;
  BLOCK = new Set(co.blocking || []);
  indiceMapas = idx;
  for (const h of mk.hunts || []) nomes.set(h.slug, { nome: h.name, area: h.area, nivel: h.level });

  // prioridade top > toppers > bottom > borders > onbottom (um id pode estar em mais de uma lista)
  CLASSE = new Map();
  for (const nome of ['top', 'toppers', 'bottom', 'borders', 'onbottom']) {
    for (const id of dr[nome] || []) if (!CLASSE.has(id)) CLASSE.set(id, nome);
  }
  TOP_ORIG = new Set([...(dr.top || []), ...(dr.toppers || [])]);
  BOT_ORIG = new Set([...(dr.bottom || []), ...(dr.borders || []), ...(dr.onbottom || [])]);
  BORDERS = new Set(dr.borders || []);
  recalcularConjuntos();
}

// aplica (ou nao) as propostas por cima da classificacao original
function recalcularConjuntos() {
  TOP = new Set(TOP_ORIG);
  BOTTOM = new Set(BOT_ORIG);
  if ($('c-propostas').checked) {
    for (const [id, para] of propostas) {
      TOP.delete(id);
      BOTTOM.delete(id);
      if (para === 'top') TOP.add(id);
      else if (para === 'bottom') BOTTOM.add(id);
    }
  }
  chaveCache = ''; // invalida o offscreen
}

// ── carga de um mapa ──────────────────────────────────────────────────────
async function carregarMapa(slug) {
  carregando(`Carregando <b>${slug}</b>…`);
  let mp;
  try {
    mp = await json('/dados/map/' + slug + '.json');
  } catch (e) {
    carregando(
      `O mapa <b>${slug}</b> não está baixado.<br><br>` +
        `Rode no terminal:<br><code>npm run fetch-assets -- ${slug}</code><br><br>` +
        `(ou <code>npm run fetch-assets -- --todos</code> pra baixar os 325)`,
      true
    );
    throw e;
  }

  slugAtual = slug;
  tileAt = new Map();
  const zs = new Set();
  minX = minY = maxX = maxY = 0;
  for (const t of mp.tiles) {
    tileAt.set(chave3(t[0], t[1], t[2]), t);
    zs.add(t[2]);
    if (t[0] < minX) minX = t[0];
    if (t[1] < minY) minY = t[1];
    if (t[0] > maxX) maxX = t[0];
    if (t[1] > maxY) maxY = t[1];
  }
  minZ = Math.min(...zs);
  maxZ = Math.max(...zs);
  GZ = mp._meta?.groundZ ?? 7;
  NOCOVER = !!mp._meta?.noFloorCover;
  WALK = Array.isArray(mp._meta?.walk) ? mp._meta.walk : null;

  // shadowMap do floor-cover: um telhado em z<GZ e desenhado deslocado (GZ-z) tiles
  // pra cima-esquerda, entao ele "cobre" o chao em (x-(GZ-z), y-(GZ-z)).
  shadowMap = new Map();
  for (const t of mp.tiles) {
    const z = t[2];
    if (z < GZ && t[3]) {
      const k = t[0] - (GZ - z) + ',' + (t[1] - (GZ - z));
      let a = shadowMap.get(k);
      if (!a) shadowMap.set(k, (a = []));
      a.push(t);
    }
  }
  esconderCache = { x: NaN, y: NaN, set: new Set() };

  // spawns (arquivo separado; cidade nao tem)
  spawns = [];
  inicio = null;
  try {
    const sp = await json('/dados/spawns/' + slug + '.json');
    spawns = sp.spawns || [];
    inicio = sp.start || null;
  } catch { /* mapa sem config de spawn */ }

  // posicao inicial da sonda: o `start` do spawn-config; se for solido, o centro do walk
  let px = inicio?.x ?? 0, py = inicio?.y ?? 0;
  if (solido(px, py)) {
    if (WALK) {
      px = Math.round((WALK[0] + WALK[2]) / 2);
      py = Math.round((WALK[1] + WALK[3]) / 2);
    }
    if (solido(px, py)) {
      busca: for (let r = 0; r < 200; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (!solido(px + dx, py + dy)) { px += dx; py += dy; break busca; }
    }
  }
  sonda = { x: px, y: py, rx: px, ry: py, t0: 0, dur: 0, dir: 'down' };
  seguir = true;
  chaveCache = '';

  // pre-carrega as paginas de atlas usadas por este mapa (senao os tiles "piscam")
  carregando(`Carregando sprites de <b>${slug}</b>…`);
  const usadas = new Set();
  for (const t of mp.tiles) {
    const a0 = assets[t[3]];
    if (a0) for (const f of a0.frames) usadas.add(f.page);
    for (const it of t[4] || []) {
      const a = assets[it[0]];
      if (a) for (const f of a.frames) usadas.add(f.page);
    }
  }
  const faltando = [];
  await Promise.all(
    [...usadas].map(
      (i) =>
        new Promise((ok) => {
          if (paginasImg.has(i)) return ok();
          const im = new Image();
          im.onload = () => { paginasImg.set(i, paraCanvas(im)); ok(); };
          im.onerror = () => { faltando.push(paginas[i].image.split('/').pop()); ok(); };
          im.src = '/dados/atlas/' + paginas[i].image.split('/').pop();
        })
    )
  );
  if (faltando.length === usadas.size && usadas.size) {
    carregando(
      `Nenhuma página de atlas encontrada.<br><br>Rode:<br><code>npm run fetch-assets</code>`,
      true
    );
    throw new Error('sem atlas');
  }

  atualizarMeta(mp);
  carregando('');
}

// webp/png decodificado 1x pra canvas: drawImage direto do <img> re-decodifica em
// alguns navegadores e engasga o frame (mesmo motivo do cliente).
function paraCanvas(im) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  return c;
}

function atualizarMeta(mp) {
  const info = indiceMapas.find((m) => m.slug === slugAtual) || {};
  const n = nomes.get(slugAtual);
  $('meta-mapa').innerHTML =
    `${n ? `<b>${n.nome}</b> · ${n.area}${n.nivel ? ' · nível ' + n.nivel : ''}<br>` : ''}` +
    `${mp.tiles.length.toLocaleString('pt-BR')} tiles · groundZ ${GZ} · z ${minZ}–${maxZ}<br>` +
    `andável ${WALK ? WALK.join(', ') : '—'}<br>` +
    `${spawns.length} ponto(s) de spawn` +
    (info.noFloorCover ? ' · <i>sem floor-cover</i>' : '');

  // qualidade do spawn: ponto em tile bloqueado nunca nasce bicho no jogo.
  // Sao os pontos que aparecem em VERMELHO no mapa.
  const presos = spawns.filter((s) => solido(s.x, s.y));
  $('aviso-spawn').innerHTML = spawns.length
    ? presos.length
      ? `<span style="color:#ff6b6b">⚠ ${presos.length} de ${spawns.length} spawn(s) em tile bloqueado</span> — em vermelho no mapa.`
      : `<span style="color:#7ec8a0">✓ todos os ${spawns.length} spawns caem em tile andável.</span>`
    : 'Este mapa não tem arquivo de spawn (cidade / arena).';
}

// ── colisao ───────────────────────────────────────────────────────────────
function solido(x, y) {
  if (WALK && (x < WALK[0] || y < WALK[1] || x > WALK[2] || y > WALK[3])) return true;
  const t = pegaTile(x, y, GZ);
  if (!t) return true;
  if (BLOCK.has(t[3])) return true;
  for (const it of t[4] || []) if (BLOCK.has(it[0])) return true;
  return false;
}

// telhados a esconder: SO os do predio em que a sonda esta (flood-fill da sombra
// conectada). Vazio = nao esconde nada (sonda na rua).
function telhadosEscondidos() {
  if (esconderCache.x === sonda.x && esconderCache.y === sonda.y) return esconderCache.set;
  const esconder = new Set();
  if (!NOCOVER && $('c-telhado').checked && shadowMap.has(sonda.x + ',' + sonda.y)) {
    const visto = new Set([sonda.x + ',' + sonda.y]);
    const pilha = [[sonda.x, sonda.y]];
    while (pilha.length) {
      const [x, y] = pilha.pop();
      for (const rt of shadowMap.get(x + ',' + y) || []) esconder.add(chave3(rt[0], rt[1], rt[2]));
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = nx + ',' + ny;
        if (!visto.has(nk) && shadowMap.has(nk)) { visto.add(nk); pilha.push([nx, ny]); }
      }
    }
  }
  esconderCache = { x: sonda.x, y: sonda.y, set: esconder };
  return esconder;
}

// ── desenho de um sprite ──────────────────────────────────────────────────
// A conta de posicao e IDENTICA a do cliente:
//   fo = (z - groundZ) * 32           -> andar acima do chao sobe/esquerda 1 tile por andar
//   dx = x*32 - (largura - 32) - disp[0] + fo
//   dy = y*32 - (altura  - 32) - disp[1] - (elev + empilhamento) + fo
function retangulo(id, tx, ty, tz, ex) {
  const a = assets[id];
  const d = disp[id] || [0, 0];
  const fo = (tz - GZ) * TILE;
  return {
    x: tx * TILE - (a.width - TILE) - d[0] + fo,
    // `ex` e a elevacao ACUMULADA das pecas desenhadas ANTES desta no tile. A
    // elevacao da PROPRIA peca nao levanta ela — so as que vierem depois.
    // Era `((elev[id]||0) + ex)`, que levantava a peca por ela mesma. No PIW,
    // placeSprite() recebe o acumulado e DEVOLVE a elevacao propria, e o
    // chamador soma depois: `r = min(32, r + placeSprite(d,n,i,a,r,x,t))`.
    // Com a formula antiga a mesa de 4 tiles do saguao do Centro Pokemon saia
    // com degrau: coluna esquerda (18273/18259, elev 6) 6px acima da direita
    // (18272/18260, elev 0). No jogo ao vivo ela e lisa.
    y: ty * TILE - (a.height - TILE) - d[1] - ex + fo,
    w: a.width,
    h: a.height,
  };
}

function quadro(a, agora, congelar) {
  return !congelar && a.frameCount > 1
    ? a.frames[Math.floor(agora / (a.frameDurationMs || 500)) % a.frameCount]
    : a.frames[0];
}

// desenha no CANVAS DO ANDAR. `destino` e o contexto do andar do tile — quem
// chama ja sabe em qual andar esta desenhando.
function blit(id, tx, ty, tz, ex, agora, congelar, destino) {
  if (!id || IGNORE.has(id)) return;
  const a = assets[id];
  if (!a) return;
  const f = quadro(a, agora, congelar);
  const pg = paginasImg.get(f.page);
  if (!pg) return;
  const r = retangulo(id, tx, ty, tz, ex);
  destino.drawImage(pg, f.x, f.y, f.w, f.h, r.x, r.y, f.w, f.h);
}

// espelho do blit desenhando DIRETO NA TELA — usado por quem entra na fila
// y-ordenada junto com a sonda (objetos e topos)
function blitTela(id, tx, ty, tz, ex, agora) {
  if (!id || IGNORE.has(id)) return;
  const a = assets[id];
  if (!a) return;
  const f = quadro(a, agora, false);
  const pg = paginasImg.get(f.page);
  if (!pg) return;
  const r = retangulo(id, tx, ty, tz, ex);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(pg, f.x, f.y, f.w, f.h, r.x, r.y, f.w, f.h);
  ctx.imageSmoothingEnabled = false;
}

// ── AS DUAS BANDAS DE UM ANDAR ────────────────────────────────────────────
// chao + BOTTOM  -> banda CHAO: pintada na ordem de varredura, no fundo do andar
// mid (0.3) e top (0.6) -> banda ITEM: ordenada por profundidade + prioridade
//
// Consequencia: qualquer id que esteja em bottom/borders/onbottom NUNCA cobre a
// sonda, por mais alto que o sprite seja. E exatamente por isso que reclassificar
// os ids da lista de oclusao resolve a arara da loja de roupas, a arvore e o
// balcao - sem tocar em uma linha de codigo.
//
// A banda CHAO fica em ordem de VARREDURA de proposito, nao ordenada por
// profundidade. Peca larga de terreno (mancha de terra, transicao de grama) e
// desenhada a partir do canto superior-esquerdo dela; ordenar a banda chao por
// profundidade faz o capim do tile seguinte cobri-la. Medido no cerulean: 4.273
// pixels de terreno errado, e zero ganho de oclusao.
function desenharTile(t, agora, depurar, dest) {
  const tx = t[0], ty = t[1], tz = t[2];
  const itens = (t[4] || []).map((i) => i[0]).filter((id) => id && !IGNORE.has(id));
  // a pilha INVERTIDA, usada nas passadas de `borders` e de `top`. E a regra do
  // renderizador de referencia (`g = e[4].length>1 ? [...e[4]].reverse() : e[4]`)
  // e responde por 99,8% da diferenca que sobrava contra ele. Foi conferida no
  // jogo ao vivo: o terreno com blocos de borda dura aparece la tambem.
  const inv = itens.length > 1 ? [...itens].reverse() : itens;

  // banda ITEM. O andar do CHAO manda pra fila viva (objQ), que e desenhada na
  // tela junto com a sonda; os outros andares mandam pra fila do proprio andar,
  // que e desenhada no canvas do andar.
  //
  // O subsolo (tz > GZ) tambem entra na fila do proprio andar. Ele nao vaza por
  // cima da rua porque o canvas dele e colado ANTES do canvas do chao — nao
  // porque ele fica fora da ordenacao.
  const naTela = tz === GZ;
  let fila = objQ;
  if (!naTela) {
    fila = itemQ.get(tz);
    if (!fila) { fila = []; itemQ.set(tz, fila); }
  }
  const base = profundidade(tx, ty);
  let ultimo = base - 1;
  // UM SO acumulador de elevacao pro tile inteiro, na ordem em que as pecas sao
  // emitidas — inclusive o campo chao. Antes o chao entrava com ex fixo em 0 e
  // nunca alimentava o acumulador; so os itens da pilha empilhavam entre si.
  // Isso desenhava a parede 12px baixa demais no patamar sul do Centro Pokemon
  // (tile -4,-7,6: chao 17970 tem elevacao 12) e cortava o feixe da rampa.
  let e = 0;
  // ACHATA: quem vai pra banda CHAO — `isGround` OU `border`. O `border` precisa
  // estar aqui e o `!TOP` tambem: id que esta nas duas listas conta como top.
  const achata = (id) => (assets[id] && assets[id].isGround === true)
    || (BORDERS.has(id) && !TOP.has(id));
  const naBanda = (id) => {                     // banda CHAO: desenha ja, na varredura
    blit(id, tx, ty, tz, e, agora, true, dest);
    if (depurar) dbgQ.push({ id, tx, ty, tz, ex: e, banda: 'chao' });
  };
  const poe = (id, p) => {                      // banda ITEM: entra na fila do andar
    // a chave cresce sempre: empate dentro do tile e resolvido pela ordem de
    // emissao, nunca pela ordem que o sort escolher
    const k = Math.max(base + p + SALTO_ITEM, ultimo + 0.001);
    ultimo = k;
    fila.push({ k, id, tx, ty, tz, ex: e });
    if (depurar) dbgQ.push({ id, tx, ty, tz, ex: e, banda: naTela ? 'fila' : 'andar' });
  };
  const empilha = (id) => { e = Math.min(24, e + (elev[id] || 0)); };

  // 1. o campo chao — so vai pra banda de baixo se ACHATAR (chao de verdade ou
  // borda). No telhado do Market o `t[3]` traz pecas que NAO sao isGround nem
  // border (61237/61241/61242, peca de telhado): indo pra banda de baixo elas
  // desenhavam antes da pokebola do letreiro e ela saia cortada ao meio.
  // O `border` tem que continuar achatando: 168.540 tiles dos 330 mapas tem
  // campo chao que e' border e nao e' isGround (bordas de gelo e agua, 416 ids).
  if (t[3] && !IGNORE.has(t[3])) {
    const id = t[3];
    if (achata(id)) naBanda(id);
    else poe(id, TOP.has(id) ? P_TOP : (BOTTOM.has(id) ? P_BOTTOM : P_MID));
    empilha(id);
  }

  // 2. BOTTOM. Quem e isGround ou border achata na banda de baixo; o resto
  // ("bottom puro" — rocha, penhasco, tronco caido, muro) DISPUTA profundidade
  // com prioridade 0, em vez de so seguir a ordem de varredura. Mandar tudo pra
  // banda achatada desalinhava esses objetos contra os tiles vizinhos.
  // O `!TOP.has(id)` nao e detalhe: 43 ids estao em TOP e BOTTOM ao mesmo tempo
  // (efeito da uniao `bottom U borders U onbottom`). Sem a guarda o mesmo id sai
  // aqui E na passada 4 — desenhado DUAS vezes. Sao 27 ocorrencias reais, em
  // jumpluff, ledyba, magikarp e vaporeon. O defeito ja existe no motor de hoje.
  //
  // As tres sub-passadas, e a do meio percorre a pilha INVERTIDA (`inv`):
  //   2. bottom que e chao   — ordem da pilha
  //   3. borders             — ordem INVERTIDA
  //   4. bottom puro         — ordem da pilha
  const ehGround = (id) => assets[id] && assets[id].isGround === true;
  const ehBorder = (id) => BORDERS.has(id) && !TOP.has(id) && !ehGround(id);
  const ehBot = (id) => BOTTOM.has(id) && !TOP.has(id);
  const emite = (id) => { if (achata(id)) naBanda(id); else poe(id, P_BOTTOM); empilha(id); };
  for (const id of itens) if (ehBot(id) && ehGround(id)) emite(id);
  for (const id of inv) if (ehBot(id) && ehBorder(id)) emite(id);
  for (const id of itens) if (ehBot(id) && !ehGround(id) && !ehBorder(id)) emite(id);

  // 3. MID, em DUAS passadas: quem bloqueia passagem primeiro, quem nao bloqueia
  // depois — sempre nessa ordem, independente da ordem da pilha. E a regra que
  // deixa o balcao largo cobrir a peca vizinha e a pokebola sair inteira.
  const meio = itens.filter((id) => !BOTTOM.has(id) && !TOP.has(id));
  const bloqueia = (id) => BLOCK.has(id) || (elev[id] || 0) > 0;
  for (const id of meio) if (bloqueia(id)) { poe(id, P_MID); empilha(id); }
  for (const id of meio) if (!bloqueia(id)) { poe(id, P_MID); empilha(id); }

  // 4. TOP por ultimo, sem empilhar (nada desenha depois dele no tile) — e
  // tambem na ordem INVERTIDA, como a passada de `borders`.
  for (const id of inv) if (TOP.has(id)) poe(id, P_TOP);
}

// ── a sonda ───────────────────────────────────────────────────────────────
// Boneco chapado desenhado a mao (nenhum sprite do jogo). So serve pra voce ver
// quem passa na frente e quem passa atras.
function desenharSonda(fx, fy) {
  const x = fx * TILE + TILE / 2;
  const y = fy * TILE + TILE;
  ctx.save();
  // sombra no chao
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 11, 4.5, 0, 0, 7);
  ctx.fill();
  // corpo
  ctx.fillStyle = '#e8c88a';
  ctx.strokeStyle = '#2a1d08';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 8, y - 34, 16, 26, 5);
  ctx.fill();
  ctx.stroke();
  // cabeca
  ctx.beginPath();
  ctx.arc(x, y - 39, 7, 0, 7);
  ctx.fillStyle = '#f3ddb2';
  ctx.fill();
  ctx.stroke();
  // "olhos" indicando a direcao
  const dx = sonda.dir === 'left' ? -3 : sonda.dir === 'right' ? 3 : 0;
  const dy = sonda.dir === 'up' ? -2 : 1;
  ctx.fillStyle = '#2a1d08';
  ctx.beginPath();
  ctx.arc(x + dx - 2, y - 39 + dy, 1.3, 0, 7);
  ctx.arc(x + dx + 2, y - 39 + dy, 1.3, 0, 7);
  ctx.fill();
  ctx.restore();
}

// ── movimento da sonda ────────────────────────────────────────────────────
const MOVE_MS = 240;
function passo(agora) {
  if (sonda.dur > 0) {
    if (agora - sonda.t0 >= sonda.dur) { sonda.dur = 0; sonda.rx = sonda.x; sonda.ry = sonda.y; }
    else return;
  }
  let dx = 0, dy = 0;
  if (teclas.ArrowUp || teclas.w) dy = -1;
  else if (teclas.ArrowDown || teclas.s) dy = 1;
  else if (teclas.ArrowLeft || teclas.a) dx = -1;
  else if (teclas.ArrowRight || teclas.d) dx = 1;
  if (!dx && !dy) return;
  sonda.dir = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
  const nx = sonda.x + dx, ny = sonda.y + dy;
  if (!atravessar && solido(nx, ny)) return;
  sonda.rx = sonda.x;
  sonda.ry = sonda.y;
  sonda.x = nx;
  sonda.y = ny;
  sonda.t0 = agora;
  sonda.dur = teclas.Shift ? MOVE_MS / 2.2 : MOVE_MS;
  seguir = true;
}

// ── laco de desenho ───────────────────────────────────────────────────────
let ultimoFps = 0, quadros = 0, fps = 0;

function desenhar(agora) {
  requestAnimationFrame(desenhar);
  if (!slugAtual) return;
  passo(agora);

  // posicao interpolada da sonda (desliza entre tiles)
  const k = sonda.dur > 0 ? Math.min(1, (agora - sonda.t0) / sonda.dur) : 1;
  const fx = sonda.rx + (sonda.x - sonda.rx) * k;
  const fy = sonda.ry + (sonda.y - sonda.ry) * k;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const larg = Math.round(innerWidth * dpr), alt = Math.round(innerHeight * dpr);
  if (tela.width !== larg || tela.height !== alt) {
    tela.width = larg; tela.height = alt;
    tela.style.width = innerWidth + 'px';
    tela.style.height = innerHeight + 'px';
    chaveCache = '';
  }

  if (seguir) {
    camX = (fx + 0.5) * TILE - tela.width / (2 * escala);
    camY = (fy + 0.5) * TILE - tela.height / (2 * escala);
  }
  // snap da camera a pixel inteiro de tela: mata o tremor do nearest com zoom fracionario
  camX = Math.round(camX * escala) / escala;
  camY = Math.round(camY * escala) / escala;

  const vx0 = Math.floor(camX / TILE) - 2, vx1 = Math.ceil((camX + tela.width / escala) / TILE) + 2;
  const vy0 = Math.floor(camY / TILE) - 2, vy1 = Math.ceil((camY + tela.height / escala) / TILE) + 4;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, tela.width, tela.height);
  ctx.fillStyle = '#080c11';
  ctx.fillRect(0, 0, tela.width, tela.height);

  const esconder = telhadosEscondidos();
  const depurar = $('c-categorias').checked || $('c-candidatos').checked;

  // ── FASE 1: um canvas por andar (escala 1, nitido) — so quando precisa ──
  const ox = vx0 * TILE, oy = vy0 * TILE;
  const cols = (vx1 - vx0 + 1) * TILE, linhas = (vy1 - vy0 + 1) * TILE;
  const chave = [vx0, vy0, vx1, vy1, sonda.x, sonda.y, Math.floor(agora / 250), depurar].join(',');
  if (chave !== chaveCache) {
    for (const cv of [mapCv, topCv]) {
      if (cv.width !== cols) cv.width = cols;
      if (cv.height !== linhas) cv.height = linhas;
    }
    for (const c of [mctx, tctx]) {
      c.setTransform(1, 0, 0, 1, -ox, -oy);
      c.imageSmoothingEnabled = false;
      c.clearRect(ox, oy, cols, linhas);
    }
    objQ = [];
    itemQ = new Map();
    dbgQ = [];
    // span = andares acima do chao. Os telhados desses andares sao desenhados
    // deslocados pra cima-esquerda, entao iteramos tiles EXTRAS a baixo-direita
    // pra eles entrarem na janela.
    const span = Math.max(0, GZ - minZ);

    // UM ANDAR DE CADA VEZ, do mais fundo pro mais alto. Dentro do andar: a banda
    // chao na varredura, depois a banda item ordenada. Terminar o andar antes de
    // comecar o proximo e o que impede a parede do terreo de furar a laje de cima.
    for (let z = maxZ; z >= minZ; z--) {
      const dest = z < GZ ? tctx : mctx;
      let temAlgo = false;
      for (let y = vy0; y <= vy1 + span; y++)
        for (let x = vx0; x <= vx1 + span; x++) {
          const t = pegaTile(x, y, z);
          if (!t) continue;
          if (z < GZ && esconder.has(chave3(x, y, z))) continue; // telhado do predio da sonda
          desenharTile(t, agora, depurar, dest);
          temAlgo = true;
        }
      if (!temAlgo) continue;
      // a banda item DESTE andar. O andar do chao e a excecao: a banda item dele
      // e a objQ, desenhada viva na FASE 3 pra intercalar com a sonda.
      const lista = itemQ.get(z);
      if (!lista) continue;
      lista.sort((a, b) => a.k - b.k);
      for (const it of lista) blit(it.id, it.tx, it.ty, it.tz, it.ex, agora, false, dest);
    }

    chaveCache = chave;
    mapOx = ox;
    mapOy = oy;
  }

  // ── FASE 2: subsolo + andar do chao ──
  // O subsolo nao vaza por cima da rua porque foi pintado ANTES do chao no mesmo
  // canvas, nao porque ficou fora da ordenacao.
  ctx.setTransform(escala, 0, 0, escala, -camX * escala, -camY * escala);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mapCv, mapOx, mapOy);

  // colisao vem logo depois do chao: objetos e sonda desenham por cima
  if ($('c-colisao').checked) desenharColisao(vx0, vy0, vx1, vy1);

  // ── FASE 3: a banda ITEM do andar do chao + a sonda ──
  ctx.imageSmoothingEnabled = false;
  const fila = [];
  for (const it of objQ) fila.push({ k: it.k, fn: () => blitTela(it.id, it.tx, it.ty, it.tz, it.ex, agora) });
  if ($('c-sonda').checked) {
    // a sonda anda em fracao de tile; a profundidade dela usa o tile inteiro em
    // que ela esta pisando, senao ela pisca de banda no meio do passo
    const k = SALTO_ITEM + profundidade(Math.round(fx), Math.floor(fy + 1.5 - 0.64)) + P_SONDA;
    fila.push({ k, fn: () => desenharSonda(fx, fy) });
  }
  fila.sort((a, b) => a.k - b.k).forEach((r) => r.fn());

  // ── FASE 3.5: os andares ACIMA do chao, por cima da fila ──
  // E aqui que o predio ganha a disputa contra o personagem: quem passa atras de
  // uma parede some, e o telhado cobre o interior visto de fora. Os telhados do
  // predio onde a sonda esta ja ficaram de fora, porque o laco da FASE 1 pula
  // esses tiles (telhadosEscondidos).
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(topCv, mapOx, mapOy);
  ctx.imageSmoothingEnabled = false;

  // ── overlays de depuracao ──
  if (depurar) desenharOverlayItens();
  if ($('c-grade').checked) desenharGrade(vx0, vy0, vx1, vy1);
  if ($('c-spawns').checked) desenharSpawns();
  if (tileSelecionado) desenharSelecao();

  quadros++;
  if (agora - ultimoFps > 500) { fps = Math.round((quadros * 1000) / (agora - ultimoFps)); quadros = 0; ultimoFps = agora; }
  $('hud').textContent =
    `${slugAtual}  ·  sonda ${sonda.x},${sonda.y}  ·  z ${GZ}  ·  zoom ${escala.toFixed(2)}×  ·  ${fps} fps` +
    (atravessar ? '  ·  atravessando paredes' : '');
}

// ── overlays ──────────────────────────────────────────────────────────────
function desenharColisao(vx0, vy0, vx1, vy1) {
  ctx.save();
  for (let y = vy0; y <= vy1; y++)
    for (let x = vx0; x <= vx1; x++) {
      if (!solido(x, y)) continue;
      const semChao = !pegaTile(x, y, GZ);
      ctx.fillStyle = semChao ? 'rgba(20,20,30,.55)' : 'rgba(255,60,60,.28)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  ctx.restore();
}

function desenharOverlayItens() {
  const porCategoria = $('c-categorias').checked;
  const soCandidatos = $('c-candidatos').checked;
  ctx.save();
  ctx.lineWidth = 1;
  for (const it of dbgQ) {
    const a = assets[it.id];
    if (!a) continue;
    const cand = ehCandidato(it.id);
    if (soCandidatos && !cand) continue;
    const r = retangulo(it.id, it.tx, it.ty, it.tz, it.ex);
    if (soCandidatos) {
      const crit = ehCritico(it.id);
      ctx.strokeStyle = crit ? '#ff3b3b' : '#ff9f43';
      ctx.fillStyle = crit ? 'rgba(255,59,59,.22)' : 'rgba(255,159,67,.12)';
      ctx.lineWidth = crit ? 2 : 1;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    } else if (porCategoria) {
      const cor = propostas.has(it.id) && $('c-propostas').checked ? '#ffffff' : CORES[classeDe(it.id)];
      ctx.strokeStyle = cor;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = cor;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function desenharGrade(vx0, vy0, vx1, vy1) {
  ctx.save();
  ctx.strokeStyle = 'rgba(120,160,200,.18)';
  ctx.lineWidth = 1 / escala;
  ctx.beginPath();
  for (let x = vx0; x <= vx1; x++) { ctx.moveTo(x * TILE, vy0 * TILE); ctx.lineTo(x * TILE, vy1 * TILE); }
  for (let y = vy0; y <= vy1; y++) { ctx.moveTo(vx0 * TILE, y * TILE); ctx.lineTo(vx1 * TILE, y * TILE); }
  ctx.stroke();
  if (escala >= 1.2) {
    ctx.fillStyle = 'rgba(160,190,220,.55)';
    ctx.font = '7px monospace';
    for (let y = vy0; y <= vy1; y++)
      for (let x = vx0; x <= vx1; x++)
        if (x % 5 === 0 && y % 5 === 0) ctx.fillText(x + ',' + y, x * TILE + 2, y * TILE + 8);
  }
  ctx.restore();
}

function desenharSpawns() {
  ctx.save();
  for (const s of spawns) {
    const cx = s.x * TILE + TILE / 2, cy = s.y * TILE + TILE / 2;
    const preso = solido(s.x, s.y); // spawn em tile bloqueado = bicho nunca nasce ali
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, 7);
    ctx.fillStyle = preso ? 'rgba(255,70,70,.35)' : 'rgba(90,200,255,.30)';
    ctx.fill();
    ctx.lineWidth = preso ? 2.2 : 1.6;
    ctx.strokeStyle = preso ? '#ff4646' : '#5ac8ff';
    ctx.stroke();
    if (escala >= 1.3) {
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#dff3ff';
      ctx.textAlign = 'center';
      ctx.fillText('#' + s.pokeId, cx, cy + 3);
      ctx.textAlign = 'left';
    }
  }
  if (inicio) {
    const cx = inicio.x * TILE + TILE / 2, cy = inicio.y * TILE + TILE / 2;
    ctx.strokeStyle = '#7ec8a0';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 12, cy - 12, 24, 24);
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#7ec8a0';
    ctx.fillText('start', cx - 11, cy - 15);
  }
  ctx.restore();
}

function desenharSelecao() {
  ctx.save();
  ctx.strokeStyle = '#e8c88a';
  ctx.lineWidth = 2 / escala;
  ctx.strokeRect(tileSelecionado.x * TILE, tileSelecionado.y * TILE, TILE, TILE);
  ctx.restore();
}

// ── inspetor de tile ──────────────────────────────────────────────────────
function inspecionar(tx, ty) {
  tileSelecionado = { x: tx, y: ty };
  const alvo = $('inspetor');
  const partes = [];
  const zs = [];
  for (let z = maxZ; z >= minZ; z--) if (pegaTile(tx, ty, z)) zs.push(z);
  if (!zs.length) {
    alvo.innerHTML = `<div class="dica">${tx}, ${ty} — sem tile (fora do mapa).</div>`;
    return;
  }
  partes.push(`<div class="dica">tile <b>${tx}, ${ty}</b> · andares: ${zs.join(', ')} · ${solido(tx, ty) ? 'BLOQUEADO' : 'andável'}</div>`);
  for (const z of zs) {
    const t = pegaTile(tx, ty, z);
    partes.push(`<div class="dica" style="margin:6px 0 3px">z = ${z}${z === GZ ? ' (chão)' : z < GZ ? ' (andar acima)' : ' (subsolo)'}</div>`);
    if (t[3]) partes.push(linhaItem(t[3], true));
    for (const it of t[4] || []) partes.push(linhaItem(it[0], false));
  }
  alvo.innerHTML = partes.join('');
  for (const b of alvo.querySelectorAll('button[data-id]')) {
    b.onclick = () => {
      const id = Number(b.dataset.id);
      const para = b.dataset.para;
      if (propostas.get(id) === para) propostas.delete(id);
      else propostas.set(id, para);
      salvarPropostas();
      recalcularConjuntos();
      renderPropostas();
      inspecionar(tx, ty);
    };
  }
}

function linhaItem(id, ehChao) {
  const a = assets[id];
  if (!a) return `<div class="linha"><span class="id">${id}</span><span class="dim">sem asset no manifest</span></div>`;
  const cls = classeDe(id);
  const prop = propostas.get(id);
  const cand = ehCandidato(id);
  const crit = ehCritico(id);
  const ign = IGNORE.has(id);
  return (
    `<div class="linha${ehChao ? ' chao' : ''}">` +
    `<span class="id">${id}</span>` +
    `<span class="tag" style="background:${CORES[cls]}22;color:${CORES[cls]}">${cls}</span>` +
    `<span class="dim">${a.width}×${a.height}${a.isGround ? ' chão' : ''}${BLOCK.has(id) ? ' 🚧' : ''}${(elev[id] || 0) ? ' elev' + elev[id] : ''}${a.frameCount > 1 ? ' ▶' + a.frameCount : ''}${ign ? ' ignorado' : ''}</span>` +
    (ehChao
      ? ''
      : `<span class="acoes">` +
        `<button data-id="${id}" data-para="top" class="${prop === 'top' ? 'ativo' : ''}" title="passar a desenhar na frente de quem está atrás">top</button>` +
        `<button data-id="${id}" data-para="mid" class="${prop === 'mid' ? 'ativo' : ''}" title="objeto comum (entra na fila y-ordenada)">mid</button>` +
        `<button data-id="${id}" data-para="bottom" class="${prop === 'bottom' ? 'ativo' : ''}" title="deitado no chão, sempre atrás">bottom</button>` +
        `</span>`) +
    `</div>` +
    (crit ? `<div class="alerta">↑ candidato crítico: ${a.height}px de altura mas está em <code>${cls}</code> → nunca cobre a sonda</div>` : cand && !ehChao ? `<div class="alerta" style="color:#ffcf8b">↑ candidato: altura ${a.height}px fora de <code>top</code></div>` : '')
  );
}

// ── propostas ─────────────────────────────────────────────────────────────
const CHAVE_LS = 'pokewg-mapas:propostas';

function carregarPropostas() {
  try {
    propostas = new Map(JSON.parse(localStorage.getItem(CHAVE_LS) || '[]'));
  } catch { propostas = new Map(); }
}
function salvarPropostas() {
  localStorage.setItem(CHAVE_LS, JSON.stringify([...propostas]));
}
function renderPropostas() {
  $('n-propostas').textContent = propostas.size;
  const lista = [...propostas].sort((a, b) => a[0] - b[0]);
  $('lista-propostas').innerHTML = lista.length
    ? lista
        .map(
          ([id, para]) =>
            `<div><b>${id}</b><span class="dim">${classeDe(id)} →</span><span class="para">${para}</span><button data-rm="${id}" title="remover">✕</button></div>`
        )
        .join('')
    : '<div class="dica">Nenhuma ainda. Clique num tile e use os botões top / mid / bottom.</div>';
  for (const b of $('lista-propostas').querySelectorAll('button[data-rm]')) {
    b.onclick = () => {
      propostas.delete(Number(b.dataset.rm));
      salvarPropostas();
      recalcularConjuntos();
      renderPropostas();
    };
  }
}

// gera o draworder.json completo com as propostas aplicadas
function draworderCorrigido() {
  const novo = JSON.parse(JSON.stringify(draworder));
  const listas = ['top', 'toppers', 'bottom', 'borders', 'onbottom'];
  for (const [id, para] of propostas) {
    for (const l of listas) novo[l] = (novo[l] || []).filter((v) => v !== id);
    if (para === 'top') novo.top.push(id);
    else if (para === 'bottom') novo.bottom.push(id);
    // 'mid' = fora de todas as listas
  }
  for (const l of listas) if (novo[l]) novo[l] = [...new Set(novo[l])].sort((a, b) => a - b);
  return novo;
}

function baixar(nome, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// promocao em lote: todos os candidatos VISIVEIS no mapa atual que sejam 64x64 E
// bloqueiem passagem (o filtro composto que o proprio laudo recomenda pra evitar
// o falso-positivo do "sprite alto porem achatado").
function promoverEmLote() {
  const vistos = new Set();
  for (const t of tileAt.values()) for (const it of t[4] || []) vistos.add(it[0]);
  let n = 0;
  for (const id of vistos) {
    const a = assets[id];
    if (!a || !ehCandidato(id)) continue;
    if (a.width !== 64 || a.height !== 64 || !BLOCK.has(id)) continue;
    propostas.set(id, 'top');
    n++;
  }
  salvarPropostas();
  recalcularConjuntos();
  renderPropostas();
  alert(`${n} id(s) promovido(s) para top neste mapa (64×64 + bloqueiam passagem).\n\nOlhe na tela antes de exportar.`);
}

// ── UI ────────────────────────────────────────────────────────────────────
function montarLegenda() {
  $('legenda').innerHTML =
    Object.entries(CORES)
      .map(([k, v]) => `<i style="background:${v}"></i>${k}`)
      .join('<br>') +
    `<br><i style="background:#ff3b3b"></i>candidato crítico (está em bottom)` +
    `<br><i style="background:#ff9f43"></i>candidato` +
    `<br><i style="background:#ffffff"></i>com proposta sua`;
}

function montarListaMapas() {
  const sel = $('sel-mapa');
  const porArea = new Map();
  for (const m of indiceMapas) {
    const n = nomes.get(m.slug);
    const area = n?.area || (m.slug.startsWith('gym_') ? 'ginásios' : 'outros');
    if (!porArea.has(area)) porArea.set(area, []);
    porArea.get(area).push(m);
  }
  sel.innerHTML = [...porArea]
    .sort()
    .map(
      ([area, ms]) =>
        `<optgroup label="${area} (${ms.length})">` +
        ms
          .map((m) => {
            const n = nomes.get(m.slug);
            return `<option value="${m.slug}">${n ? n.nome : m.slug}${n && n.nome.toLowerCase() !== m.slug ? ' — ' + m.slug : ''}</option>`;
          })
          .join('') +
        `</optgroup>`
    )
    .join('');
}

function ligarEventos() {
  $('sel-mapa').onchange = async (e) => {
    try {
      await carregarMapa(e.target.value);
      localStorage.setItem('pokewg-mapas:ultimo', e.target.value);
    } catch { /* mensagem ja mostrada */ }
  };

  for (const id of ['c-sonda', 'c-telhado', 'c-spawns', 'c-grade', 'c-colisao', 'c-categorias', 'c-candidatos']) {
    $(id).onchange = () => { esconderCache = { x: NaN, y: NaN, set: new Set() }; chaveCache = ''; };
  }
  $('c-propostas').onchange = () => recalcularConjuntos();

  // pula a sonda de um ponto de spawn pro proximo (pra revisar posicionamento)
  let iSpawn = 0;
  $('btn-spawn').onclick = () => {
    if (!spawns.length) return alert('Este mapa não tem pontos de spawn.');
    const s = spawns[iSpawn % spawns.length];
    iSpawn++;
    sonda = { x: s.x, y: s.y, rx: s.x, ry: s.y, t0: 0, dur: 0, dir: 'down' };
    seguir = true;
    chaveCache = '';
    tileSelecionado = { x: s.x, y: s.y };
    inspecionar(s.x, s.y);
  };

  $('btn-lote').onclick = promoverEmLote;
  $('btn-exportar').onclick = () => {
    if (!propostas.size) return alert('Nenhuma proposta pra exportar.');
    baixar('draworder.json', JSON.stringify(draworderCorrigido()));
  };
  $('btn-patch').onclick = () => {
    if (!propostas.size) return alert('Nenhuma proposta pra exportar.');
    baixar(
      'propostas.json',
      JSON.stringify(
        {
          gerado: new Date().toISOString(),
          mapaDeReferencia: slugAtual,
          mudancas: [...propostas].sort((a, b) => a[0] - b[0]).map(([id, para]) => ({
            id,
            de: classeDe(id),
            para,
            tamanho: assets[id] ? assets[id].width + 'x' + assets[id].height : null,
            bloqueia: BLOCK.has(id),
          })),
        },
        null,
        1
      )
    );
  };
  $('btn-limpar').onclick = () => {
    if (propostas.size && !confirm(`Apagar as ${propostas.size} propostas?`)) return;
    propostas.clear();
    salvarPropostas();
    recalcularConjuntos();
    renderPropostas();
  };
  $('btn-recolher').onclick = () => $('painel').classList.toggle('recolhido');

  // teclado
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    teclas[e.key] = true;
    teclas[e.key.toLowerCase()] = true;
    if (e.key === 'c' || e.key === 'C') seguir = true;
    if (e.key === 'n' || e.key === 'N') atravessar = !atravessar;
    if (e.key === 'p' || e.key === 'P') $('painel').classList.toggle('recolhido');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { teclas[e.key] = false; teclas[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { for (const k in teclas) teclas[k] = false; });

  // arrastar = mover camera livre; clique curto = inspecionar
  let arrastando = false, movido = 0, ax = 0, ay = 0;
  tela.addEventListener('pointerdown', (e) => {
    arrastando = true;
    movido = 0;
    ax = e.clientX;
    ay = e.clientY;
    tela.classList.add('arrastando');
    tela.setPointerCapture(e.pointerId);
  });
  tela.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const dx = (e.clientX - ax) * dpr, dy = (e.clientY - ay) * dpr;
    movido += Math.abs(dx) + Math.abs(dy);
    if (movido > 4) {
      seguir = false;
      camX -= dx / escala;
      camY -= dy / escala;
      ax = e.clientX;
      ay = e.clientY;
    }
  });
  tela.addEventListener('pointerup', (e) => {
    tela.classList.remove('arrastando');
    if (arrastando && movido <= 4) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const wx = (e.clientX * dpr) / escala + camX;
      const wy = (e.clientY * dpr) / escala + camY;
      inspecionar(Math.floor(wx / TILE), Math.floor(wy / TILE));
    }
    arrastando = false;
  });
  tela.addEventListener('wheel', (e) => {
    e.preventDefault();
    escala = Math.max(0.4, Math.min(4, escala - e.deltaY * 0.0016));
    chaveCache = '';
  }, { passive: false });
}

// ── inicio ────────────────────────────────────────────────────────────────
(async function principal() {
  try {
    carregarPropostas();
    await carregarSuporte();
    montarLegenda();
    montarListaMapas();
    ligarEventos();
    renderPropostas();

    // escolhe o mapa: o ultimo usado, senao cerulean (o do laudo), senao o 1o baixado
    const salvo = localStorage.getItem('pokewg-mapas:ultimo');
    const tentativas = [salvo, 'cerulean', indiceMapas[0]?.slug].filter(Boolean);
    for (const slug of tentativas) {
      try {
        $('sel-mapa').value = slug;
        await carregarMapa(slug);
        break;
      } catch { /* tenta o proximo */ }
    }
    requestAnimationFrame(desenhar);
  } catch (e) {
    console.error(e);
    carregando(
      `Falhou ao carregar os dados.<br><br><code>${e.message}</code><br><br>` +
        `Se for 404, provavelmente falta baixar:<br><code>npm run fetch-assets</code>`,
      true
    );
  }
})();
