# AGENTS.DM — OpenOrder LAN Connection MVP

## Objetivo

Criar um MVP isolado para validar a arquitetura de conexão LAN do projeto OpenOrder.

O objetivo NÃO é desenvolver funcionalidades de comandas, pedidos ou caixa.
O foco é exclusivamente:

* descoberta de dispositivos na rede local
* autenticação LAN
* pareamento seguro
* roles/permissões
* WebSocket autenticado
* sincronização básica
* fluxo Host/Cliente
* segurança em ambiente offline-first

---

# Conceito Arquitetural

O sistema deve funcionar totalmente:

* sem cloud
* sem servidor externo
* sem backend remoto
* sem login online
* sem dependência de internet

Toda operação ocorre apenas na rede local.

---

# Modos do Sistema

## Host

Dispositivo principal.

Responsável por:

* manter estado da sessão
* gerar tokens
* aprovar dispositivos
* autenticar conexões
* gerenciar roles
* servir API local
* manter WebSocket Server
* anunciar presença na rede

---

## Cliente

Dispositivo secundário.

Responsável por:

* descobrir hosts
* solicitar conexão
* gerar QR temporário
* receber token
* conectar websocket autenticado
* consumir API autenticada

---

# Arquitetura Geral

```text
               REDE LOCAL (LAN / WIFI)

          [ Cliente Garçom ]
                  |
          [ Cliente Caixa ]
                  |
          [ Cliente Cozinha ]
                  |
             -----------------
             |     HOST      |
             -----------------

             HTTP API
             WebSocket
             Tokens
             Pairing
             Roles
```

---

# Stack Recomendada

## Frontend

* React
* Vite
* Capacitor
* TypeScript

---

## Backend Local

* Node.js
* Fastify ou Express
* ws (WebSocket)

---

## Descoberta LAN

* bonjour
* zeroconf
* mdns

---

## QR Code

* qrcode
* html5-qrcode

---

## Segurança

* crypto.randomBytes
* Web Crypto API

---

# Estrutura do MVP

## Tela Inicial

```text
[ Abrir Loja ]
[ Conectar a um dispositivo ]
```

---

# Fluxo Host

## Abrir Loja

Quando o usuário clicar:

```text
Abrir Loja
```

O app deve:

1. iniciar servidor HTTP local
2. iniciar servidor WebSocket
3. iniciar descoberta mDNS
4. gerar sessionId
5. iniciar lista de dispositivos confiáveis
6. abrir painel de conexões

---

# Descoberta LAN

O host deve anunciar na rede:

```text
_openorder._tcp.local
```

Metadados:

```json
{
  "name": "OpenOrder Host",
  "version": "1.0.0",
  "port": 8787
}
```

---

# Fluxo Cliente

## Procurar Hosts

Quando o cliente clicar:

```text
Conectar a um dispositivo
```

O app deve:

1. procurar serviços mDNS
2. listar apenas hosts OpenOrder
3. permitir selecionar host
4. iniciar fluxo pairing

---

# Fluxo de Pairing

## Importante

O TOKEN REAL nunca deve aparecer visualmente.

QR Code NÃO é token.

QR Code é apenas uma chave temporária de pareamento.

---

# Fluxo Completo de Pairing

## 1. Cliente gera QR temporário

QR contém:

```json
{
  "deviceName": "POCO X7",
  "deviceId": "device-123",
  "callbackIp": "192.168.0.20",
  "callbackPort": 8788,
  "nonce": "random-nonce",
  "appVersion": "1.0.0"
}
```

---

## 2. Host escaneia QR

O host lê:

* IP do cliente
* callback endpoint
* nonce
* device info

---

## 3. Host solicita aprovação

Exibir:

```text
Dispositivo deseja conectar

Nome: POCO X7
Versão: 1.0.0

[ Permitir ]
[ Negar ]
```

---

## 4. Host escolhe a role

Exibir:

```text
Selecionar função:

( ) Caixa
( ) Garçom
( ) Cozinha
( ) Gerência
```

IMPORTANTE:

O cliente NUNCA escolhe a role.

A role sempre é definida pelo host.

---

## 5. Host gera token runtime

Gerar:

* token aleatório
* sessionId
* deviceId confiável
* role

O token deve:

* ser temporário
* ser aleatório
* nunca hardcoded
* nunca derivado de segredo fixo
* nunca exposto visualmente

Usar:

```javascript
crypto.randomBytes(32)
```

---

## 6. Host envia token diretamente ao cliente

Via HTTP callback:

```http
POST http://CLIENT_IP:8788/pair
```

Payload:

```json
{
  "token": "RANDOM_TOKEN",
  "sessionId": "SESSION_1",
  "role": "WAITER",
  "hostIp": "192.168.0.15",
  "hostPort": 8787
}
```

---

## 7. Cliente salva sessão

Salvar localmente:

* token
* role
* sessionId
* hostIp
* deviceId

---

# Segurança

## Regra principal

Toda request sem token válido deve ser recusada.

---

# API Protection

Toda rota HTTP deve exigir:

```http
Authorization: Bearer TOKEN
```

---

# WebSocket Protection

O websocket deve autenticar durante handshake.

Fluxo:

```json
{
  "deviceId": "device-123",
  "token": "TOKEN"
}
```

Sem token válido:

```text
connection.close()
```

---

# Regras de Segurança

## NÃO confiar em:

* IP
* MAC Address
* Nome do dispositivo
* Origem
* Frontend

---

## Confiar apenas em:

* token válido
* sessão válida
* device autorizado
* role autorizada

---

# Persistência Local

Host deve manter:

```json
{
  "trustedDevices": [
    {
      "deviceId": "device-123",
      "name": "POCO X7",
      "role": "WAITER",
      "tokenHash": "HASH",
      "lastSeen": "DATE"
    }
  ]
}
```

---

# IMPORTANTE

Nunca salvar token puro.

Salvar apenas:

```text
SHA256(token)
```

---

# Sessão da Loja

Quando a loja fechar:

* invalidar tokens
* encerrar websockets
* limpar sessão ativa

---

# Estrutura de Roles

## Roles iniciais

```text
ADMIN
CASHIER
WAITER
KITCHEN
```

---

# Permissões

## ADMIN

* tudo

---

## CASHIER

* caixa
* comandas
* pagamentos

---

## WAITER

* criar pedidos
* visualizar mesas

---

## KITCHEN

* visualizar fila
* atualizar status

---

# Protocolo Base

Todas mensagens websocket:

```json
{
  "type": "EVENT_NAME",
  "timestamp": 123456,
  "payload": {}
}
```

---

# Eventos Iniciais

```text
PAIR_REQUEST
PAIR_ACCEPT
PAIR_DENY
AUTH
PING
PONG
STATE_SYNC
DEVICE_CONNECTED
DEVICE_DISCONNECTED
```

---

# Estrutura de Pastas

```text
/src
  /host
  /client
  /auth
  /pairing
  /websocket
  /mdns
  /roles
  /screens
```

---

# Etapas de Desenvolvimento

# FASE 1 — Base do Projeto

## Objetivo

Criar estrutura inicial.

## Implementar

* React + Vite
* Capacitor
* Node local
* WebSocket server
* HTTP server

---

# FASE 2 — Descoberta LAN

## Objetivo

Encontrar hosts automaticamente.

## Implementar

* mDNS announcement
* busca de hosts
* lista de hosts encontrados

---

# FASE 3 — Pairing

## Objetivo

Validar fluxo de conexão.

## Implementar

* geração QR cliente
* scanner QR host
* popup aprovação
* seleção role
* callback token

---

# FASE 4 — Segurança

## Objetivo

Proteger API e websocket.

## Implementar

* bearer token
* auth middleware
* websocket auth
* token hashing
* trusted devices

---

# FASE 5 — Sessão

## Objetivo

Persistência e reconexão.

## Implementar

* reconnect automático
* invalidação sessão
* desconexão host
* restore device

---

# FASE 6 — Testes Reais

## Objetivo

Validar em rede real.

## Testar

* Android
* notebook
* WIFI lento
* hotspot
* host desligando
* reconnect
* múltiplos clientes
* websocket flood
* token inválido
* device removido

---

# Regras Arquiteturais Obrigatórias

## NÃO usar:

* cloud
* Firebase
* login externo
* segredo hardcoded
* chave fixa
* token visual permanente

---

## O frontend React NÃO é segurança

Toda validação deve existir no backend.

---

## O host é a autoridade central

Toda sincronização deve passar pelo host.

---

## Clientes são apenas consumidores/autenticados

Clientes não devem:

* gerar permissões
* promover roles
* validar autenticação
* controlar estado global

---

# Objetivo Final do MVP

Ao final do MVP deve ser possível:

1. abrir loja em um dispositivo
2. descobrir host automaticamente
3. conectar dispositivos
4. aprovar manualmente conexões
5. definir roles
6. autenticar websocket
7. proteger API
8. sincronizar estado básico
9. invalidar sessões
10. operar totalmente offline em LAN
