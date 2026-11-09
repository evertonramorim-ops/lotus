// SYNTHETIC_DATA — pré-carregado (--import) nos testes que executam scripts: qualquer tentativa de rede falha na hora.
globalThis.fetch = async () => { throw new Error('REDE_PROIBIDA_EM_TESTE'); };
