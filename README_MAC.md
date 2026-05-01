# Friendscape Next — запуск на Mac

## Что установить

### Node.js
```bash
brew install node
```

### PostgreSQL
```bash
brew install postgresql@17
brew services start postgresql@17
```

Проверь:
```bash
node -v
npm -v
psql --version
```

## Создать базу

```bash
createuser friendscape_app --pwprompt
createdb fsdb -O friendscape_app
createdb fsdb_shadow -O friendscape_app
```

Если роль уже есть, просто создай базы:
```bash
createdb fsdb
createdb fsdb_shadow
```

## Подготовить переменные окружения

```bash
cp .env.example .env
```

## Установить зависимости и схему

```bash
npm install
npx prisma generate
npx prisma db push
```

## Запустить проект

```bash
npm run dev
```

Обычно проект откроется на:
```text
http://localhost:3000
```
