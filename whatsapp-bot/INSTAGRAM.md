# Instagram no dashboard existente

O módulo aparece abaixo de **Atividade** e no link **Instagram** da navegação, em `http://127.0.0.1:3210/#instagram`.

## Uso em teste

1. Abra Instagram e clique em uma data, ou em **Agendar post**.
2. Escolha horário de Brasília, produto, Feed/Story, imagem promocional ou imagem do produto e legenda.
3. **Salvar e gerar prévia** grava o agendamento e um JPEG. Não publica.
4. Clique no evento para visualizar, editar, reagendar, testar sem publicar ou cancelar.
5. Em **Modos e agendamento automático**, ative somente o agendamento automático para preencher os próximos dias. A rotina executa a cada 30 segundos enquanto o servidor estiver rodando, mesmo com a aba fechada.

Os modos manual e automático têm interruptores separados para agendamento e publicação. Por padrão: manual habilitado, automático desligado e ambas as publicações desligadas. Ausência de configuração também mantém o teste ativo. Não há botão de publicação no formulário de teste.

## Ofertas e imagens

- Lê `../data/ofertas.db` em modo **somente leitura**, sem migrações nem alterações nas ofertas.
- Lê `deals.json` e observa as ofertas encontradas pelo bot em `instagram-offers.json`. A captura falha isoladamente, sem interromper buscas/envios do WhatsApp.
- Exige link de afiliado existente. Não altera nem gera links pelos fluxos Shopee/Mercado Livre.
- Gera JPEG de Feed (1080 × 1080) ou Story (1080 × 1920). Mostra preço anterior somente quando informado/confirmado para a mesma variante; mostra desconto informado pela API ou calculado sobre esse preço anterior. Nunca usa o preço máximo de variantes como preço anterior.
- O automático agenda até um produto por dia, sem repetir produto/formato já agendado. Usa o horário configurado, por até 30 dias. Ofertas sem link de afiliado e ofertas de teste ficam de fora.
- Armazena imagem, preço e legenda como snapshot; revise preço/disponibilidade antes de habilitar publicação real. Se a oferta deixar de estar disponível, sua prévia permanece, mas será necessário selecionar uma oferta disponível para editar.

## Configuração futura da Meta

Ainda não foram fornecidos credenciais nem autorização para publicar. Não crie túneis, não exponha portas e não habilite publicação durante a configuração inicial sem aprovação explícita.

1. Tenha uma conta profissional Instagram. A publicação oficial de **Stories exige Business**; Creator fica restrito a Feed neste módulo.
2. Crie/configure seu app no [Meta for Developers](https://developers.facebook.com/) e selecione Instagram Login ou Facebook Login. Facebook Login exige o vínculo da conta Instagram com uma Página. Configure as permissões de publicação exigidas pelo fluxo escolhido e o acesso/aprovação do app para as contas atendidas.
3. Obtenha o ID da conta profissional e o access token adequado ao fluxo; confirme uma versão Graph API suportada pelo app. Os tokens têm validade e precisam de manutenção/renovação; este módulo não implementa OAuth, renovação automática nem cadastro do app.
4. Preencha apenas `whatsapp-bot/.env`, tomando como referência `.env.example`:

```dotenv
INSTAGRAM_TEST_MODE=true
INSTAGRAM_LIVE_APPROVED=false
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_API_VERSION=
INSTAGRAM_LOGIN_TYPE=facebook
INSTAGRAM_ACCOUNT_TYPE=BUSINESS
INSTAGRAM_PUBLIC_BASE_URL=
```

5. Para publicação real futura, a Meta precisa baixar o JPEG por HTTPS público. Após aprovação, configure uma origem HTTPS que encaminhe **somente** `/instagram-media/<uuid>.jpg` para este dashboard local e preencha `INSTAGRAM_PUBLIC_BASE_URL`. Não exponha `/api`, o dashboard, `.env` nem os bancos. Nenhuma hospedagem ou túnel foi criado por esta implementação.
6. A rota de mídia pública só funciona com publicação real autorizada e somente para imagens com reserva de publicação. Os demais endpoints continuam exigindo Host local; escritas exigem Origin local e token de controle. O segredo Meta só é usado no servidor, em Authorization Bearer.
7. **Somente após aprovação explícita para publicação inicial**, configure `INSTAGRAM_TEST_MODE=false` e `INSTAGRAM_LIVE_APPROVED=true`, reinicie o processo e habilite a publicação do modo desejado no painel. Posts vencidos e agendados desse modo passarão a ser processados: revise/cancele testes antes dessa mudança.

Referências oficiais: [Meta Instagram API / Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/) e [coleção oficial Meta no Postman](https://www.postman.com/meta/instagram/). O fluxo cria um container em `/media`, consulta `status_code` e publica em `/media_publish`; Stories usa `media_type=STORIES`. A legenda de Stories não é enviada como legenda de Feed; textos promocionais aparecem na imagem.

## Persistência, segurança contra repetição e recuperação

`instagram.sqlite` é separado de `ofertas.db`, `sent_deals.json`, controles e relatórios do WhatsApp. Uma reserva SQLite transacional e persistente por conta/produto/formato é gravada **antes** da primeira chamada Meta. Isso impede repetição mesmo depois de reiniciar.

Estados visíveis: `scheduled`, `published`, `failed`, `cancelled`. A tentativa também guarda container ID e media ID quando disponíveis. Após erro, timeout ou interrupção, a reserva permanece e não há repetição automática. Posts com tentativa não podem ser editados/cancelados como se estivessem pendentes. Uma mídia que não fica pronta em aproximadamente 20 segundos também fica bloqueada por precaução.

Em falha, verifique os IDs no banco e o estado da publicação diretamente na Meta. Não remova reservas nem crie uma nova publicação para contornar o bloqueio sem reconciliar o resultado. A recuperação administrativa/reconciliação é manual nesta versão; não existe promessa de entrega em caso de falha de rede.

O agendador exige o processo Node ativo. Com a máquina desligada, não executa; ao retomar com publicação habilitada, processa os posts vencidos. Mantém a imagem antiga em edições como retenção conservadora; a limpeza de mídia antiga é administrativa.

## Validação e rollback

Execute `npm test` na raiz e em `whatsapp-bot`. Os testes de Instagram usam armazenamento temporário e respostas Meta simuladas: **não publicam**.

As interações mensal/semanal, seleção de datas, salvamento, edição, reagendamento, teste, cancelamento e modos são cobertas por testes DOM sem dependências. Os JPEGs Feed/Story são verificados por dimensões/formato e a arte Feed foi inspecionada visualmente na implementa??o local. Nenhum navegador estava disponível na sessão para uma inspeção visual do calendário completo. A autenticação/permissões e a entrega real na Meta só poderão ser verificadas depois de obter credenciais e aprovação.

Os originais alterados estão em `../backups/instagram-20261012-212755/whatsapp-bot/`. Para reverter a integração, pare o processo normalmente, restaure esses arquivos e reinicie. Os arquivos de dados Instagram são separados e podem ser preservados para auditoria. Não apague reservas de publicação já usadas.

Foram adicionados apenas módulos/estilos/testes/documentação e pequenos pontos de integração em `src/dashboard-server.js`, `src/index.js` e `dashboard/index.html`. Os serviços do painel principal e seus arquivos não foram alterados.
