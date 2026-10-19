-- Local development only: database and login for Keycloak's own data.
SELECT 'CREATE ROLE keycloak LOGIN PASSWORD ''keycloak'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keycloak') \gexec
SELECT 'CREATE DATABASE keycloak OWNER keycloak'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'keycloak') \gexec
