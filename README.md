# Recorta

Editor local de áudio com seleção visual e exportação em MP3. Permite escolher vários trechos, reordená-los e uni-los em um único arquivo. Todo o processamento acontece no navegador.

## Versão online

<https://erickhoga.github.io/recorta-audio/>

## Rodar no computador

Requer Node.js 20.19 ou mais recente.

```bash
npm install
npm run dev
```

Abra o endereço mostrado no terminal (normalmente `http://127.0.0.1:5173`).

Como alternativa, execute `./iniciar.sh` dentro da pasta do projeto.

## Gerar a versão final

```bash
npm run build
npm run preview
```

O encoder LAME está incluído em `public/vendor`, por isso a edição e a exportação continuam funcionando sem internet.
