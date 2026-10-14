CREATE ROLE app_user LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE marketplace TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
-- таблиці з'являться з міграцій від admin — дефолтні права на майбутні об'єкти
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
