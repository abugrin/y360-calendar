# y360-calendar

Веб-приложение для просмотра календаря Яндекс 360 по email пользователя (недельный вид Пн–Пт).

## Требования

- Node.js 18+
- Сервисное OAuth-приложение Яндекс 360 с правами Calendar API и механизмом token exchange по email
- Для работы приложения достаточно scope **`calendar:events.read`** (просмотр событий и участников). Альтернатива — **`calendar:read_all`**, если нужен доступ ко всем данным Календаря

## Установка Node.js

Проверьте, установлен ли Node.js:

```bash
node -v
npm -v
```

Если команды не найдены, установите Node.js одним из способов:

**macOS (Homebrew):**

```bash
brew install node
```

**Linux (NodeSource, пример для Ubuntu/Debian):**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows:** скачайте LTS-установщик с [nodejs.org](https://nodejs.org/) и установите его.

**Через nvm (macOS / Linux):**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20
```

## Настройка сервисного приложения

Приложению нужны `YANDEX_CLIENT_ID` и `YANDEX_CLIENT_SECRET` **сервисного** OAuth-приложения организации.

Подробная инструкция: [Сервисные приложения — Яндекс 360 для бизнеса](https://yandex.ru/support/yandex-360/business/admin/ru/security-service-applications)

Кратко:

1. Войдите в аккаунт **владельца организации** Яндекс 360.
2. Создайте OAuth-приложение на [oauth.yandex.ru](https://oauth.yandex.ru):
   - платформа: **Веб-сервисы**;
   - в **Доступ к данным** укажите scope для Calendar API (см. таблицу ниже);
   - сохраните **ClientID** и **Client secret**.
3. Активируйте сервисные приложения в организации и **зарегистрируйте** созданное OAuth-приложение как сервисное через API 360 (`POST .../service_applications`). При регистрации укажите те же scope, что и в OAuth-приложении.
4. Убедитесь, что для `client_id` вашего приложения у ТАМа открыт доступ к **Calendar Public API** (см. [`doc/calendar_api_ru (3).md`](doc/calendar_api_ru%20(3).md)).

### Scope Calendar API

| Scope | Назначение |
|-------|------------|
| `calendar:read_all` | Просмотр любых данных в Календаре |
| `calendar:write_all` | Изменение любых данных в Календаре |
| `calendar:events.read` | Просмотр событий в Календаре |
| `calendar:events.write` | Создание, изменение и удаление событий в Календаре |
| `calendar:calendars.read` | Просмотр списка календарей и их настроек |
| `calendar:calendars.write` | Создание, изменение и удаление календарей, управление доступом к ним |
| `calendar:free_busy.read` | Просмотр занятости пользователей и переговорок в Календаре |
| `calendar:resources.read` | Просмотр доступных офисов и переговорок организации в Календаре |
| `calendar:my_settings.read` | Просмотр пользовательских настроек Календаря |
| `calendar:my_settings.write` | Изменение пользовательских настроек Календаря |

Для **y360-calendar** (только чтение событий и участников) укажите минимум:

```
calendar:events.read
```

Если планируете расширять функциональность, можно сразу выдать более широкий scope — например `calendar:read_all`.

Приложение получает **временный OAuth-токен пользователя** (срок действия — 1 час) через token exchange по email:

```
POST https://oauth.yandex.ru/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<user_email>
subject_token_type=urn:yandex:params:oauth:token-type:email
```

## Установка проекта

```bash
git clone <repo-url>
cd y360-calendar
npm install
cp .env.example .env.local
```

Заполните `.env.local`:

```
YANDEX_CLIENT_ID=ваш_client_id
YANDEX_CLIENT_SECRET=ваш_client_secret
```

## Запуск

**Разработка:**

```bash
npm run dev
```

Приложение: http://localhost:3000

**Продакшен:**

```bash
npm run build
npm start
```

## Использование

1. Откройте приложение в браузере.
2. Введите корпоративный email пользователя Яндекс 360.
3. Нажмите «Показать» — загрузится календарь на текущую неделю (Пн–Пт).
4. Клик по событию открывает детали и список участников.

