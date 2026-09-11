CREATE ROLE app_user LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE marketplace TO app_user;
