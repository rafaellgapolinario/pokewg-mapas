# Mapas e spawns do PokeWG

Dados de **cenário** do [PokeWG](https://pokewg.com) e um **visualizador que roda no navegador**
pra inspecionar e corrigir esses dados.

Este repositório existe por um motivo específico: a classificação de desenho de parte dos
sprites está errada, e por causa disso o personagem aparece **por cima** de móveis, balcões e
araras dentro das lojas. A correção é num arquivo de dados (`draworder.json`), não no código do
jogo — e este repositório dá tudo que é preciso pra ver o problema, mexer e devolver a correção.

> **O que este repositório NÃO tem:** nada de mecânica de jogo. Sem combate, dano, captura,
> shiny, economia, IV/qualidade, XP, drops, PvP, boss, chat ou GM. Só o desenho do cenário e os
> pontos de spawn. Se você procurava fórmula de alguma coisa, não está aqui — e é de propósito.

---

## Índice

- [Rodando em 3 comandos](#rodando-em-3-comandos)
- [O que o visualizador mostra](#o-que-o-visualizador-mostra)
- [Como o jogo desenha o mapa (e por que o `draworder` importa)](#como-o-jogo-desenha-o-mapa-e-por-que-o-draworder-importa)
- [Formato dos arquivos](#formato-dos-arquivos)
  - [`draworder.json` — o alvo do trabalho](#draworderjson--o-alvo-do-trabalho)
- [Ferramenta de linha de comando](#ferramenta-de-linha-de-comando)
- [Como devolver a correção (fluxo de PR)](#como-devolver-a-correção-fluxo-de-pr)
- [Por que os mapas e o atlas não estão no git](#por-que-os-mapas-e-o-atlas-não-estão-no-git)
- [Licença](#licença)

---

## Rodando em 3 comandos

Requer só **Node 18+**. Não há dependências pra instalar — nenhum `npm install`.

```bash
git clone <este-repo> && cd pokewg-mapas
npm run fetch-assets      # baixa os mapas de exemplo + os sprites (~32 MB)
npm run dev               # abre em http://localhost:8788
```

Pra baixar **todos os 325 mapas** (~198 MB) em vez do conjunto de exemplo:

```bash
npm run fetch-assets -- --todos
```

Ou só o que você precisa:

```bash
npm run fetch-assets -- cerulean viridian pewter
```

O `npm run dev` sobe um servidor estático de 60 linhas (`scripts/servidor.mjs`). Ele existe só
porque `file://` bloqueia `fetch()` de JSON — abrir o `index.html` no dedo não funciona.

---

## O que o visualizador mostra

| | |
|---|---|
| **Lista de mapas** | os 325, agrupados por região, com nome e nível |
| **Desenho fiel** | a mesma ordem de desenho do cliente do jogo, incluindo o *band-split* e o offset diagonal por andar |
| **Sonda** | um boneco de teste que anda pelo mapa. **É com ele que você vê a oclusão** — quem passa na frente e quem passa atrás |
| **Floor-cover** | esconde o telhado do prédio em que a sonda está (só daquele prédio, como no jogo) |
| **Pontos de spawn** | os pontos do `dados/spawns/<mapa>.json`, com o id da espécie. Ponto em tile bloqueado sai em **vermelho** — é spawn que nunca nasce |
| **Colisão** | pinta de vermelho todo tile bloqueado, e de escuro o que está fora da área andável |
| **Categoria do draworder** | contorna cada sprite com a cor da classe dele (`top`, `bottom`, `borders`, …) |
| **Candidatos a `top`** | destaca os sprites que passam de 32px de altura e não estão em `top`. Em **vermelho forte**, os que estão em `bottom` — os que causam o bug |
| **Inspetor de tile** | clique num tile: mostra a pilha inteira, andar por andar, com id, tamanho, classe, colisão, elevação e animação |
| **Propostas** | do inspetor, reclassifique qualquer id pra `top`/`mid`/`bottom`, **veja na hora** o efeito no desenho e exporte um `draworder.json` novo |

### Atalhos

| tecla | ação |
|---|---|
| **setas / WASD** | move a sonda (respeita colisão) |
| **Shift** | corre |
| **N** | atravessa paredes (no-clip) |
| **C** | volta a câmera pra sonda |
| **P** | recolhe o painel |
| **arrastar** | move a câmera livremente |
| **roda** | zoom |
| **clique** | inspeciona o tile |

As propostas ficam salvas no `localStorage` do navegador — você pode fechar e voltar depois.

---

## Como o jogo desenha o mapa (e por que o `draworder` importa)

O cliente separa o cenário em **duas bandas**:

```
banda "achatada"  → chão + tudo que está em bottom/borders/onbottom
                    vai pra um canvas offscreen, desenhado de uma vez só,
                    SEMPRE ATRÁS de todo mundo.

banda "ordenada"  → objetos comuns e topos entram numa fila ordenada por
                    linha (y), JUNTO com os personagens.
```

Dentro da fila ordenada, cada coisa tem uma prioridade dentro da própria linha:

```
objeto comum (mid)   y + 0.3
personagem / sonda   y + 0.5      <- fica no meio
topo (top/toppers)   y + 0.6
```

É por isso que hoje você já passa **atrás** de uma árvore ou de um telhado: eles são `top`,
prioridade 0.6, acima dos 0.5 do personagem.

**E aqui está o bug.** Um id que esteja em `bottom`, `borders` ou `onbottom` **nem entra na
fila** — ele vai pro offscreen achatado. Não existe prioridade que o salve: ele é desenhado
antes de todo mundo, ponto. Se esse id for um sprite de 64×64 que bloqueia passagem (uma
arara de roupa, um balcão, uma quina de parede), o resultado é o personagem andando por cima
do móvel.

No mapa `cerulean`, o critério "altura > 32px, não é chão, não está em `top`/`toppers`" pega:

```
1.036 ids distintos  ·  16.209 usos no mapa
  destes, 296 estão em draworder.bottom  ·  12.783 usos
```

Esses **296** são o alvo. Você reproduz esses números com `npm run analisar` (veja abaixo).

Duas ressalvas que valem antes de aplicar em massa:

1. **"altura > 32" é um filtro grosso.** Vai pegar sprite alto porém achatado na perspectiva,
   que deve mesmo ficar atrás. Por isso a lista sai ordenada por uso: aplique nos primeiros,
   **olhe na tela com a sonda**, e só então siga.
2. **O `cerulean` é um mapa só.** Rodando nos outros a lista cresce. O critério está escrito no
   script pra você reproduzir onde quiser.

---

## Formato dos arquivos

```
dados/
├── map/
│   ├── manifest.json     ← catálogo dos sprites (16.101 assets) + páginas do atlas
│   ├── draworder.json    ← ★ classificação de desenho — O ALVO DO TRABALHO
│   ├── offsets.json      ← deslocamento e elevação de cada sprite
│   ├── collision.json    ← quais sprites bloqueiam passagem
│   └── <mapa>.json       ← os 325 mapas (baixados pelo fetch-assets, fora do git)
├── atlas/                ← as folhas de sprite (baixadas pelo fetch-assets, fora do git)
├── spawns/<mapa>.json    ← pontos de spawn por mapa (281 arquivos)
├── map-markers.json      ← nome, região, nível e posição de cada mapa no mapa-múndi
└── maps-index.json       ← índice dos 325 mapas com metadados (gerado)
```

### `<mapa>.json` — o mapa

```jsonc
{
  "format": "stonegy-map-compact-v1",
  "tiles": [
    [x, y, z, idDoChao, [[idDoItem], [idDoItem], ...]],
    ...
  ],
  "_meta": {
    "range":   [x0, y0, x1, y1, z],   // recorte de onde o mapa foi extraído
    "center":  [x, y],
    "walk":    [minX, minY, maxX, maxY], // retângulo andável; fora dele é sólido
    "groundZ": 7,                        // o andar do chão
    "tileCount": 92355
  }
}
```

Cada tile é um array de 5 posições: `x`, `y`, `z`, o **id do chão** e a **pilha de itens**
(cada item é um array de 1 elemento, o id).

Sobre o eixo `z`: `groundZ` (normalmente 7) é o chão. **`z` menor = andar mais alto**
(telhado, segundo andar) e **`z` maior = subsolo**. Um tile em `z < groundZ` é desenhado
deslocado `(z − groundZ) × 32` pixels — ou seja, sobe e vai pra esquerda um tile por andar.
Sem esse deslocamento, telhado e parede ficam fora de lugar.

### `manifest.json` — os sprites

```jsonc
{
  "categories": { "map-items": { "pages": [{ "index": 0, "image": ".../map-items-00-….webp", … }] } },
  "assets": {
    "101": {
      "width": 32, "height": 32,     // tamanho do sprite (pode passar do tile de 32×32!)
      "isGround": true,               // é peça de chão
      "name": "",                     // SEMPRE vazio — o gerador não exporta nomes
      "frameCount": 4, "frameDurationMs": 100,
      "frames": [{ "page": 1, "x": 1000, "y": 330, "w": 32, "h": 32 }, …]
    }
  }
}
```

O `frames[].page` é o índice em `categories['map-items'].pages`. O arquivo servido é o
**basename** do `image` — `/atlas/map-items-00-….webp`, e é assim que o `fetch-assets` baixa.

**Não existe catálogo de nomes de peças.** O campo `name` vem vazio nos 16.101 assets — é assim
que o gerador cospe. Dá pra derivar semântica dos próprios dados:

- `isGround: true` + `32×32` → piso
- bloqueia + `height > 32` + coluna vertical de 2 tiles → parede
- bloqueia + `64×64` + está em `draworder.bottom` → mobiliário/balcão (a lista dos 296)

### `offsets.json`

```jsonc
{
  "disp": { "1112": [16, 8] },   // desloca o desenho do sprite em x,y (px)
  "elev": { "5303": 8 }          // altura que o item "levanta" o que for empilhado em cima
}
```

### `collision.json`

```jsonc
{ "blocking": [1112, 1111, 873, …] }   // ids que bloqueiam passagem
```

Um tile é sólido se o **chão** ou **qualquer item** dele estiver nessa lista — ou se estiver
fora do retângulo `_meta.walk`.

### `draworder.json` — o alvo do trabalho

Cinco listas de ids. Um id pode aparecer em mais de uma; o cliente resolve assim:

```js
TOP    = top ∪ toppers                    // entra na fila ordenada com prioridade 0.6
BOTTOM = bottom ∪ borders ∪ onbottom      // vai pro offscreen achatado, SEMPRE atrás
// qualquer id fora das duas = "mid": entra na fila ordenada com prioridade 0.3
```

| lista | tamanho hoje | o que deveria ser | onde é desenhado |
|---|---:|---|---|
| `top` | 3.097 | copa de árvore, telhado, topo de morro | fila ordenada, prioridade **0.6** |
| `toppers` | 3 | idem | fila ordenada, prioridade **0.6** |
| `bottom` | 22.269 | deitado no chão: tapete, marca de piso | offscreen, **sempre atrás** |
| `borders` | 8.105 | borda de terreno, transição de textura | offscreen, **sempre atrás** |
| `onbottom` | 12.121 | em cima do chão, mas rasteiro | offscreen, **sempre atrás** |

**Ponto crítico:** as três últimas são equivalentes na hora de desenhar. O cliente só faz
`bottom ∪ borders ∪ onbottom`. Mover um id de `bottom` pra `borders` não muda nada — pra ele
sair da banda achatada, tem que sair **das três**.

Uma peça alta que bloqueia passagem quase nunca deveria estar em qualquer uma das três.

> **Nota:** `draworder.fullgrounds` não existe neste pacote. O cliente também nunca leu essa
> chave. Se você viu ela em outro pacote, é diferença de gerador, não falta de dado.

### `spawns/<mapa>.json`

```jsonc
{
  "start":  { "x": -1, "y": 1 },              // onde o jogador entra no mapa
  "spawns": [ { "pokeId": 63, "x": 28, "y": -17 }, … ],
  "respawnMs": 30000                          // opcional, só 1 mapa usa
}
```

`pokeId` é o número da espécie na Pokédex (63 = Abra). São 281 arquivos, 3.927 pontos no total;
14 mapas têm a lista vazia (cidades e arenas, onde não nasce nada).

O campo `catchChance`, que existia nesses arquivos, foi **removido de propósito** — é mecânica
de captura, e mecânica não entra neste repositório.

### `maps-index.json` e `map-markers.json`

`maps-index.json` é gerado e lista os 325 mapas com `slug`, tamanho do arquivo, contagem de
tiles, `groundZ`, `walk`, `center` e `range` — é o que alimenta a lista do visualizador e a
validação do `fetch-assets`.

`map-markers.json` traz o nome amigável, a região, o nível e a posição de cada mapa no
mapa-múndi.

### Ids ignorados

O cliente pula estes ids ao desenhar — são marcadores internos do editor de mapa, não arte:

```
7124, 1510, 8274, 46638, 46639, 46620, 46621, 1511, 1024
```

O visualizador e o script de análise usam a mesma lista, pra bater 1:1 com o jogo.

---

## Ferramenta de linha de comando

```bash
npm run analisar                          # todos os mapas baixados
npm run analisar -- cerulean --top 20     # um mapa, com o top-20 por uso
npm run analisar -- cerulean --json       # exporta saida/candidatos-cerulean.json
npm run analisar -- cerulean --aplicar    # gera saida/draworder.json corrigido
```

Filtros do `--aplicar`, do mais conservador ao mais grosso:

| flag | promove |
|---|---|
| *(padrão)* / `--so-64` | só `64×64` **e** que bloqueiam passagem |
| `--so-blocking` | todos os candidatos que bloqueiam passagem |
| `--tudo` | todos os candidatos (gera falso-positivo, revise) |

Nada é escrito por cima dos dados originais — a saída vai pra `saida/`, que está no
`.gitignore`. Copie por cima do `dados/map/draworder.json` só quando estiver satisfeito.

Saída do `npm run analisar -- cerulean`:

```
── cerulean ──────────────────────────────────────────
tiles: 92355   ids distintos no mapa: 2684
candidatos (h>32, nao-ground, fora de top+toppers): 1036  | usos: 16209
  destes, em bottom/borders/onbottom: 296
  destes, especificamente em draworder.bottom: 296  | usos: 12783
top + toppers (uniao global): 3081
```

---

## Como devolver a correção (fluxo de PR)

O fluxo desenhado é: **veja o problema → mexa → confira na tela → mande o PR.**

1. **Ache o caso.** Ligue *Destacar candidatos a `top`* e ande com a sonda até um lugar onde ela
   passa por cima de algo que devia cobri-la (uma loja é o melhor exemplo).
2. **Confirme o culpado.** Clique no tile. O inspetor mostra a pilha; o id problemático vem
   marcado como *candidato crítico*.
3. **Proponha.** No inspetor, clique **top** no id. O desenho muda **na hora** — com *Aplicar
   minhas propostas no desenho* ligado, você já vê a sonda passando atrás.
4. **Repita ou vá em lote.** O botão *Promover em lote* aplica o filtro conservador
   (`64×64` + bloqueia) em todo o mapa aberto. Confira na tela depois.
5. **Exporte.** *Baixar `draworder.json`* gera o arquivo completo, pronto pra substituir.
   *Baixar `propostas.json`* gera só o diff legível, que é o que dá pra revisar num PR.
6. **Abra o PR:**

```bash
git checkout -b corrige-draworder-lojas
cp ~/Downloads/draworder.json dados/map/draworder.json
mkdir -p propostas && cp ~/Downloads/propostas.json propostas/lojas-cerulean.json
git add dados/map/draworder.json propostas/
git commit -m "draworder: promove N ids de bottom para top (móveis/balcões de 2 tiles)"
git push -u origin corrige-draworder-lojas
```

**O que ajuda muito na revisão do PR:**

- o `propostas.json` junto — ele diz `id`, classe de origem, classe de destino, tamanho e se
  bloqueia, o que permite conferir sem abrir o jogo;
- **antes/depois** em print do visualizador, com a sonda no mesmo lugar;
- quais mapas você olhou de verdade (o `draworder.json` é **global**: uma mudança vale pros 325);
- se algum id te deixou em dúvida, deixe fora do PR e cite no texto. É mais fácil aprovar um
  lote pequeno e certo do que um grande e duvidoso.

> ⚠️ **O `draworder.json` é um arquivo só, compartilhado por todos os mapas.** Um id promovido
> muda o desenho em qualquer mapa onde ele apareça. Vale a pena conferir pelo menos uma cidade
> e uma hunt antes de mandar.

---

## Por que os mapas e o atlas não estão no git

Os 325 mapas somam ~198 MB e o atlas ~41 MB. Além do tamanho, o atlas é **arte** — e arte é
melhor servida pelo CDN do próprio jogo do que redistribuída por cópia.

Então o git carrega o que **muda e é revisável** (os 4 arquivos de suporte, os spawns, o
visualizador, os scripts, ~5 MB) e o `npm run fetch-assets` traz o resto na hora, das mesmas
URLs públicas que o navegador de qualquer jogador já baixa:

```
https://pokewg.com/map/<mapa>.json
https://pokewg.com/atlas/<pagina>.webp
```

Efeito colateral bom: o mapa que você baixa é o **que está no ar agora**, não uma cópia velha
de um commit antigo. Se precisar apontar pra outro ambiente:

```bash
POKEWG_BASE=https://test.pokewg.com npm run fetch-assets -- cerulean
```

---

## Licença

Código do visualizador e dos scripts: **MIT** (veja `LICENSE`).

Os **dados de mapa** (`dados/`) são publicados sob **CC BY 4.0** — use, modifique e
redistribua, dando crédito. Eles descrevem o layout do cenário do PokeWG.

Isso **não** cobre a arte baixada pelo `fetch-assets` (`dados/atlas/`), que não faz parte deste
repositório e não é redistribuída por ele — o script apenas baixa do servidor do jogo, como
qualquer navegador faz.

*Pokémon e as marcas relacionadas pertencem a Nintendo / Creatures Inc. / GAME FREAK inc. Este
é um projeto de fã, sem qualquer vínculo ou endosso.*
