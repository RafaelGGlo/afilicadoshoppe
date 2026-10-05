# Painel de Ofertas Shopee → WhatsApp

## Cadastro manual — funciona sem credenciais da API

O painel agora permite preparar ofertas reais enquanto o acesso à API está pendente, mantendo Express, SQLite, Sharp e a interface existentes. As ofertas **Manual**, **API** e **DEMO** usam a mesma lista e prévia; os dados simulados continuam identificados como DEMO.

1. Execute `npm install` se as dependências ainda não estiverem instaladas e depois `npm start`. Abra <http://localhost:3000>. Não é necessário preencher `SHOPEE_APP_ID` ou `SHOPEE_SECRET` para o cadastro manual. A senha do painel, quando configurada, continua exigida.
2. Na aba **Cadastro manual**, informe nome, seu link HTTPS de afiliado da Shopee Brasil (`shopee.com.br`, seus subdomínios, ou `shope.ee`), preço e categoria. Para faixa, informe mínimo e máximo em campos separados. Use `99,90` ou `99.90`, sem símbolo de moeda ou separador de milhar.
3. Preço anterior, cupom, condições e observações são opcionais. Condições exigem um cupom informado. Para mostrar “De R$ … por R$ …” e o desconto, marque **Confirmo que o preço anterior e o atual são da mesma variante**. O preço anterior precisa ser maior que o atual e o preço precisa ser único. O desconto usa `((anterior - atual) / anterior) × 100`, com uma casa decimal brasileira (ex.: `20,0%`). Faixas mostram “A partir de R$ X — varia até R$ Y” e não calculam desconto.
4. Escolha **upload ou URL HTTPS** de imagem. Clique em **Preparar oferta**: a oferta é salva no SQLite existente e abre a prévia com imagem e legenda editável. Nenhuma consulta, scraping ou extração do link é feita. O link é preservado exatamente, incluindo parâmetros repetidos, rastreamento e codificação. A validação não consegue confirmar se o link realmente atribui comissão à sua conta.
5. Ajuste a legenda na prévia e use **Salvar legenda**. O modelo continua editável em **Configurações**, com `{nome}`, `{preco}`, `{desconto}`, `{extras}` e `{link}`; observações e cupom aparecem somente quando preenchidos. **Refazer pelo modelo** regenera a legenda. Abrir uma oferta manual preserva a legenda personalizada. A migração atualiza o padrão antigo e as legendas automáticas existentes; textos personalizados são preservados, removendo apenas as duas frases excluídas. Preços antigos não recebem confirmação de variante automaticamente: edite a oferta para confirmar antes de calcular desconto.
6. Use **Editar dados** para reabrir o cadastro manual. Sem nova imagem, a atual é mantida. Salvar a edição refaz a legenda e prepara a oferta novamente: uma publicação anterior exige nova confirmação. **Duplicar oferta** cria outra oferta com a mesma origem e sem estado de publicada. Editar legenda, substituir imagem, duplicar, descartar e marcar como publicada também estão disponíveis nas ofertas da API.
7. A prévia destaca foto, legenda editável e **Compartilhar foto e legenda**. **Copiar legenda** e **Baixar imagem** são alternativas discretas. Edição, substituição da imagem, duplicação e alteração manual de status ficam em **Mais opções**. Você escolhe o WhatsApp, o grupo e confirma o envio; o estado só muda pela sua confirmação ou pela alteração manual de status. Cadastro, edição, duplicação e mudanças de estado aparecem no histórico.

### Imagens e limitações de compartilhamento

- Aceita JPG, PNG e WebP estáticos, até 6 MB, com validação pelo conteúdo e limite de 50 milhões de pixels. SVG, GIF, animações e arquivos falsos são recusados. Erros não criam ofertas nem substituem a imagem já salva; os campos do formulário permanecem preenchidos para correção.
- O Sharp orienta a imagem, reduz até 1600 pixels e converte para JPEG, preservando proporção e sem ampliar ou cortar o produto. Transparência recebe fundo branco. A lista também mostra o produto sem corte.
- Lado menor abaixo de 500 pixels gera aviso e estado **Precisa de revisão**. Substitua pela prévia (upload) ou por **Editar dados** (upload ou URL). O processamento não recupera detalhes de uma imagem ruim.
- URLs externas exigem HTTPS/porta 443, recusam credenciais, redes internas, IPs reservados, DNS para destinos internos e redirecionamentos inseguros. Cada conexão tem limite de tempo e o corpo é limitado a 6 MB. Uma URL com proteção de acesso ou que não entregue a imagem diretamente pode falhar; nesse caso use upload.
- Compartilhar arquivos depende de Web Share, navegador, aparelho e contexto seguro (HTTPS ou localhost). Um celular acessando o painel por HTTP na rede pode não ter essa função. O WhatsApp pode ignorar o texto junto à imagem; copie a legenda e cole manualmente. Se o compartilhamento não estiver disponível, baixe a imagem e copie a legenda. Não há envio automático nem confirmação técnica de entrega.

### Arquivos e verificação do modo manual

`src/manual.js` implementa validação, cadastro/edição e duplicação; `src/db.js` migra o banco automaticamente sem remover dados; `src/message.js` monta os campos opcionais; `src/images.js` valida e processa imagens; `src/offers.js` evita atualizar manuais na API e registra estados; `src/server.js` expõe as rotas autenticadas; `public/index.html`, `public/app.js` e `public/style.css` integram o formulário à interface. `tests/manual.test.js` cobre cadastro, reabertura do SQLite, migração, edição, legenda, duplicação, publicação explícita e imagens inválidas/pequenas.

Execute `npm test` para verificar o projeto. Novas rotas: `POST /api/manual`, `PUT /api/manual/:id` e `POST /api/offers/:id/duplicate`; exigem as mesmas regras de sessão e CSRF do painel. Upload no cadastro usa base64 em JSON, com limite de corpo de 9 MB apenas nas rotas manuais.

Sistema em Node.js que consulta a **API oficial de afiliados da Shopee Brasil**, prepara imagem + legenda com o **seu** link de afiliado e deixa tudo num painel. **Você** compartilha no WhatsApp e confirma o envio.

> O sistema **não envia nada sozinho** para o WhatsApp e **não contrata nenhum serviço**.

---

## 1. Como funciona (arquitetura)

```
Navegador (painel) ──HTTP──▶ Express 5 ──▶ SQLite (ofertas, configurações, histórico)
                                │
                                ├──▶ API de afiliados da Shopee (GraphQL, só no backend)
                                └──▶ Download seguro de imagens ──▶ pasta data/images
```

| Arquivo | O que faz |
|---|---|
| `src/shopee.js` | Cliente da API: assinatura, timeout, tentativas, erros, modo demo |
| `src/offers.js` | Busca, filtro de preço, **não repetir produto**, link, imagem, atualização |
| `src/images.js` | Baixa imagem com proteção contra URL interna e valida o arquivo |
| `src/message.js` | Monta preço e legenda (sem inventar nada) |
| `src/scheduler.js` | Consulta automática com trava (sem tarefas duplicadas) |
| `src/auth.js` / `src/server.js` | Login, rotas da API e painel |
| `public/` | Painel (HTML, CSS, JS) |
| `tests/` | Testes automatizados (`npm test`) |

## 2. O que foi verificado na documentação (e o que NÃO foi)

**Importante, leia:** os dois links oficiais (`affiliate.shopee.com.br/open_api` e o Explorador) só abrem com login e carregam por JavaScript. Eu **não consegui ler o texto oficial** deles. Por isso:

**Confirmado por fontes secundárias** (documentação espelhada da Open API de afiliados, um SDK .NET e uma ferramenta pública que usam a API do Brasil):
- Endpoint do Brasil: `https://open-api.affiliate.shopee.com.br/graphql` (GraphQL, método POST).
- Autenticação: cabeçalho `Authorization: SHA256 Credential={AppId}, Timestamp={ts}, Signature={assinatura}`, com `assinatura = SHA256(AppId + Timestamp + Payload + Secret)`, onde Payload é o corpo JSON exato.
- Operação de busca: `productOfferV2` (filtros `keyword`, `productCatId`, `itemId`, `sortType`, `page`, `limit`). Campos usados: `itemId, productName, priceMin, priceMax, imageUrl, productLink, offerLink, shopId, shopName`.
- Operação de link: `generateShortLink(input:{originUrl, subIds})` → `shortLink` (até 5 subIds).
- Códigos de erro: 10020 (assinatura/credencial), 10030 (limite), 10035 (sem acesso à Open API), entre outros.
- A API **de afiliados é diferente** da API de vendedores (`open.shopee.com`); este projeto só usa a de afiliados.

**NÃO confirmado:**
- Os **limites exatos** de requisições. Por segurança o sistema espera 0,7 s entre chamadas, tenta de novo com espera crescente e para a consulta se receber erro de limite.
- Se a **sua conta** já tem permissão (erro 10035 = precisa pedir acesso no painel da Shopee).
- Se algum campo é diferente no Brasil. **Antes do primeiro uso real**, abra o Explorador oficial (logado) e rode uma consulta `productOfferV2` com os mesmos campos. Se algum campo der erro, ajuste a consulta em `src/shopee.js` (função `searchProducts`).

**Limitações da API que afetam o resultado:**
- A API devolve **uma** imagem por produto (`imageUrl`). Não há fotos alternativas confirmadas, então esta versão **não** tenta outras: se a imagem falhar ou for pequena, a oferta vai para **revisão** e você envia a sua.
- Não há campo confirmado de preço anterior, cupom, frete grátis ou estoque. Por isso a legenda **não menciona** nada disso.

## 3. Instalação no Windows + VS Code

1. Instale o **Node.js 24 LTS**: <https://nodejs.org> (versão LTS). Confira no terminal: `node -v` (deve mostrar `v24...`).
2. Descompacte a pasta do projeto e abra no VS Code (**Arquivo → Abrir Pasta**).
3. Abra o terminal do VS Code (**Ctrl + '**) e rode:
   ```
   npm install
   ```
4. Crie o arquivo de configuração copiando o exemplo:
   ```
   copy .env.example .env
   ```
5. Abra o `.env` no VS Code e preencha (veja a seção 4).
6. Rode:
   ```
   npm start
   ```
7. Abra <http://localhost:3000>.

Sem `SHOPEE_APP_ID`/`SHOPEE_SECRET`, o **cadastro manual funciona normalmente**. A busca da API usa **MODO DEMONSTRAÇÃO**, com “[DEMO]” nos nomes. Esses dados de busca são inventados, não têm link real e **nunca** vão para “preparada”.

## 4. Configurando a Shopee

1. Entre no painel de afiliados: <https://affiliate.shopee.com.br/open_api>.
2. Gere/consulte seu **App ID** e **Secret**.
3. No `.env`:
   ```
   SHOPEE_APP_ID=seu_app_id
   SHOPEE_SECRET=seu_secret
   ```
4. **Nunca** coloque o Secret no chat, no código, em print ou no GitHub. O `.gitignore` já ignora o `.env`.
5. Reinicie (`Ctrl + C` e `npm start`).

Se aparecer o erro de assinatura (10020): confira App ID/Secret e se o **relógio do Windows** está certo (a assinatura usa a hora).

## 5. Usando o painel

- **Buscar:** digite uma palavra-chave (ou deixe vazio para usar as das Configurações) e clique em *Buscar e preparar ofertas*.
- **Configurações:** palavras-chave, categorias, faixa de preço, quantas ofertas por consulta, **dias para não repetir produto**, sub IDs, modelo da legenda e consulta automática.
- **Ofertas:** lista com imagem, preço e link; filtre por estado. Clique numa oferta para abrir a prévia.
- **Prévia:** ao abrir, o sistema **atualiza os dados na Shopee** (preço/nome) e refaz a legenda. Você pode editar a legenda, enviar uma imagem sua, copiar a legenda, baixar a imagem e compartilhar.
- **Estados:** *preparada*, *precisa de revisão*, *publicada*, *descartada*. “Publicada” só muda quando **você** confirma.
- **Histórico:** consultas e erros.

Modelo padrão (linhas opcionais vazias são omitidas):
```
🔥 OFERTA SHOPEE!
{nome}
💰 {preco}
{desconto}
{extras}
🛒 Compre aqui: {link}
```
Quando o produto tem variantes, o preço aparece como “a partir de R$ X (varia até R$ Y)”.

### Consulta automática
Funciona **só enquanto o `npm start` estiver rodando** no computador (se fechar o terminal ou desligar o PC, para). Há uma trava para não rodar duas consultas ao mesmo tempo e o intervalo mínimo é 15 minutos.

## 6. WhatsApp: como o compartilhamento funciona

- **Compartilhamento conjunto:** *Compartilhar foto e legenda* envia uma única foto e o texto completo em uma só chamada de `navigator.share({ files: [foto], text: legenda })`, após validar o suporte aos arquivos, ao texto e ao conjunto. O link de afiliado permanece integralmente no texto, junto de nome, preço e cupom opcional. Não há título/URL enviados à parte, segundo compartilhamento ou texto desenhado na imagem. A foto é carregada antes do clique; enquanto carrega, o botão mostra *Preparando imagem…*. A chamada não aguarda rede ou área de transferência antes de abrir o seletor do aparelho.
- **Escolha e confirmação:** selecione o WhatsApp e o grupo, confira se o texto aparece no campo de legenda da foto e confirme o envio. Web Share entrega os dados ao aplicativo escolhido e não permite impor como ele os apresenta; o navegador não consegue detectar se o WhatsApp descartou ou separou a legenda. A validação de suporte não garante essa apresentação. Referência: [Web Share API, W3C](https://www.w3.org/TR/web-share/).
- **Alternativa para uma única mensagem:** quando não houver suporte, ocorrer falha ou o texto não vier junto, use *Baixar imagem* e *Copiar legenda*. No WhatsApp, escolha o grupo, anexe a foto e cole o texto em **Adicionar legenda** antes de enviar a foto. Não envie o texto como uma mensagem separada. A falta de suporte ou falha gera uma única orientação, sem mensagem de sucesso. Copiar e baixar são ações explícitas do usuário e permanecem disponíveis.
- A pergunta de publicação aparece **somente após `navigator.share` resolver**, uma vez e sem aviso de sucesso duplicado. Cancelamento (`AbortError`) apenas informa “Compartilhamento cancelado.”, oculta qualquer confirmação anterior e não salva estado de publicação. Enquanto o compartilhamento está pendente, cliques repetidos e confirmações antecipadas são ignorados. Só vira “publicada” ao responder que sim, ou usando **Mais opções → Alterar status manualmente → Publicada (já enviei)** para um envio feito pelo procedimento manual. A resolução da API não é uma confirmação técnica de entrega no WhatsApp.
- Não há bot, QR Code, automação do WhatsApp Web, nem link `wa.me` fingindo enviar imagem em grupo.
- **Futuro:** a parte de “compartilhar” está isolada em `public/app.js`. Uma integração oficial poderia entrar no backend, mas **não** prometo que ela consiga postar em grupos já existentes — isso precisa ser verificado na documentação do WhatsApp na época.

## 7. Segurança

- App ID e Secret ficam só no backend (`.env`), nunca vão para o navegador, logs ou histórico.
- Por padrão o painel só abre no seu computador (`HOST=127.0.0.1`). Se mudar o `HOST` para abrir na rede/internet, o sistema **se recusa a iniciar sem `PANEL_PASSWORD`**.
- Login por senha com cookie `HttpOnly` + `SameSite=Strict`, limite de tentativas, proteção contra CSRF e cabeçalhos de segurança.
- Se for expor na internet, use **HTTPS** (por exemplo, atrás de um proxy reverso). Sem HTTPS a senha trafega sem proteção.
- Download de imagens: só HTTPS, bloqueia endereços internos (localhost, redes privadas, etc.), valida redirecionamentos, limita a 6 MB e confere o **conteúdo real** do arquivo (JPG/PNG/WebP). A imagem é só reduzida (máx. 1600 px) e convertida para JPEG; não é cortada nem editada.
- Textos vindos da API são exibidos como texto puro (sem risco de HTML malicioso).

## 8. Testes (`npm test`)

**Testes automatizados (`npm test`):** geração de legenda e preços, assinatura e cabeçalho, escape de palavra-chave, erros 10020/429/500/timeout, tentativas, prevenção de repetição (na mesma consulta, entre consultas, janela de dias), faixa de preço, falha de link, imagem inválida, proteção contra URL interna, trava de tarefas duplicadas, login e CSRF, upload de imagem, cadastro manual sem API, persistência e migração do SQLite, edição, duplicação, download HTTPS simulado e “nunca marcar como publicada sozinho”.

**Com a API real da Shopee: NÃO foi testado.** Não tenho suas credenciais (e não devo ter). O primeiro teste real é com você: rode uma busca e veja o **Histórico** e a faixa de modo no topo.

**Compartilhamento testado com navegador simulado:** `tests/sharing.test.js` executa o código real do painel com DOM, Web Share, clipboard e rede simulados. Cobre foto e texto em uma única chamada, legenda/link preservados, chamada no gesto do clique, alternativa de baixar/copiar, falta de suporte, falha/cancelamento, carregamento lento, troca de oferta, erro de imagem, falha ao salvar e publicação apenas por confirmação. **Não foi testado em aparelho/WhatsApp real**; a apresentação final depende do aplicativo e sistema operacional.

Também **não foi testado** o download real de imagens da Shopee (só a lógica de validação e bloqueio, com imagens geradas no teste).

## 9. Problemas comuns

| Mensagem | O que fazer |
|---|---|
| “Assinatura/credencial inválida…” (10020) | Confira App ID, Secret e o relógio do PC |
| “…ainda não tem acesso à Open API…” (10035) | Peça acesso à Open API no painel da Shopee |
| “Limite de requisições excedido” (10030) | Espere e use menos palavras-chave/páginas |
| Erro falando de um campo | Confira os campos no Explorador oficial e ajuste `src/shopee.js` |
| Oferta em “revisão” por imagem | Use *Enviar imagem manualmente* |
