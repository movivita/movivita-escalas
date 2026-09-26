// Estrutura do banco. Criada automaticamente na primeira requisição, sem apagar dados existentes.
export const ESTRUTURA = `
-- Movivita Escalas: estrutura inicial

CREATE TABLE IF NOT EXISTS coordenadores (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuidadoras (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  celular TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  pin_provisorio BOOLEAN NOT NULL DEFAULT TRUE,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS familias (
  id SERIAL PRIMARY KEY,
  apelido TEXT NOT NULL,
  bairro TEXT NOT NULL DEFAULT '',
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS habilitacoes (
  familia_id INT NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  cuidadora_id INT NOT NULL REFERENCES cuidadoras(id) ON DELETE CASCADE,
  PRIMARY KEY (familia_id, cuidadora_id)
);

CREATE TABLE IF NOT EXISTS plantoes (
  id SERIAL PRIMARY KEY,
  familia_id INT NOT NULL REFERENCES familias(id),
  data DATE NOT NULL,
  hora SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
  duracao SMALLINT NOT NULL CHECK (duracao BETWEEN 1 AND 24),
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  valor NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN
    ('rascunho','convite','aberta','aceito','aguardando','novoaceite','cancelado','realizado','naorealizado')),
  cuidadora_id INT REFERENCES cuidadoras(id),
  prazo TIMESTAMPTZ,
  versao INT NOT NULL DEFAULT 1,
  motivo TEXT,
  lembrete_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS plantoes_data_idx ON plantoes (data);
CREATE INDEX IF NOT EXISTS plantoes_cuidadora_idx ON plantoes (cuidadora_id, inicio);
CREATE INDEX IF NOT EXISTS plantoes_familia_idx ON plantoes (familia_id, data);

-- Trilha de auditoria: nunca é apagada nem sobrescrita
CREATE TABLE IF NOT EXISTS eventos (
  id BIGSERIAL PRIMARY KEY,
  plantao_id INT NOT NULL REFERENCES plantoes(id),
  em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  autor_tipo TEXT NOT NULL,
  autor_id INT,
  autor_nome TEXT NOT NULL,
  acao TEXT NOT NULL,
  texto TEXT NOT NULL,
  dados JSONB
);
CREATE INDEX IF NOT EXISTS eventos_plantao_idx ON eventos (plantao_id, em);

CREATE TABLE IF NOT EXISTS ofertas_dispensadas (
  plantao_id INT NOT NULL REFERENCES plantoes(id) ON DELETE CASCADE,
  cuidadora_id INT NOT NULL REFERENCES cuidadoras(id) ON DELETE CASCADE,
  em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plantao_id, cuidadora_id)
);

CREATE TABLE IF NOT EXISTS imprevistos (
  id SERIAL PRIMARY KEY,
  plantao_id INT NOT NULL REFERENCES plantoes(id),
  cuidadora_id INT NOT NULL REFERENCES cuidadoras(id),
  em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  horas_antes INT NOT NULL,
  relato TEXT
);

CREATE TABLE IF NOT EXISTS indisponibilidades (
  cuidadora_id INT NOT NULL REFERENCES cuidadoras(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  turno TEXT NOT NULL CHECK (turno IN ('dia','noite')),
  em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cuidadora_id, data, turno)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('coord','cuid')),
  usuario_id INT NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessoes_usuario_idx ON sessoes (tipo, usuario_id);

CREATE TABLE IF NOT EXISTS tentativas (
  chave TEXT PRIMARY KEY,
  falhas INT NOT NULL DEFAULT 0,
  bloqueado_ate TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS acessos (
  id BIGSERIAL PRIMARY KEY,
  em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo TEXT NOT NULL,
  usuario_id INT,
  acao TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS periodos_fechados (
  inicio DATE PRIMARY KEY,
  fim DATE NOT NULL,
  fechado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fechado_por TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_inscricoes (
  endpoint TEXT PRIMARY KEY,
  cuidadora_id INT NOT NULL REFERENCES cuidadoras(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT INTO config (chave, valor) VALUES
  ('descanso_min_h', '11'),
  ('mostrar_valor', 'sim'),
  ('prazo_padrao_h', '48'),
  ('voluntariedade_versao', 'v1')
ON CONFLICT (chave) DO NOTHING;
`;
