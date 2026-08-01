# Guia de porte — levar a correção de oclusão para o `app/play/MapView.tsx`

Este arquivo descreve as **quatro alterações** de forma independente do arquivo,
para aplicar no cliente do jogo. Ele serve para uma pessoa ler ou para um agente
(Claude Code) executar.

O patch em `oclusao-pwg.patch` é contra `visualizador/visualizador.js` — o
espelho publicado do `MapView.tsx`. **Não tente aplicar esse patch direto no
`MapView.tsx`**: os nomes e o contexto diferem. Use-o como referência de leitura
e siga as quatro alterações abaixo.

---

## Prompt pronto, se for usar Claude Code

> Leia `PARA-O-CORONELLX-motor.md` e `INSTRUCOES-DE-PORTE.md` inteiros antes de
> tocar em qualquer arquivo. O alvo é `app/play/MapView.tsx`. Aplique as quatro
> alterações descritas, uma por commit, na ordem dada. Depois de cada uma, rode o
> que existir de teste no projeto e abra o jogo para conferir na tela — não
> considere uma alteração concluída sem ter visto o resultado renderizado.
> Se a estrutura do `MapView.tsx` divergir do que o guia descreve, **pare e
> relate a divergência** em vez de adaptar por conta própria: cada uma dessas
> quatro regras foi rejeitada pelo menos uma vez por dedução que parecia
> razoável e estava errada.

---

## Vocabulário

| termo | o que é |
|---|---|
| `t[3]` | o **campo chão** do tile — uma peça só, fora da pilha |
| `t[4]` | a **pilha** do tile — lista de peças |
| `TOP` | `draworder.top ∪ draworder.toppers` |
| `BOTTOM` | `draworder.bottom ∪ draworder.borders ∪ draworder.onbottom` |
| `BORDERS` | só `draworder.borders` |
| `isGround` | `manifest.assets[id].isGround === true` |
| `bloqueia(id)` | `collision.blocking.has(id) || (offsets.elev[id] ?? 0) > 0` |
| `ex` | elevação **acumulada** das peças já emitidas no mesmo tile |

---

## Alteração 1 — fechar um andar antes de começar o próximo

**Sintoma que resolve:** o interior dos prédios vaza por cima da laje; o
personagem aparece por cima do prédio; escada e telhado picotados.

Hoje tudo cai num offscreen achatado mais **uma** fila global ordenada só por
`y`. Passa a ser: percorrer os andares do mais fundo (`maxZ`) para o mais alto
(`minZ`) e **fechar cada andar inteiro** antes do próximo. Dentro de cada andar,
duas bandas:

| banda | conteúdo | ordem |
|---|---|---|
| **CHÃO** | campo chão e `BOTTOM` que "achatam" (ver alt. 2) | ordem de varredura |
| **ITEM** | o resto | por chave, crescente |

```
chave = profundidade(tx, ty) + prioridade + 8e6
profundidade(tx, ty) = (tx + ty) * 4096 + 4 * tx
prioridade:  bottom 0  ·  mid 0.3  ·  personagem 0.4  ·  top 0.6
```

Duas coisas que **não** são detalhe:

- **a profundidade usa as duas coordenadas.** O andar de cima é desenhado
  deslocado em x **e** y, então a profundidade tem que andar na mesma diagonal.
  Medido: voltar para `ty` puro faz a árvore parar de ocluir (483 px → 944 px).
- **a chave cresce sempre dentro do tile:** `k = max(base + p + 8e6, ultimo +
  0.001)`. Assim empate é resolvido pela ordem de emissão, não pelo que o sort
  escolher.

**Custo:** continuam sendo **dois** offscreens. Colar N canvas em ordem dá o
mesmo pixel que pintar os N na mesma ordem dentro de um. Uma janela chega a tocar
15 andares nos 330 mapas — um canvas por andar seria caro à toa.

---

## Alteração 2 — as sete passadas de emissão dentro do tile

**Sintoma que resolve:** pokébola do letreiro do Mercado cortada ao meio; parede
12 px baixa demais no patamar sul do Centro Pokémon; rocha, penhasco e muro fora
de ordem contra os vizinhos.

Emitir as peças do tile **nesta ordem**, sempre:

```
1. o campo chão            t[3]
2. BOTTOM que é isGround   ordem da pilha
3. BOTTOM que é border     ordem INVERTIDA   ← ver alteração 4
4. BOTTOM "puro"           ordem da pilha
5. MID que bloqueia        ordem da pilha
6. MID que não bloqueia    ordem da pilha
7. TOP                     ordem INVERTIDA   ← ver alteração 4
```

**Quem vai para a banda CHÃO ("achata"):**

```
achata(id) = isGround(id) || (BORDERS.has(id) && !TOP.has(id))
```

Tudo o mais vai para a banda ITEM e disputa profundidade.

Quatro pontos que custaram caro e valem estar explícitos:

- **o campo chão nem sempre achata.** No telhado do Mercado o `t[3]` traz peças
  de telhado que não são `isGround` — indo para a banda de baixo elas desenhavam
  antes da pokébola do letreiro e ela saía cortada.
- **`border` precisa achatar.** 167.122 tiles dos 330 mapas têm campo chão que é
  `border` e não é `isGround` (bordas de gelo e água, 412 ids). Testar só
  `isGround` desalinha todas elas.
- **"bottom puro"** (nem `isGround` nem `border` — rocha, penhasco, tronco,
  muro) **disputa profundidade** com prioridade 0, em vez de seguir a ordem de
  varredura crua.
- **id que está em `TOP` e `BOTTOM` ao mesmo tempo conta como top, nunca como
  bottom.** São 43 ids; sem essa guarda o mesmo id sai na passada de bottom **e**
  na de top — desenhado duas vezes. Acontece de verdade em 4 mapas (`jumpluff`,
  `ledyba`, `magikarp`, `vaporeon`).

**Um só acumulador de elevação por tile**, alimentado por todas as peças na ordem
em que são emitidas — **inclusive o campo chão**. Antes o chão entrava com `ex`
fixo em 0 e nunca acumulava.

---

## Alteração 3 — a peça não se levanta pela própria elevação

**Sintoma que resolve:** mesa de 4 tiles do saguão do Centro Pokémon com degrau
(coluna esquerda 6 px acima da direita).

```diff
- y = ty*32 - (h-32) - disp[1] - ((elev[id] || 0) + ex)
+ y = ty*32 - (h-32) - disp[1] - ex
```

`ex` é a elevação **acumulada das peças desenhadas antes desta no mesmo tile**. A
elevação da própria peça **não** levanta ela — só vale para as peças seguintes,
e por isso é somada ao acumulador **depois** de a peça ser posicionada.

Alcance: todas as peças com elevação (4.697 ids). **Defeito pré-existente.**

---

## Alteração 4 — a pilha invertida em `borders` e `top`

**Sintoma que resolve:** 99,8% de toda a diferença que ainda sobrava contra o
renderizador de referência.

Nas passadas **3** (`borders`) e **7** (`top`), percorrer a pilha do tile
**invertida**:

```js
const inv = itens.length > 1 ? [...itens].reverse() : itens;
```

As outras cinco passadas usam a ordem autorada.

```
sem inverter    742.567 px   0,423% de distância da referência
só separando    742.529 px   0,423%   ← separar as passadas sozinho não muda nada
+ invertendo      1.741 px   0,001%
```

**Efeito colateral que precisa de decisão tua:** a inversão **quadricula o
terreno**. Manchas de terra que hoje são orgânicas passam a mostrar blocos de
borda dura, com os tiles contáveis. **Não é defeito** — o jogo de referência foi
fotografado ao vivo e os blocos estão lá iguais. Mas é uma mudança visual
perceptível. **Se preferires o visual atual, esta é a única alteração a deixar de
fora** — as outras três não dependem dela.

---

## Como conferir depois de portar

Nesta ordem, e **olhando a tela**, não só o número:

1. **`electrode`** — o telhado da Power Plant aparece. Hoje o interior inteiro da
   usina é visível de fora. É o caso mais óbvio.
2. **`cerulean`, prédios brancos** — a laje fecha, a escada fecha.
3. **Saguão do Centro Pokémon** — a mesa de 4 tiles ao lado do sofá escuro fica
   lisa, sem degrau.
4. **Um descampado com mancha de terra** — se aplicaste a alteração 4, os blocos
   de borda dura aparecem. É esperado.

**Armadilha:** interior aparecendo num print quase nunca é bug — confira onde o
personagem está. "Esconder telhado" apaga o telhado do prédio onde ele está. E
prints em câmeras/zoom diferentes não se comparam.

---

## O que NÃO foi testado

Está em `PARA-O-CORONELLX-motor.md`, e vale repetir o essencial: **nada disto
rodou no servidor de vocês nem no app oficial.** Foi medido no visualizador local
e em espelhos em Python das duas engines. Custo de frame em máquina fraca e em
mobile não foi medido. Interação com jogador, NPC, criatura, efeito e UI não foi
testada — o visualizador tem só uma sonda.
