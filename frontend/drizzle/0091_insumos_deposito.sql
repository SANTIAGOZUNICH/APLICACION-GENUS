-- genus:reconcile-safe
-- Migración 0091 — INSUMOS: el sector DEPÓSITO también registra retiros. Siembra sus dos responsables (BETO y LEO). ADITIVA / IDEMPOTENTE.
INSERT INTO "insumo_responsables" ("id", "sector", "name", "sort_order") VALUES ('deposito-beto', 'DEPOSITO', 'BETO', 1), ('deposito-leo', 'DEPOSITO', 'LEO', 2) ON CONFLICT DO NOTHING;
