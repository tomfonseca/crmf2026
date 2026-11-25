-- Synthetic fixture only. No production records or customer columns.
CREATE TABLE gerente.fixture_metadata (
  id INT PRIMARY KEY,
  description VARCHAR(100) NOT NULL
);
INSERT INTO gerente.fixture_metadata VALUES (1, 'CRMF synthetic development fixture');
CREATE USER 'crmf_reader'@'%' IDENTIFIED BY 'crmf_local_reader_only';
GRANT SELECT ON gerente.fixture_metadata TO 'crmf_reader'@'%';
