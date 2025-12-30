-- Initialize PostgreSQL with pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create initial workspace and user for development
INSERT INTO workspaces (id, name, created_at) 
VALUES (1, 'Default Workspace', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, name, role, workspace_id, created_at)
VALUES (1, 'demo@autophile.dev', 'Demo User', 'admin', 1, NOW())
ON CONFLICT DO NOTHING;
