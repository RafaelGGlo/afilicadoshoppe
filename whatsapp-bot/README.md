# Bot de ofertas — Node.js

Implementação modular construída a partir do trecho enviado. Não foi fornecido o restante do projeto original: esta é uma base independente, não uma alteração auditada daquele repositório.

## Produtos com 5 mil vendas ou mais

`SHOPEE_MIN_SALES=5000` exige pelo menos 5.000 vendas informadas no campo `sales` da API. Produtos com menos vendas ou dados ausentes/inválidos são ignorados. Todas as categorias continuam permitidas, com desconto informado pela API. A quantidade de vendas é usada apenas no filtro; não aparece na legenda. O bot não presume a janela de tempo dessa contagem nem que ela seja um ranking global. Use `SHOPEE_MIN_SALES=0` para remover essa exigência e reinicie para aplicar.

## Ofertas com desconto — todas as categorias

A configuração local usa `SHOPEE_OFFER_MODE=discount-only` e `SHOPEE_CATEGORY_IDS=` vazio. O bot busca produtos de todas as categorias e envia apenas aqueles com `priceDiscountRate` maior que zero e menor que 100, informado pela API. Produtos sem esse dado ou com valor inválido são ignorados. Nesse modo, a lista manual não participa dos envios, pois não comprova desconto pela API.

O percentual não é usado para inventar preço anterior ou preço no Pix. As ofertas não são chamadas de relâmpago. O modo `flash-only` continua bloqueado até existir uma fonte verificada, conforme [a verificação da API](docs/flash-sale-support.md).

## Busca automática pela API da Shopee

Com `SHOPEE_APP_ID`, `SHOPEE_SECRET` e `SHOPEE_AUTO_SEARCH=true`, o bot consulta `productOfferV2` em cada ciclo e obtém nome, preço, foto e link de afiliado diretamente da API. Não é necessário preencher `deals.json`. O arquivo continua disponível como fonte adicional de ofertas manuais.

A busca percorre até cinco páginas de 30 produtos por ciclo, ignora dados inválidos e produtos já enviados para todos os grupos durante `DEDUP_HOURS`. Quando uma página é esgotada, avança para a próxima. A ordem é a retornada pela Shopee; não há promessa de menor preço, confirmação de estoque ou descoberta de cupons. Preços com variações são apresentados como “Menor preço”.

Para validar uma oferta e baixar a foto sem enviar mensagens: `node src/preview-shopee.js`. Para executar: `npm.cmd start`. Não inicie uma segunda instância se o bot já estiver ligado.

Na configuração local atual, o ciclo é de um minuto e o limite é uma oferta por ciclo. O processo precisa continuar ligado e com internet. Use `SHOPEE_AUTO_SEARCH=false` para usar apenas o arquivo local.

## Filtro de eletrônicos e legenda

Para restringir a busca a eletrônicos, use `SHOPEE_CATEGORY_IDS=100535,100013,100644,100634,100635`: áudio, celulares, informática, videogames e câmeras. O bot filtra a consulta na API e também confere as categorias recebidas antes do envio. Capas, películas e alguns acessórios passivos identificados no título são descartados. A classificação depende das categorias informadas pela Shopee; cadastros incorretos podem precisar de novos bloqueios.

Para permitir todas as categorias, deixe `SHOPEE_CATEGORY_IDS=` vazio. Ofertas manuais também precisam de `categoryIds` compatíveis quando o filtro está ativo; ofertas sem categoria não são enviadas. Cada ciclo alterna as categorias, preservando a paginação e o histórico de envios.

`OFFER_HEADLINE` define a chamada em destaque acima do nome do produto. A legenda usa o menor valor retornado pela API, com “Menor preço” quando existem variações. “De … por …” só aparece para ofertas com preço anterior informado e sem variações; o preço máximo de uma variação não é tratado como preço anterior. A consulta automática atual não fornece preço anterior.

Após mudar o `.env`, reinicie o processo para aplicar. `node src/preview-shopee.js` valida a busca, a legenda e a foto sem enviar mensagens.

## Iniciar no Windows

### Testar o CSV de links da Shopee sem API

O comando abaixo valida o CSV exportado pela Shopee, com as colunas `Item Id`, `Item Name`, `Price`, `Product Link` e `Offer Link`. Ele preserva o link de afiliado de `Offer Link` e aceita preços como `29,90`. Não busca preço ou estoque ao vivo.

```powershell
npm.cmd run send-csv-test -- "C:\caminho\arquivo.csv"
```

Para enviar, pare o bot com Ctrl+C e acrescente `--send`:

```powershell
npm.cmd run send-csv-test -- "C:\caminho\arquivo.csv" --send
```

O lote envia somente texto ao primeiro grupo de `GROUP_IDS`, uma oferta por minuto, com indicação de teste. Ele usa o mesmo histórico e lock do bot para evitar duplicatas e sessões concorrentes. Produtos já enviados ou com envio incerto são ignorados durante `DEDUP_HOURS`. O processo termina ao concluir o lote. Em seguida, use `npm.cmd start` para retomar o agendamento normal. Este comando não obtém fotos; a importação do CSV pelo agendador normal ainda não está implementada.

Instale Node.js 22 ou superior. Extraia o ZIP e abra um terminal nessa pasta:

```powershell
Copy-Item .env.example .env
npm install
npm test
npm start
```

Preencha `.env` com seus grupos e credenciais. Edite `deals.json` com ofertas reais seguindo `deals.example.json` (os exemplos são placeholders e não devem ser enviados). Escaneie o QR no terminal usando WhatsApp > Aparelhos conectados. O primeiro ciclo ocorre no próximo horário do cron, a cada 10 minutos por padrão. O processo precisa permanecer ligado.

O pacote inclui `package-lock.json`; você pode usar `npm ci` para instalar as versões resolvidas. O ZIP não inclui credenciais ou sessão vinculada. Baileys está fixado na versão 7.0.0-rc14, uma release candidate; valide com uma conta e um grupo de teste antes de operar. A instalação das dependências e a integração real dependem de acesso à rede e às suas contas.

## O que está implementado

- Uma chamada `sendMessage(group, { image: Buffer, caption })`: foto e texto juntos.
- `GROUP_IDS` separado por vírgulas, validação e remoção de grupos repetidos.
- Histórico persistente `sent_deals.json`, separado por grupo e produto, com expiração configurável.
- Métodos `store.isDealSentToGroup(dealId, groupId)` (boolean síncrono) e `store.markDealAsSent(dealId, groupId)`.
- Reservas em disco antes do envio, gravação temporária + fsync + rename e recusa de histórico corrompido.
- Intervalo aleatório de 5–15 segundos entre tentativas, também entre ofertas e após erros.
- Um ciclo de cada vez; uma instância por diretório, protegida por `bot.lock`.
- Imagens baixadas uma vez por oferta, com timeout, limite de 5 MiB, validação de formato e sem redirecionamentos.
- Imagem inválida: pula a oferta, continua as outras, não envia texto isolado.
- Erro de grupo: continua os demais. Erro de disco: interrompe envios inseguros.
- Sessão em `auth_info`, salvamento de credenciais, reconexão com backoff e parada em logout/sessão inválida/substituída.
- Ofertas inativas ou expiradas não são enviadas; formatação de reais, cupom e divulgação de afiliado.

## Fontes de ofertas e links afiliados

`deals.json` é uma fonte adicional, relida a cada ciclo. A fonte automática Shopee é descrita acima. Para ofertas manuais, `active` e `expiresAt` refletem os dados fornecidos por você.

**Shopee:** informe `SHOPEE_APP_ID` e `SHOPEE_SECRET`, obtidos com acesso aprovado à Open API. `AFFILIATE_TAG_SHOPEE` é um subId de campanha, não uma credencial de comissão. O código assina a requisição GraphQL `generateShortLink` com SHA256. Alternativamente, forneça `affiliateUrl` já gerada na sua conta. A busca de produtos e a geração de links foram validadas com o acesso configurado à API oficial.

**Mercado Livre:** forneça `affiliateUrl` gerada pela Barra/Central de Afiliados. Não basta anexar `AFFILIATE_TAG_ML` para assegurar comissão. Para conversão automática, configure um serviço HTTPS seu em `ML_CONVERTER_URL`, opcionalmente protegido por `ML_CONVERTER_TOKEN`. Contrato: POST JSON `{ "url": "URL do produto", "tag": "AFFILIATE_TAG_ML" }`, resposta `{ "affiliateUrl": "link real gerado para sua conta" }`. Esse serviço não está incluído: depende de uma integração autorizada disponível na sua conta. Sem link pronto ou serviço, a oferta ML é ignorada com erro. O bot valida domínio/protocolo, mas não consegue comprovar quem é dono do link de afiliado.

Use IDs estáveis (`shopee:shopId:itemId`, `ml:MLB...`). A URL do produto é fallback, mas URLs diferentes para o mesmo produto não são identificadas como iguais. Nunca use o link encurtado variável como ID.

## Duplicidade e recuperação

Não existe transação única entre WhatsApp e JSON. Um timeout pode acontecer depois de o WhatsApp aceitar a mensagem. Para priorizar a ausência de duplicatas, uma reserva `pending` também bloqueia novos envios durante `DEDUP_HOURS`. Isso pode suprimir uma oferta que não chegou. Não há retry imediato nem garantia de entrega exatamente uma vez; sucesso de `sendMessage` não prova leitura ou entrega ao destinatário.

Se o processo for encerrado abruptamente, confirme que nenhuma instância está rodando antes de remover `bot.lock`. Não apague `auth_info` para problemas comuns de conexão. Em logout verdadeiro, pare o processo, faça backup e mova a sessão antiga antes de vincular novamente. Faça backup do histórico junto com a sessão. Não compartilhe `.env`, QR nem credenciais.

Histórico corrompido bloqueia inicialização; restaure um backup. O leitor aceita as chaves antigas `grupo:produto` do trecho original se você copiar o histórico para a pasta. Não compartilhe esse diretório entre múltiplos servidores; para múltiplas instâncias, migre para transações SQLite/Redis e uma fila central.

Fontes de imagem e feed são entradas confiáveis do operador. Não exponha o bot como endpoint para URLs arbitrárias sem proteção de rede contra SSRF. Os intervalos controlam ritmo, mas não garantem ausência de bloqueios do WhatsApp.

## Auditoria do trecho enviado

| Requisito | Trecho original | Base entregue |
|---|---|---|
| Foto + legenda | Correto | Mantido em uma mensagem |
| Vários grupos | Parâmetro de função | Configuração validada em .env |
| Dedup por grupo | 24h fixas | TTL configurável, reservas e escrita atômica |
| Erros no grupo/imagem | Interrompem loop | Isolados por grupo/oferta |
| Histórico inválido | JSON.parse derruba | Parada segura, sem reset silencioso |
| Intervalo | 5–10s, inclusive último grupo | 5–15s entre tentativas globais |
| Cron/reconexão | Ausentes | Cron sem sobreposição e sessão persistente |
| Afiliados | Ausentes | Shopee API; ML link pronto ou adaptador externo |

## Validação e referências

`npm test` usa o test runner do Node e não precisa das dependências de integração. Testa persistência/TTL, grupos isolados, falhas de envio, reserva, erro de disco, URL de afiliado, contrato Shopee simulado, imagem inválida e formatação. Dependências instaladas e imports Baileys/cron verificados. Não houve envio real, scan de QR ou teste com credenciais de afiliado.

- Baileys: https://baileys.wiki/quickstart
- Release escolhida: https://github.com/WhiskeySockets/Baileys/releases
- Cron: https://www.nodecron.com/api-reference.html
- Shopee Explorer oficial: https://open-api.affiliate.shopee.com.br/explorer
- Mercado Livre: https://www.mercadolivre.com.br/l/comece-a-recomendar


## Espera temporária de ofertas com falha

Ofertas que falharem ao preparar o link, a legenda ou a foto ficam em espera por 30 minutos. A busca ignora esses produtos e pode selecionar outros no próximo ciclo. Ao terminar a espera, o produto volta a ser elegível; isso não garante envio imediato. Configure `FAILED_OFFER_COOLDOWN_MINUTES` no `.env` para mudar o prazo e reinicie para aplicar.

A espera é salva em `failed_deals.json`, permanece após reiniciar e é separada do histórico de envios. Falhas de disco continuam interrompendo o ciclo. Envios incertos mantêm a proteção contra duplicatas por grupo. Os testes simulam a passagem do tempo, sem esperar 30 minutos nem enviar mensagens.


## Limite de espera de envio

`SEND_TIMEOUT_SECONDS=45` limita a espera pela resposta de uma tentativa de envio. Esse valor não define o intervalo entre mensagens. Se o envio não confirmar no prazo, sua reserva permanece no histórico por `DEDUP_HOURS`, e os próximos grupos ou ciclos podem continuar. A operação remota pode concluir depois do prazo; por isso o bot não repete automaticamente a mensagem incerta. Reinicie para aplicar alterações.


## Intervalo entre buscas e envios

A busca continua a cada minuto (`CRON_INTERVAL="* * * * *"`). Cada tentativa de mensagem, inclusive a primeira em uma instalação nova, aguarda um intervalo aleatório de 10 a 15 minutos. Use `SEND_INTERVAL_MIN_MINUTES` e `SEND_INTERVAL_MAX_MINUTES` para alterar esses limites.

Se nenhuma oferta for encontrada quando o prazo terminar, o bot continua buscando sem reiniciar a espera. Quando encontra um produto elegível, usa os dados da consulta atual e tenta enviar. Ofertas encontradas antes do prazo não são enviadas; serão consultadas novamente no ciclo permitido. O horário é verificado a cada ciclo, então o envio pode ocorrer depois do limite de 15 minutos conforme o cron, conexão ou disponibilidade.

O arquivo `send_schedule.json` preserva o próximo horário após reiniciar. O intervalo é global entre tentativas, inclusive para grupos diferentes, e não garante ausência de bloqueios. Envios incertos mantêm a proteção contra duplicatas. Reinicie para aplicar o código.

### Painel local de relatórios

O bot disponibiliza um painel escuro em http://127.0.0.1:3210 enquanto estiver rodando. A página mostra produtos consultados, motivos de descarte, envios confirmados, falhas, conexão do WhatsApp e a próxima janela de envio. Os números são acumulados desde o início do registro, inclusive após reiniciar.

Para iniciar o bot com o painel: `npm.cmd start`. Para abrir apenas o painel, sem iniciar envios: `npm.cmd run dashboard`. Esse segundo comando lê o último relatório salvo e permite salvar os controles locais; dados sem atualização há mais de 30 segundos ficam sinalizados. A página atualiza a cada cinco segundos. Se o painel separado já ocupar a porta, o bot continua funcionando e atualiza o arquivo normalmente.

Configuração opcional no `.env`: `DASHBOARD_ENABLED=false` desativa o servidor integrado; `DASHBOARD_PORT=3210` define a porta. O acesso fica restrito a este computador. O relatório contém contagens e dados das ofertas, sem credenciais ou sessão do WhatsApp. Os grupos aparecem numerados.

O arquivo local `bot_report.json` guarda os totais, os últimos 60 ciclos e os últimos 200 eventos. Ele está no `.gitignore`. Envios sem confirmação ficam separados dos confirmados; confirmação de envio não significa leitura pelo destinatário.


### Melhorias da branch melhorias/controle-e-resiliencia

Nesta branch, o bot está em whatsapp-bot. Execute os comandos dentro dessa pasta.

- npm.cmd run bot:start: inicia em segundo plano, com logs em bot-output.log e bot-error.log.
- npm.cmd run bot:status: informa o processo ativo ou um lock antigo.
- npm.cmd run bot:stop: solicita encerramento ao dono do lock e aguarda até 60 segundos; nunca força o encerramento de outro processo.
- npm.cmd start: permanece disponível para execução no terminal.

Um bot.lock antigo só é recuperado após verificar duas vezes que o PID já terminou. Locks inválidos e processos ainda ativos bloqueiam a inicialização. Um bloqueio simultâneo de aquisição protege contra duas inicializações concorrentes. Se o computador interromper exatamente a aquisição e deixar bot.lock.guard, inspecione o processo antes de remover esse diretório.

O painel agora tem pausa/retomada e edição do intervalo mínimo/máximo. As buscas continuam durante a pausa; mensagens em andamento podem concluir. Os valores são salvos em bot_control.json e aplicados em até um segundo pelo bot em execução. O arquivo prevalece sobre os intervalos do .env após a primeira edição pelo painel. Alterar o intervalo reinicia a espera com o novo intervalo e nunca antecipa um prazo já salvo. Sem o bot iniciado, os controles salvam a configuração para a próxima inicialização.

O painel mostra a próxima busca agendada e até cinco ofertas elegíveis da última consulta. Os controles são locais, protegidos por verificação de origem e token por servidor. Não publique diretamente a porta na internet. A porta continua 3210; DASHBOARD_PORT permite escolher outra.

Consultas à Shopee fazem no máximo três tentativas para timeout, falhas transitórias de conexão, HTTP 408, HTTP 429 e HTTP 5xx, com esperas de um e dois segundos. Cada tentativa tem timeout de 15 segundos e nova assinatura. Falhas de credenciais, permissões, esquema ou resposta inválida não são repetidas dentro da mesma consulta. O próximo ciclo continua agendado. O limite se aplica a cada consulta/página, não ao ciclo inteiro.

O exemplo .env.example usa buscas a cada minuto, todas as categorias, desconto confirmado e zero mínimo de vendas. O intervalo entre tentativas de envio permanece de 10 a 15 minutos. Credenciais, sessão, controles e históricos ficam fora do Git.

Validação: três testes por melhoria (12 novos), além dos 31 testes anteriores. Todos usam simulações e relógios controlados; nenhuma mensagem real é enviada.
