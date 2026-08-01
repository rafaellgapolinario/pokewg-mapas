// ═══════════════════════════════════════════════════════════════════════════
// ORDEM DE DESENHO DO CENÁRIO — módulo puro
//
// Aqui está TODA a regra que decide quem cobre quem. Não há canvas, DOM, Pixi,
// React nem fetch neste arquivo: entra tile e tabela, sai lista ordenada. Ele
// existe para que o cliente do jogo (`app/play/MapView.tsx`) e o visualizador
// usem exatamente a MESMA regra, em vez de duas cópias que divergem com o tempo.
//
// COMO USAR NO MapView.tsx — são duas chamadas, e nada mais:
//
//   import { emitirTile, posicaoSprite, profundidade, SALTO_ITEM, P_SONDA }
//     from './ordem-de-desenho';
//
//   const tabela = { assets, TOP, BOTTOM, BORDERS, BLOCK, elev, disp };
//
//   // 1) no laço por tile, no lugar da emissão atual:
//   emitirTile(t, tabela, (id, chao, p, ex, k) => {
//     const { x, y } = posicaoSprite(id, t[0], t[1], t[2], ex, tabela, GZ);
//     if (chao) desenheAgora(id, x, y);       // banda CHÃO, ordem de varredura
//     else fila.push({ k, id, x, y });        // banda ITEM, ordenar por k
//   });
//
//   // 2) os andares, do mais fundo pro mais alto; dentro de cada andar,
//   //    a banda CHÃO inteira e depois a banda ITEM ordenada por `k`:
//   for (let z = maxZ; z >= minZ; z--) { ...chão do andar...; ...fila.sort(k)... }
//
//   // o personagem/criatura entra na fila do andar do chão com:
//   //   k = SALTO_ITEM + profundidade(round(px), floor(py + 1.5 - 0.64)) + P_SONDA
//
// CADA REGRA AQUI FOI MEDIDA, E VÁRIAS FORAM REJEITADAS UMA VEZ POR DEDUÇÃO QUE
// PARECIA RAZOÁVEL E ESTAVA ERRADA. Se algo parecer supérfluo, o comentário ao
// lado diz o que quebra sem aquilo. Não simplifique sem medir.
// ═══════════════════════════════════════════════════════════════════════════

export const TILE = 32;

// Ids que o cliente NÃO desenha (marcadores internos do editor, tapa-buraco de
// borda). Idêntico ao conjunto do renderizador de referência.
export const IGNORE = new Set([7124, 1510, 8274, 46638, 46639, 46620, 46621, 1511, 1024]);

// Prioridade dentro da banda ITEM.
export const P_BOTTOM = 0;
export const P_MID = 0.3;
export const P_SONDA = 0.4;   // personagem, NPC, criatura
export const P_TOP = 0.6;

// Põe a banda ITEM inteira acima da banda CHÃO do MESMO andar, sem disputa por y.
export const SALTO_ITEM = 8e6;

// Teto do acumulador de elevação dentro do tile.
export const ELEV_MAX = 24;

/**
 * A profundidade usa as DUAS coordenadas. O andar de cima é desenhado deslocado
 * em x E y (`fo = (z-GZ)*32` nas duas), então a profundidade tem que andar na
 * mesma diagonal. É load-bearing: medido, voltar para `ty` puro faz a árvore
 * parar de ocluir (483 px → 944 px). O `4*tx` é o desempate lateral; 4096 é
 * folga para ele nunca alcançar a linha seguinte.
 */
export function profundidade(tx, ty) {
  return (tx + ty) * 4096 + 4 * tx;
}

/**
 * Onde o sprite é desenhado.
 *
 * `ex` é a elevação ACUMULADA das peças emitidas ANTES desta no mesmo tile. A
 * elevação da PRÓPRIA peça não levanta ela — só vale para as peças seguintes, e
 * por isso é somada ao acumulador depois (ver `emitirTile`). Somar
 * `elev[id] + ex` aqui, como era antes, deixava a mesa de 4 tiles do saguão do
 * Centro Pokémon com degrau: a coluna esquerda (elev 6) subia 6 px e a direita
 * (elev 0) não, embora cada peça esteja sozinha no seu tile.
 */
export function posicaoSprite(id, tx, ty, tz, ex, tabela, GZ) {
  const a = tabela.assets[id];
  const d = (tabela.disp && tabela.disp[id]) || [0, 0];
  const fo = (tz - GZ) * TILE;
  return {
    x: tx * TILE - (a.width - TILE) - d[0] + fo,
    y: ty * TILE - (a.height - TILE) - d[1] - ex + fo,
  };
}

/**
 * A ordem de emissão de um tile.
 *
 * @param t       o tile no formato stonegy: [tx, ty, tz, chao, pilha]
 * @param tabela  { assets, TOP, BOTTOM, BORDERS, elev }
 *                TOP     = draworder.top ∪ draworder.toppers
 *                BOTTOM  = draworder.bottom ∪ draworder.borders ∪ draworder.onbottom
 *                BORDERS = draworder.borders
 * @param emitir  callback chamado uma vez por peça, NA ORDEM DE EMISSÃO:
 *                  emitir(id, chao, p, ex, k)
 *                `chao === true`  → desenhe já, na ordem de varredura (banda CHÃO); `k` é null
 *                `chao === false` → ponha na fila do andar e ordene por `k` (banda ITEM)
 *
 * É CALLBACK, E NÃO LISTA, DE PROPÓSITO. A primeira versão deste módulo
 * devolvia um array de objetos — um objeto por peça, por tile, por frame. Medido
 * (ferramentas/custo-modulo.mjs) numa janela de 44x28 tiles: **+29% no custo da
 * emissão**, 3,64 ms → 4,69 ms por frame, só de alocação. Num cliente de jogo
 * isso é pressão de GC todo frame. Com callback não se aloca nada.
 * Se precisar da lista (teste, depuração), use `emissoesDoTile()` abaixo.
 */
export function emitirTile(t, tabela, emitir) {
  const { assets, TOP, BOTTOM, BORDERS, elev } = tabela;
  const tx = t[0], ty = t[1];
  const chao = t[3];
  const itens = (t[4] || []).map((i) => i[0]).filter((id) => id && !IGNORE.has(id));

  // A pilha INVERTIDA, usada só nas passadas de `borders` e de `top`. É a regra
  // do renderizador de referência (`g = e[4].length>1 ? [...e[4]].reverse() : e[4]`)
  // e responde por 99,8% da diferença que sobrava contra ele.
  //
  // EFEITO VISUAL: isto quadricula manchas de terra que hoje são orgânicas —
  // blocos de borda dura, com os tiles contáveis. NÃO é defeito: o renderizador
  // de referência foi fotografado ao vivo e os blocos estão lá iguais. Mas se
  // preferirem o visual atual, esta é a única regra a remover — troque `inv` por
  // `itens` nas duas passadas marcadas e nada mais muda.
  const inv = itens.length > 1 ? [...itens].reverse() : itens;

  const base = profundidade(tx, ty);
  let ultimo = base - 1;
  let ex = 0;                       // UM acumulador de elevação para o tile inteiro

  const ehGround = (id) => assets[id] && assets[id].isGround === true;
  // ACHATA: quem vai para a banda CHÃO. `isGround` OU `border` que não seja top.
  // O `border` PRECISA estar aqui: 167.122 tiles dos 330 mapas publicados têm
  // campo chão que é border e não é isGround (bordas de gelo e água, 412 ids).
  const achata = (id) => ehGround(id) || (BORDERS.has(id) && !TOP.has(id));
  const ehBorder = (id) => BORDERS.has(id) && !TOP.has(id) && !ehGround(id);
  // `!TOP.has(id)` não é detalhe: 43 ids estão em TOP e BOTTOM ao mesmo tempo
  // (efeito da união `bottom ∪ borders ∪ onbottom`). Sem a guarda o mesmo id sai
  // na passada de bottom E na de top — desenhado DUAS vezes. Acontece de verdade
  // em jumpluff, ledyba, magikarp e vaporeon.
  const ehBot = (id) => BOTTOM.has(id) && !TOP.has(id);
  const bloqueia = (id) =>
    (tabela.BLOCK && tabela.BLOCK.has(id)) || (elev[id] || 0) > 0;

  // `podeAchatar` só vale para o campo chão e para as passadas de BOTTOM. As
  // passadas `mid` e `top` vão SEMPRE para a banda ITEM, mesmo que a peça seja
  // `isGround` ou `border`. Isto não é firula: testar `achata` também no `mid`
  // muda 23.700 tiles dos 330 mapas (pegado por ferramentas/prova-modulo.mjs,
  // que compara esta emissão com a do código anterior peça a peça). Se algum dia
  // alguém quiser mudar isto, é mudança de motor — mede antes.
  function emite(id, p, { podeAchatar = true, acumula = true } = {}) {
    if (podeAchatar && achata(id)) {
      emitir(id, true, p, ex, null);
    } else {
      // A chave cresce SEMPRE: empate dentro do tile é resolvido pela ordem de
      // emissão, nunca pela ordem que o sort escolher.
      const k = Math.max(base + p + SALTO_ITEM, ultimo + 0.001);
      ultimo = k;
      emitir(id, false, p, ex, k);
    }
    // acumula DEPOIS de posicionar — a peça não se levanta por si mesma
    if (acumula) ex = Math.min(ELEV_MAX, ex + (elev[id] || 0));
  }

  // 1. o campo chão. Só vai para a banda de baixo se ACHATAR. No telhado do
  //    Mercado o `t[3]` traz peças de telhado que não são isGround nem border —
  //    indo para a banda de baixo elas desenhavam antes da pokébola do letreiro
  //    e ela saía cortada ao meio.
  if (chao && !IGNORE.has(chao)) {
    emite(chao, TOP.has(chao) ? P_TOP : (BOTTOM.has(chao) ? P_BOTTOM : P_MID));
  }

  // 2. BOTTOM que é chão de verdade        — ordem da pilha
  for (const id of itens) if (ehBot(id) && ehGround(id)) emite(id, P_BOTTOM);

  // 3. BOTTOM que é borda                  — ordem INVERTIDA
  for (const id of inv) if (ehBot(id) && ehBorder(id)) emite(id, P_BOTTOM);

  // 4. "bottom puro" (rocha, penhasco, tronco caído, muro) — ordem da pilha.
  //    Disputa profundidade com prioridade 0 em vez de seguir a ordem de
  //    varredura crua; mandar tudo para a banda achatada desalinhava esses
  //    objetos contra os tiles vizinhos.
  for (const id of itens) if (ehBot(id) && !ehGround(id) && !ehBorder(id)) emite(id, P_BOTTOM);

  // 5. e 6. MID em DUAS passadas: quem bloqueia passagem antes de quem não
  //    bloqueia, SEMPRE nessa ordem, independente da ordem da pilha. É a regra
  //    que deixa o balcão largo cobrir a peça vizinha e a pokébola sair inteira.
  const meio = itens.filter((id) => !BOTTOM.has(id) && !TOP.has(id));
  for (const id of meio) if (bloqueia(id)) emite(id, P_MID, { podeAchatar: false });
  for (const id of meio) if (!bloqueia(id)) emite(id, P_MID, { podeAchatar: false });

  // 7. TOP por último                      — ordem INVERTIDA, SEM acumular.
  //    Nada desenha depois do top dentro do tile, então acumular não teria
  //    efeito — exceto entre dois tops no MESMO tile. Aqui eles ficam no mesmo
  //    nível, que é o comportamento que passou nos 11 testes e na auditoria dos
  //    330 mapas. DIVERGÊNCIA CONHECIDA: o renderizador de referência acumula
  //    também no top. Nunca foi isolado quanto isso vale (faria diferença só em
  //    tile com 2+ peças `top` com elevação); está na conta dos 0,243% que ainda
  //    sobram. Não mude isto sem medir — mudar por parecer mais correto é
  //    exatamente o erro que este projeto já cometeu quatro vezes.
  for (const id of inv) if (TOP.has(id)) emite(id, P_TOP, { podeAchatar: false, acumula: false });
}

/**
 * A mesma emissão, devolvida como lista. Para teste e depuração — NÃO use no
 * laço de desenho: aloca um objeto por peça a cada frame (ver `emitirTile`).
 */
export function emissoesDoTile(t, tabela) {
  const saida = [];
  emitirTile(t, tabela, (id, chao, p, ex, k) => saida.push({ id, chao, p, ex, k }));
  return saida;
}
