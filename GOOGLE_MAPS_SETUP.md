# Configuração do Google Maps API - Mapzer

## 📋 Pré-requisitos

1. Uma conta Google (gratuita)
2. Um projeto no Google Cloud Console
3. Google Maps JavaScript API habilitada

## 🚀 Passo a Passo

### 1. Criar um Projeto no Google Cloud Console

1. Acesse: [Google Cloud Console](https://console.cloud.google.com/)
2. Clique em **"Selecionar um projeto"** → **"Novo projeto"**
3. Digite o nome: `Mapzer` (ou outro nome desejado)
4. Clique em **"Criar"**

### 2. Habilitar Google Maps JavaScript API

1. No Cloud Console, acesse **APIs e Serviços**
2. Clique em **"Ativar APIs e Serviços"**
3. Pesquise por **"Maps JavaScript API"**
4. Clique no resultado e escolha **"Ativar"**

### 3. Criar uma Chave de API

1. No Cloud Console, acesse **APIs e Serviços** → **Credenciais**
2. Clique em **"+ Criar Credenciais"** → **"Chave de API"**
3. Uma chave será gerada automaticamente
4. **Copie esta chave** (você precisará dela)

### 4. Restringir a Chave de API (Recomendado)

Para evitar uso indevido, restrinja sua chave:

1. Clique na chave de API criada
2. Em **"Restrições de aplicação"**:
   - Selecione **"Aplicações HTTP (websites)"**
   - Adicione seus domínios (ex: `seudominio.com`, `localhost`)
3. Em **"Restrições de API"**:
   - Selecione **"Restringir a chaves específicas de API"**
   - Escolha apenas **"Maps JavaScript API"**
4. Clique em **"Salvar"**

## 📝 Integração no Projeto

### Substitua a Chave de API

No arquivo `index.html`, localize esta linha (aproximadamente linha 12):

```html
<script async defer src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY_HERE"></script>
```

Substitua `YOUR_API_KEY_HERE` pela sua chave de API:

```html
<script async defer src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></script>
```

## 🎨 Personalização

O arquivo `js/google-maps.js` contém funções para personalizar o mapa:

- **Estilos**: Edite `getGoogleMapStyles()` para alterar cores e aparência
- **Cores de geometrias**:
  - Linhas: `strokeColor: '#f59e0b'` (amarelo)
  - Polígonos: `fillColor: '#10b981'` (verde)
- **Opacidade**: Altere `strokeOpacity` e `fillOpacity`

## 🔐 Segurança

⚠️ **IMPORTANTE**: Não compartilhe sua chave de API publicamente!

Se você está versionando no GitHub:

1. Crie um arquivo `.env` local (não commitado):
   ```
   GOOGLE_MAPS_API_KEY=AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

2. Use um build process (webpack, vite, etc) para injetar a chave em tempo de build

3. Ou use um arquivo `config.js` que não é versionado:
   ```javascript
   window.GOOGLE_MAPS_API_KEY = 'sua_chave_aqui';
   ```

## 💰 Cobrança

O Google Maps oferece:

- **Teste gratuito**: $300/mês em créditos
- **Uso após crédito**: A partir de $0.007 por requisição (varia por tipo)

Para monitorar custos:

1. Acesse **Faturamento** no Cloud Console
2. Configure um orçamento máximo
3. Ative alertas para notificações

## ✅ Verificar se está funcionando

1. Abra o projeto em um navegador
2. Carregue um arquivo KML/KMZ
3. Na aba de pré-visualização, clique em **"🗺️ Google Maps"**
4. O mapa com Google Maps deve aparecer com as geometrias renderizadas

## 🆘 Troubleshooting

### Erro: "Google Maps API não carregada"

- Verifique se a chave está correta no HTML
- Verifique se a API está habilitada no Cloud Console
- Aguarde 2-3 minutos para as mudanças sincronizarem

### Erro 403: InvalidAuthenticator Key

- A chave é inválida ou expirou
- Gere uma nova chave no Cloud Console

### Erro: Sem permissão de usar o mapa

- Seu domínio não está na lista de restrições
- Adicione o domínio nas configurações da chave

## 📚 Recursos

- [Google Maps JavaScript API Docs](https://developers.google.com/maps/documentation/javascript)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Guia de Chaves de API](https://developers.google.com/maps/gmp-get-started)
