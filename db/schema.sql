-- Relational analytics schema for the Genecopoeia product signal platform.
-- The prototype uses an in-memory repository, but the API payloads map directly
-- to these tables so the app can move to PostgreSQL without changing contracts.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  product_name TEXT NOT NULL,
  catalog_number TEXT,
  rrid TEXT,
  product_type TEXT NOT NULL,
  application_area TEXT NOT NULL,
  internal_owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, catalog_number),
  UNIQUE (rrid)
);

CREATE TABLE product_synonyms (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  synonym TEXT NOT NULL,
  PRIMARY KEY (product_id, synonym)
);

CREATE TABLE product_competitor_equivalents (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  competitor_company TEXT,
  PRIMARY KEY (product_id, competitor_name)
);

CREATE TABLE institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  institution_size TEXT,
  UNIQUE (name, country)
);

CREATE TABLE evidence_records (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'publication',
    'patent',
    'trial',
    'grant',
    'protocol',
    'conference_abstract',
    'social_mention',
    'sales_record'
  )),
  source_title TEXT NOT NULL,
  source_url TEXT,
  source_id TEXT,
  source_date DATE,
  institution_id TEXT REFERENCES institutions(id),
  lab TEXT,
  country TEXT,
  snippet TEXT NOT NULL,
  context_label TEXT NOT NULL CHECK (context_label IN (
    'core_method',
    'secondary_mention',
    'comparison',
    'negative_mention',
    'unclear'
  )),
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate', 'curated', 'rejected')),
  confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_corpus_records (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  source_type TEXT NOT NULL DEFAULT 'publication',
  source_title TEXT NOT NULL,
  source_url TEXT,
  source_id TEXT,
  source_date DATE,
  authors_text TEXT,
  institution_name TEXT,
  country TEXT,
  context_label TEXT NOT NULL DEFAULT 'unclear',
  europe_pmc_sentences TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate', 'curated', 'rejected')),
  connector_id TEXT NOT NULL,
  confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  product_mention_type TEXT NOT NULL DEFAULT 'company_context',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connector_id, source_id, europe_pmc_sentences)
);

CREATE TABLE evidence_authors (
  evidence_id TEXT NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (evidence_id, author_name)
);

CREATE TABLE evidence_disease_areas (
  evidence_id TEXT NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
  disease_area TEXT NOT NULL,
  PRIMARY KEY (evidence_id, disease_area)
);

CREATE TABLE product_evidence_mentions (
  evidence_id TEXT NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  matched_text TEXT NOT NULL,
  mention_type TEXT NOT NULL CHECK (mention_type IN (
    'product_name',
    'catalog_number',
    'rrid',
    'company_name',
    'synonym',
    'fuzzy_synonym',
    'manual'
  )),
  confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  PRIMARY KEY (evidence_id, product_id, matched_text)
);

CREATE TABLE competitor_mentions (
  evidence_id TEXT NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  competitor_name TEXT NOT NULL,
  matched_text TEXT NOT NULL,
  confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  PRIMARY KEY (evidence_id, competitor_name, matched_text)
);

CREATE TABLE sales_records (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  institution_id TEXT REFERENCES institutions(id),
  account_name TEXT NOT NULL,
  country TEXT,
  order_date DATE NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  order_type TEXT NOT NULL DEFAULT 'order',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL,
  name TEXT NOT NULL,
  threshold NUMERIC(8,3),
  window_days INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE generated_alerts (
  id TEXT PRIMARY KEY,
  alert_rule_id TEXT REFERENCES alert_rules(id),
  product_id TEXT REFERENCES products(id),
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'medium', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  sales_record_ids TEXT[] NOT NULL DEFAULT '{}',
  explanation TEXT NOT NULL
);

CREATE INDEX idx_evidence_source_date ON evidence_records (source_type, source_date);
CREATE INDEX idx_company_corpus_source_date ON company_corpus_records (source_type, source_date);
CREATE INDEX idx_company_corpus_context ON company_corpus_records USING gin (to_tsvector('english', europe_pmc_sentences));
CREATE INDEX idx_evidence_country ON evidence_records (country);
CREATE INDEX idx_mentions_product ON product_evidence_mentions (product_id, evidence_id);
CREATE INDEX idx_sales_product_date ON sales_records (product_id, order_date);
CREATE INDEX idx_sales_account ON sales_records (account_name, product_id);
