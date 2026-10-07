# Ofertas relâmpago: suporte verificado em 07/10/2026

Fonte verificada: contrato GraphQL e consultas autenticadas a
https://open-api.affiliate.shopee.com.br/graphql, com Explorer oficial em
https://open-api.affiliate.shopee.com.br/explorer.

`productOfferV2` possui `priceDiscountRate`, `priceMin`, `priceMax`,
`periodStartTime` e `periodEndTime`, mas não expõe um campo que comprove
a participação do produto em ofertas relâmpago. Desconto e período de
campanha de afiliados não comprovam essa participação, preço no Pix ou estoque.

As campanhas retornadas por `shopeeOfferV2` nesta conta eram páginas de
categorias. Os feeds disponibilizados por `listItemFeeds` não eram identificados
como feeds de ofertas relâmpago. Isso não prova que outros acessos ou serviços
da Shopee nunca disponibilizem esse recurso.

A configuração local `SHOPEE_OFFER_MODE=flash-only` bloqueia as consultas de
ofertas comuns e todos os envios do agendador, inclusive a lista manual.
É um bloqueio explícito, não uma implementação concluída da busca relâmpago.
`regular` mantém o comportamento anterior, se o usuário optar por retomá-lo.

Para concluir a integração, é necessária uma fonte autorizada que informe a
participação do produto na campanha relâmpago, início/fim, preço da promoção,
estoque e, para mostrar “De … por …”, o preço anterior correspondente.
O produto deve ser revalidado antes do envio. Produtos expirados, sem estoque
ou sem confirmação da campanha não devem ter fallback para ofertas comuns.
