-- Banco separado para os testes de integração (pnpm test:int): eles apagam os dados
-- entre um teste e outro, então nunca rodam no banco de desenvolvimento.
CREATE DATABASE api_backend_test OWNER api;
