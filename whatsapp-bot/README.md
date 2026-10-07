# Bot automático de ofertas Shopee para WhatsApp

Busca produtos pela API oficial de afiliados da Shopee Brasil e envia foto,
legenda e link de afiliado aos grupos configurados. Este programa é separado
do painel web na raiz do repositório.

## Iniciar no Windows

Requer Node.js 22 ou superior. Abra o PowerShell nesta pasta:

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

Preencha `SHOPEE_APP_ID`, `SHOPEE_SECRET` e `GROUP_IDS` no `.env`. Para obter
os IDs dos grupos, execute `npm.cmd run groups`. Se necessário, escaneie o QR
em WhatsApp > Aparelhos conectados.

```powershell
npm.cmd start
```

Deixe o terminal aberto. Para parar, pressione Ctrl+C. Não execute uma segunda
instância na mesma pasta. O bot permanece parado até você iniciar o comando.

## Configuração padrão

| Variável | Valor | Comportamento |
|---|---|---|
| `SHOPEE_AUTO_SEARCH` | `true` | Busca automática na API |
| `SHOPEE_OFFER_MODE` | `discount-only` | Somente desconto informado pela API |
| `SHOPEE_CATEGORY_IDS` | vazio | Todas as categorias |
| `SHOPEE_MIN_SALES` | `0` | Sem mínimo de vendas |
| `CRON_INTERVAL` | `* * * * *` | Busca a cada minuto |
| `MAX_DEALS_PER_CYCLE` | `1` | Até uma oferta por ciclo |
| `RUN_ON_START` | `true` | Busca também ao conectar |
| `DEDUP_HOURS` | `24` | Evita repetir produtos por grupo durante 24 horas |
| `OFFER_HEADLINE` | texto do `.env.example` | Chamada acima do produto |

Reinicie o processo após mudar o `.env`. Para buscar a cada cinco minutos,
use `CRON_INTERVAL="*/5 * * * *"`. Um ciclo não garante envio: produtos
já enviados, inválidos ou sem desconto informado são ignorados.

A busca percorre até cinco páginas de 30 produtos por ciclo e preserva a
posição para o próximo ciclo. Quando encontra uma oferta, revisita a página
para aproveitar os demais produtos, usando o histórico para evitar repetição.

Para restringir categorias, configure `SHOPEE_CATEGORY_IDS`. Os IDs
`100535,100013,100644,100634,100635` correspondem a áudio, celulares,
informática, videogames e câmeras na API verificada. Esse filtro também
descarta alguns acessórios passivos pelo título. Para exigir cinco mil vendas,
use `SHOPEE_MIN_SALES=5000`. A quantidade de vendidos não aparece na legenda.

## Legenda e preços

A mensagem contém chamada, nome, preço, cupom quando informado e link.
Produtos com variações usam “Menor preço”. “De … por …” só aparece quando
há preço anterior informado e o preço não é uma faixa. O preço máximo de uma
variação não é tratado como preço anterior, e o desconto percentual não é
usado para inventar esse valor. A API consultada não confirma pagamento no Pix.

O desconto significa `priceDiscountRate` maior que zero e menor que 100,
informado pela Shopee. Não confirma estoque, menor preço de mercado ou
participação em ofertas relâmpago. O modo `flash-only` bloqueia os envios
até existir uma fonte verificável; veja [a verificação](docs/flash-sale-support.md).

`discount-only` usa exclusivamente os produtos consultados na API, sem ofertas
do arquivo manual. No modo `regular`, `deals.json` pode complementar a busca.
Ele começa vazio. Os dados em `deals.example.json` são placeholders.

## Validar sem enviar

```powershell
npm.cmd test
npm.cmd run check
node src/preview-shopee.js
```

A prévia consulta a API, valida a imagem e imprime a legenda sem enviar.
Os testes automatizados usam respostas simuladas e não enviam mensagens.

O comando `npm.cmd run send-csv-test -- "C:\caminho\ofertas.csv"` valida um
CSV exportado pela Shopee. `--send` envia um lote de teste em texto ao primeiro
grupo; pare o agendador antes. Esse comando não confirma preços ao vivo nem
aplica os filtros da busca automática.

## Arquivos locais e recuperação

Nunca publique `.env`, `auth_info/`, backups de sessão, logs ou
`sent_deals.json`. Eles estão excluídos pelo `.gitignore`. As credenciais
devem ser configuradas em cada instalação; não acompanham este repositório.

O arquivo `bot.lock` impede duas instâncias na mesma pasta. Se o processo
encerrar abruptamente, confirme que ele parou antes de remover esse arquivo.
Não apague a sessão ou o histórico para resolver problemas comuns de conexão.

O histórico reserva o envio antes da chamada ao WhatsApp. Uma falha incerta
pode manter a oferta bloqueada durante `DEDUP_HOURS`, evitando duplicatas.
Sucesso na chamada de envio não confirma leitura pelo destinatário.
