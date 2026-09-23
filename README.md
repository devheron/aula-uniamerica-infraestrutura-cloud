# Todo - Observabilidade

Continuidade do projeto de infraestrutura em nuvem da aplicação de tarefas. A aplicação roda no Google Cloud, com frontend e API em serviços Cloud Run, acesso pelos domínios próprios via balanceador HTTPS e dados no MongoDB Atlas. Nesta entrega acrescentamos logs estruturados no backend, métricas, verificações de disponibilidade e o dashboard **Todo - Observabilidade**. O painel ajuda a responder se os domínios estão acessíveis, quais operações são usadas, quanto demoram e quando falham.

Projeto Google Cloud: `projeto-mensal-cloud`. Integrantes: Heron Felipe e Jihad Ghozayel. Frontend: [todo.projetomensal.com.br](https://todo.projetomensal.com.br). API: [api.todo.projetomensal.com.br](https://api.todo.projetomensal.com.br/todos). [Dashboard no Cloud Monitoring](https://console.cloud.google.com/monitoring/dashboards/builder/a74172e1-9242-41ed-970c-ef5da3e8b23a?project=projeto-mensal-cloud) (exige acesso ao projeto).

O caminho da aplicação e da observabilidade está no [diagrama técnico](docs/arquitetura-serverless-v2.pdf). Em resumo, o cliente resolve o domínio, chega ao balanceador HTTPS, passa pelo Cloud Armor e é encaminhado ao frontend ou à API no Cloud Run. A API acessa o MongoDB Atlas pela VPC e pelo Cloud NAT. Para a observabilidade, o backend escreve JSON no `stdout`; o Cloud Run envia esses registros automaticamente ao Cloud Logging, sem agente instalado. O Cloud Logging calcula as métricas baseadas nesses registros, e o Cloud Monitoring as exibe ao lado das métricas nativas do Cloud Run e dos Uptime Checks. Os logs detalhados continuam consultáveis no Logging. A coleta e o painel não armazenam credenciais.

O registro de uma requisição HTTP é produzido no middleware de [backend/index.js](backend/index.js), quando a resposta termina. Ele inclui `event: "http_request"`, `method`, `route`, `statusCode`, `duration_ms`, `requestId`, horário e outros campos. `duration_ms` mede o tempo dentro da aplicação; não inclui toda a viagem do usuário até a borda do Google. O mesmo backend também registra eventos `db_query` e `db_error`, mas as duas métricas personalizadas abaixo filtram somente `event="http_request"`.

Exemplo do formato emitido pelo código (valores ilustrativos):

```json
{"event":"http_request","service":"todo-backend","method":"GET","route":"/todos","statusCode":200,"duration_ms":5,"requestId":"exemplo"}
```

As seis visualizações do dashboard, na ordem em que aparecem:

| Painel | Origem e cálculo | Como lemos e o que fazemos |
| --- | --- | --- |
| **Latência do backend por rota - p50, p95 e p99** | Métrica de distribuição `logging.googleapis.com/user/todo_http_request_duration_ms`, extraída de `jsonPayload.duration_ms` dos logs JSON do `todo-backend`. Três consultas usam percentis 50, 95 e 99, agrupados por `route`. | p50 é o tempo típico; p95 e p99 mostram a cauda lenta. Se só o p99 sobe, investigamos requisições isoladas; se os três sobem, investigamos a rota, o banco e a instância. O valor vem do backend, embora a série seja criada pelo Google a partir do log. |
| **Contagem requisições HTTP do backend por rota, método e logs JSON** | Painel de **registros**, não de métricas: consulta `cloud_run_revision` do serviço `todo-backend` com `jsonPayload.event="http_request"`. Cada linha é uma requisição. | Expandimos um registro para ver método, rota, código, duração e `requestId`. Serve para explicar um ponto anômalo nos gráficos. Não há cálculo de taxa neste painel. |
| **Requisições por rota e método** | Métrica contadora `logging.googleapis.com/user/todo_http_requests_total`, criada a partir dos mesmos logs JSON. Agrupamento por rótulos `route` e `method`; o gráfico mostra a **taxa por segundo** após alinhar e somar as contagens no intervalo. | Mostra o volume de cada operação ao longo do tempo. **Não é repetição do primeiro gráfico:** ambos usam o mesmo tipo de registro, mas o primeiro mede *quanto tempo* cada requisição levou, e este mede *quantas* ocorreram. |
| **Quantidade de requisições por código HTTP** | Métrica **nativa** `run.googleapis.com/request_count` do Cloud Run, filtrada para `todo-backend`, agrupada por `response_code` e exibida em requisições/segundo. Não usa o JSON da aplicação. | Separa respostas como 200, 201, 400, 404 e 500. 200 é a leitura bem-sucedida; 201, criação; no código atual, `DELETE /todos/:id` retorna **200**, não 204. 404 indica recurso ou rota não encontrada; 500 pede investigação no backend. |
| **Disponibilidade pelo domínio** | Dois Uptime Checks HTTPS do Cloud Monitoring fazem GET em `todo.projetomensal.com.br/` e `api.todo.projetomensal.com.br/todos`. O gráfico usa `monitoring.googleapis.com/uptime_check/check_passed`: fração de verificações bem-sucedidas, agrupada por `host` e média entre localidades. As verificações foram configuradas para intervalo de 1 minuto. | 100% indica que os verificadores obtiveram resposta HTTP válida naquele intervalo; queda só no frontend aponta para sua rota/serviço; queda na API pede verificação do backend e dependências. É uma checagem externa feita pelo Google, não pelo código da aplicação. Não garante que todo o JavaScript do frontend funciona. |
| **Erros do backend - requisições por classe (esq.) e taxa de 5xx (dir.)** | A mesma métrica **nativa** `run.googleapis.com/request_count`. À esquerda, taxa de requisições/segundo agrupada por `response_code_class` (2xx, 4xx, 5xx). À direita, `taxa de 5xx = requisições 5xx / todas as requisições` no mesmo intervalo; 0,05 equivale a 5%. | É o painel que mostra a *parcela* do tráfego que falha. 4xx sugere chamada inválida ou rota ausente; 5xx sugere falha do serviço. A linha de 5% é um limiar de atenção adotado pela equipe, não um padrão universal. A contagem por código do painel anterior dá o detalhe exato; aqui vemos classes e proporção. |

O recorte usado na demonstração é **Última hora**, no fuso exibido pelo navegador (BRT/UTC-3 nas capturas). As consultas de séries usam alinhamento mínimo de aproximadamente 60 segundos; por isso o eixo `0,1/s` significa, por exemplo, cerca de seis requisições por minuto naquele ponto, **não** 0,1 requisição no total. Ao ampliar a janela, o Monitoring pode aumentar automaticamente o período de agregação. Para comparar painéis, selecionamos o mesmo intervalo em todos. Logs são gravados com horário UTC e exibidos convertidos pelo console.

As métricas personalizadas foram configuradas em **Cloud Logging > Métricas com base em registros**:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="todo-backend"
jsonPayload.event="http_request"
```

`todo_http_requests_total` é do tipo **Counter**, com rótulos `route <- jsonPayload.route` e `method <- jsonPayload.method`. `todo_http_request_duration_ms` é do tipo **Distribution**, extrai o valor numérico de `jsonPayload.duration_ms` e usa o rótulo `route` (a configuração registrada também inclui `method`). O campo no log está em milissegundos; a métrica foi criada com unidade `1`, então a unidade **não foi declarada como `ms` no descritor**. Interpretamos os valores como milissegundos por causa do campo de origem e recomendamos corrigir o rótulo/unidade numa eventual recriação da métrica. Métricas baseadas em logs não recalculam registros anteriores à sua criação.

A configuração de coleta não exige agente: `console.log(JSON.stringify(log))` escreve uma linha JSON por resposta; o Cloud Run a encaminha ao Cloud Logging e seus campos ficam em `jsonPayload`. Os registros foram documentados no bucket `_Default`, com retenção de 30 dias (confirmar a configuração atual antes da apresentação). O painel de logs os lê diretamente. As séries derivadas vão para o Cloud Monitoring. As métricas nativas de requisições são geradas pela plataforma mesmo sem a instrumentação JSON; os Uptime Checks também são executados pelo próprio Google. Nos papéis de acesso, a leitura do dashboard e dos logs requer permissões do projeto (por exemplo, `roles/monitoring.viewer` e `roles/logging.viewer`); não há painel público.

Para reproduzir a consulta do painel de registros no Explorador de registros:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="todo-backend"
jsonPayload.event="http_request"
```

No Monitoring, selecione `logging/user/todo_http_request_duration_ms` e crie três consultas sobre a mesma métrica, com p50, p95 e p99 por `route`. Para o volume, selecione `logging/user/todo_http_requests_total`, agregação **Soma** por `route` e `method`. Para os painéis nativos, selecione **Cloud Run Revision > Request Count**, filtre `service_name=todo-backend` e agrupe por `response_code` ou `response_code_class`; para a taxa de 5xx, divida a série filtrada para a classe 5xx pela série de todas as classes. No painel de uptime, selecione **Uptime Check > Check passed**, agrupe por `host` e visualize a fração de verificações aprovadas. Os painéis baseados em contagem usam taxa por segundo na visualização atual.

Para produzir uma janela recente de dados **sem derrubar serviços**, execute no PowerShell. O primeiro bloco faz 90 leituras ao longo de cerca de 1 minuto e meio. Confirme antes que a API responde 200 e que o domínio aponta para o ambiente do grupo.

```powershell
$api = 'https://api.todo.projetomensal.com.br'
1..90 | ForEach-Object {
  Invoke-RestMethod -Method Get -Uri "$api/todos" | Out-Null
  Start-Sleep -Seconds 1
}
```

Para gerar também POST, PATCH e DELETE, criando e removendo **somente tarefas temporárias deste teste**:

```powershell
1..8 | ForEach-Object {
  $todo = $null
  try {
    $body = @{ text = "demo-observabilidade-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$_" } | ConvertTo-Json -Compress
    $todo = Invoke-RestMethod -Method Post -Uri "$api/todos" -ContentType 'application/json' -Body $body
    Invoke-RestMethod -Method Patch -Uri "$api/todos/$($todo._id)" | Out-Null
  }
  finally {
    if ($null -ne $todo -and $todo._id) {
      Invoke-RestMethod -Method Delete -Uri "$api/todos/$($todo._id)" | Out-Null
    }
  }
  Start-Sleep -Seconds 2
}
```

Opcionalmente, **uma** chamada a uma rota inexistente gera um 404 controlado. Ela pode ser bloqueada antes do contêiner; nesse caso, não aparecerá nas métricas nativas do Cloud Run desse serviço.

```powershell
curl.exe -i "$api/rota-inexistente"
```

Depois, selecione **Última hora** no dashboard e aguarde alguns minutos para a ingestão. A atualização não é instantânea. Se os logs aparecerem mas os gráficos de latência/volume continuarem vazios, confira o filtro das métricas, o serviço, a extração dos campos e se os registros foram gerados **depois** da criação das métricas. Se o uptime ficar sem pontos, confira a configuração dos Uptime Checks; tráfego manual não o substitui. Não provoque erro 500 nem desligue a aplicação só para preencher o gráfico de falhas. Uma taxa 5xx vazia com tráfego 2xx é um resultado normal; sem tráfego, a taxa é indefinida, não zero.

As verificações da API em `/todos` geram tráfego real de GET e entram também nos gráficos de latência, volume e códigos. Por isso a linha de GET pode existir mesmo sem usuários. O `route` nativo das métricas de latência do Cloud Run aparece vazio neste ambiente; o agrupamento por rota foi obtido dos rótulos da métrica baseada em logs. No código atual, `route` vem de `req.originalUrl`: caminhos com IDs e parâmetros diferentes podem virar séries separadas; não é ainda uma rota normalizada como `/todos/:id`. Métricas do Cloud Run só enxergam requisições que chegam ao contêiner; bloqueios no balanceador/Cloud Armor exigem consulta aos logs da borda e podem aparecer indiretamente no uptime.

Capturas dos testes: [latência](docs/evidencias/01-latencia.png), [registros HTTP](docs/evidencias/02-logs-http.png), [rota e método](docs/evidencias/03-requisicoes-rota-metodo.png), [códigos HTTP](docs/evidencias/04-codigos-http.png), [disponibilidade](docs/evidencias/05-disponibilidade.png) e [erros/5xx](docs/evidencias/06-erros-5xx.png). A [fundamentação completa](docs/2.7-fundamentacao-paineis-final.docx) detalha pergunta, cálculo, interpretação, limites, ação e teste de cada painel; o [guia visual](docs/guia-visual-observabilidade-entrega-2.pdf) apoia a apresentação. Uma captura com linhas preenchidas comprova aquele intervalo, não a disponibilidade permanente. O arquivo-fonte **editável** do diagrama ainda precisa ser incluído pelo integrante responsável; o PDF sozinho não atende esse item da entrega. Antes de fechar o envio, conferir os valores atuais de retenção, configurações IAM e evidências dos testes de falha controlada.
