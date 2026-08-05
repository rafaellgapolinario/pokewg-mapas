# Oclusão do PWG — o que mudou, o que foi medido e o que NÃO foi testado

Branch: **`oclusao-canvas-por-andar`** em `ekooll/pokewg-mapas`, saído do teu
`master`. **4 commits, 1 arquivo** (`visualizador/visualizador.js`).

```
a3608aa  oclusao: um andar de cada vez, em vez de um offscreen achatado
1a53f91  oclusao: as tres passadas do tile, e o border volta a achatar
80be1fa  elev: a peca nao se levanta pela propria elevacao
46974d8  oclusao: a pilha invertida nas passadas de borders e top
```

**Não vai nenhuma mudança de dado.** `draworder.json`, `collision.json`,
`offsets.json` e `manifest.json` ficam como estão — ver "A lista de 1.167 ids
saiu do pacote", mais abaixo.

---

## ⚠️ LEIA ISTO ANTES: o alvo real é o `MapView.tsx`

O README deste repositório diz que a correção esperada era **de dado**
(`draworder.json`) e "não no código do jogo". **Esta não é.** É de código — e por
isso o caminho é diferente do fluxo de PR que o README descreve.

O `visualizador/visualizador.js` é, pelo teu próprio cabeçalho, *"só o desenho do
cenário, **extraído do cliente do jogo** (`app/play/MapView.tsx`)"*. Foi nele que
a correção foi feita, provada e auditada — porque é o que está publicado e é onde
dá pra medir.

**Dar merge neste PR conserta o visualizador, não o jogo.** Para o jogo mudar, as
quatro alterações precisam ser portadas para o `app/play/MapView.tsx`, que está
no repositório do cliente e ao qual eu não tenho acesso.

O que isto te entrega, então:

- a **regra certa**, implementada e legível, no arquivo que espelha o teu
- a **prova** de que ela funciona: 11 testes em pixel e auditoria nos 330 mapas
- o **porquê** de cada mudança, com o caso concreto que ela conserta
- um **guia de porte** (`INSTRUCOES-DE-PORTE.md`, no mesmo pacote) escrito de
  forma independente do arquivo, para aplicar no `MapView.tsx`

Se a matemática de posição do `MapView.tsx` for mesmo idêntica à do visualizador
(como o cabeçalho afirma), o porte é mecânico: são quatro trechos.

---

## ⚠️ O QUE NÃO FOI TESTADO

Antes de qualquer número: isto foi medido **fora do teu ambiente**.

- **Não rodou no servidor de vocês.** Só no visualizador local
  (`localhost:8788`) e nos espelhos em Python das duas engines.
- **Não rodou no app oficial** nem no cliente de produção do PWG. Nenhum
  jogador viu isto.
- **Não foi medido custo de frame em máquina fraca nem em mobile.** O que foi
  verificado é estrutural: continuam sendo 2 offscreens e nenhum canvas é
  criado dentro do laço de desenho.
- **Não foi testado com mapa em edição, mapa novo ou dado fora dos 330
  publicados.**
- **Não foi testado interação com nada que desenhe por cima do mapa** —
  jogador, NPC, criatura, efeito, UI. O visualizador tem só uma sonda de teste.
- **Os 8 ids que o `cerulean` usa e nenhum manifest conhece** (`2025, 12718,
  12776, 12875, 12879, 44384, 58878, 58879`) continuam sumindo da tela. Não é
  desta mudança e não foi atacado.

---

## O defeito

O interior dos prédios vaza por cima da laje. A parede interna do térreo tem `y`
alto; o telhado do andar de cima tem `y` baixo. Como tudo caía num offscreen
achatado mais **uma** fila global ordenada só por `y`, a parede desenhava depois
do telhado.

Não é dado. Nenhuma lista de ids conserta isso.

---

## A mudança

### 1. Um andar de cada vez (`a3608aa`)

Fechar **um andar antes de começar o próximo**, do mais fundo (`maxZ`) pro mais
alto (`minZ`). Dentro de cada andar, duas bandas:

| banda | o quê | ordem |
|---|---|---|
| **CHÃO** | campo chão e `BOTTOM` que achatam | ordem de varredura |
| **ITEM** | o resto | `profundidade(tx,ty) + prioridade + 8e6` |

Continuam sendo **dois offscreens**, os mesmos de antes — colar N canvas em ordem
dá o mesmo pixel que pintar os N na mesma ordem dentro de um. Medido nos 330
mapas: uma janela chega a tocar **15 andares**; um canvas por andar custaria 15
canvas de tela cheia sem ganho nenhum.

Mais: **profundidade passa de `ty` para `(tx+ty)*4096 + 4*tx`**. O andar de cima
é desenhado deslocado em x **e** y (`fo = (z-GZ)*32` nas duas), então a
profundidade tem que andar na mesma diagonal. É load-bearing: voltar pro `ty`
puro faz a árvore parar de ocluir (483 px → 944 px).

### 2. As três passadas dentro do tile (`1a53f91`)

Na ordem: **campo chão** → **BOTTOM** → **MID em duas passadas** → **TOP**.

- o **campo chão** só vai pra banda CHÃO se **achatar** (`isGround`, ou `border`
  que não seja top). Peça de telhado que aparece em `t[3]` e não é chão de
  verdade passa a disputar profundidade — era o que cortava a pokébola do
  letreiro do Mercado ao meio (tile `19,16,5`).
- **"bottom puro"** (rocha, penhasco, tronco caído, muro — nem `isGround` nem
  `border`) passa a **disputar profundidade** com prioridade 0, em vez de seguir
  a ordem de varredura crua.
- **`mid` em duas passadas**: quem bloqueia passagem antes de quem não bloqueia,
  independente da ordem da pilha.
- **um só acumulador de elevação por tile**, alimentado também pelo campo chão.
  Antes o chão entrava com `ex` fixo em 0 e nunca acumulava — a parede saía 12px
  baixa demais no patamar sul do Centro Pokémon (`-4,-7,6`, chão `17970`,
  elevação 12) e cortava o feixe da rampa.

**Duas guardas que faltavam, e valem por si:**

- o **`border` precisa achatar**. 167.122 tiles dos 330 mapas têm campo chão que
  é `border` e não é `isGround` (bordas de gelo e água, 412 ids).
- **id que está em `TOP` e `BOTTOM` ao mesmo tempo conta como top, nunca como
  bottom.** São 43 ids, com 27 ocorrências reais em `jumpluff`, `ledyba`,
  `magikarp` e `vaporeon`, que eram desenhadas **duas vezes**. Defeito
  pré-existente, independente do resto.

### 3. `elev`: a peça não se levanta pela própria elevação (`80be1fa`)

`retangulo()` fazia:

```js
y = ty*32 - (h-32) - disp[1] - ((elev[id] || 0) + ex)
```

somando a elevação da **própria** peça à acumulada `ex`. Efeito visível: a mesa
de 4 tiles do saguão do Centro Pokémon saía **com degrau** — a coluna esquerda
(`18273`/`18259`, elev 6) subia 6px e a direita (`18272`/`18260`, elev 0) não.
Cada peça está sozinha no seu tile, então o acumulado é zero e nenhuma delas
deveria subir.

Mexe em todas as peças com elevação (**4.697 ids**). **Defeito pré-existente** —
a fórmula já estava assim antes deste branch.

---

### 4. A pilha invertida em `borders` e `top` (`46974d8`)

O renderizador de referência percorre a pilha do tile **invertida** em duas das
sete passadas — a de `borders` e a de `top`. As outras cinco usam a ordem
autorada. Para replicar, a passada de `BOTTOM` foi separada nas três que ela
sempre foi lá: `bottom que é chão` (ordem da pilha) → `borders` (**invertida**)
→ `bottom puro` (ordem da pilha).

```
funde as passadas, nao inverte    742.567 px   0,423%
so SEPARA as passadas             742.529 px   0,423%
separa + INVERTE                    1.741 px   0,001%
```

Separar sozinho não muda nada. **A inversão responde por 99,8%** de toda a
diferença que ainda sobrava contra a referência.

Efeito colateral que vale tu saber antes de aprovar: a inversão **quadricula o
terreno**. Manchas de terra que hoje são orgânicas passam a mostrar blocos de
borda dura, com os tiles contáveis. **Isso não é defeito — é como o jogo de
referência desenha.** Foi fotografado ao vivo, com o personagem parado na trilha
de `(-71,20)` do cerulean, e os blocos estão lá iguais. Se tu preferir o visual
atual ao da referência, este é o commit a deixar de fora — os outros três não
dependem dele.

## A lista de 1.167 ids saiu do pacote

O branch anterior levava junto uma lista de 1.167 ids promovidos a `mid`, para
árvore, muro, balcão e penhasco esconderem o personagem. **Depois das mudanças
acima ela virou desnecessária e passou a atrapalhar.** Medido nos 330:

```
distância do renderizador de referência    com a lista  0,248%
                                           sem a lista  0,243%
mapas em que a lista APROXIMA                0 de 330
mapas em que a lista AFASTA                 27  (8.416 px)
```

E nas quatro cenas que motivaram a lista (atrás da copa, na frente da copa, área
aberta, dentro do CP) o resultado é **idêntico com e sem ela**. Por isso a
entrega é **só código**.

---

## O que foi medido

**Testes em pixel** (`testa-motor-novo.py`, 11 testes, todos passando):

```
predio cobre o personagem SEM lista de ids     322 px -> 0 px
sonda em area aberta                           946 px   (nao pode cair)
sonda na frente do objeto                      946 px   (nao pode cair)
atras da copa, sem lista                       483 px   (esconde sozinha)
subsolo                                          0 px diferentes
terreno andavel x referencia        0 px de 172.032 (motor de hoje: 14.318)
offscreens de mapa                               2 (mapCv, topCv)
canvas criado dentro do laco de desenho          0
```

**Auditoria nos 330 mapas publicados** (`audita-330.py`):

```
mapas renderizados        330        erros de renderizacao  0
regressoes                  0
mapas que melhoraram      323
identicos                   7

distancia somada do renderizador de referencia:
  motor de hoje + lista   13,096%
  motor novo    + lista    0,248%
  motor novo    sem lista  0,243%
```

O critério de regressão é **"a distância do renderizador de referência não pode
aumentar"**, mais conferência no PNG. O critério antigo era "o mapa não pode
mudar onde não há andar de cima" — não serve mais, porque as passadas dentro do
tile mudam mapa sem andar de cima **de propósito**. Com o critério velho,
`ledyba`, `hoppip`, `seadra` e `vaporeon` apareciam como regressão; conferidos na
tela, os quatro **melhoraram muito**.

---

## O que eu deliberadamente NÃO mudei

*(a inversão da pilha ficava aqui e saiu desta lista — ela ENTROU, no commit
`46974d8`. A história de por que ela tinha sido rejeitada duas vezes está no
corpo daquele commit e vale a leitura: as duas rejeições vieram de dedução, não
de medida.)*
- **a leitura das listas.** Continua `TOP = top ∪ toppers` e
  `BOTTOM = bottom ∪ borders ∪ onbottom`.
- **a banda CHÃO não é ordenada por profundidade**, de propósito. Peça larga de
  terreno é desenhada a partir do canto superior-esquerdo dela; ordenar a banda
  chão faz o capim do tile seguinte cobri-la.
- **`P_SONDA`** foi de 0.5 pra 0.4 junto com a fórmula nova de profundidade.
  Medido antes de ficar: os dois valores caem no intervalo aberto (0.3, 0.6) e a
  chave de item só sobe de 0,001 em 0,001 dentro do tile, então só um tile com
  mais de 100 peças conseguiria cair entre 0.4 e 0.5. A maior pilha dos 330
  mapas tem **33 peças**, em 8.188.199 tiles. **Não muda um pixel.**

---

## Como conferir

No visualizador, `http://localhost:8788/visualizador/index.html`:

1. abrir `electrode` — o telhado da usina aparece; hoje o interior inteiro é
   visível de fora
2. abrir `cerulean` e olhar os prédios brancos — a laje fecha, a escada fecha
3. o saguão do Centro Pokémon: a mesa de 4 tiles ao lado do sofá escuro fica
   lisa, sem degrau
4. **não** carregar `propostas.json` — a lista saiu do pacote

Em `ekooll/mapa-stonegy`:

```
python ferramentas/testa-motor-novo.py     # os 10 testes em pixel
python ferramentas/audita-330.py           # a auditoria nos 330 mapas
```

---

## De onde veio a regra

Do teu próprio motor, relido — e do cliente do Poke Idle World, que é público
(`_next/static/chunks/`) e usa PixiJS com um container por andar. Medi lá pra
entender **por que** o mesmo `cerulean.json` (byte a byte igual nos dois jogos,
mesmo MD5) sai certo lá e errado aqui.

**Nada do código deles foi copiado**: o que está no branch é a regra
reimplementada na tua fonte. O estudo completo está em
`referencia/MOTOR-DO-PIW.md`.

Duas coisas de lá que valem pra ti mesmo sem esta mudança:

- **`fullgrounds`, `onbottom` e `toppers` são listas mortas** no cliente deles —
  carregam as cinco e leem três (`top`, `bottom`, `borders`).
- o `IGNORE` de 9 ids do teu visualizador é **idêntico** ao deles.

---

## Pendências que continuam abertas

1. **8 ids usados pelo `cerulean` não existem no `manifest.json`** (`2025,
   12718, 12776, 12875, 12879, 44384, 58878, 58879`) — somem da tela sem erro
2. a porta do Centro Pokémon continua sendo atravessada
3. confirmar se mesa entra no critério de colisão
4. balcão da Nurse Joy mutilado, Pokémon sem rastro na água, nome flutuante
   ilegível sobre piso claro — não atacados
5. sobra **0,243%** de diferença contra o renderizador de referência, sem
   diagnóstico fino. Deliberadamente **não** perseguido: duas tentativas
   anteriores de caçar esse número por conta própria ganharam distância e
   quebraram mapas
