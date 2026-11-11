# coinplay-welcome-bot

Telegram-бот с приветствием в формате референса (TonPlay): на `/start` приходит картинка (или видео) с подписью, внутри подписи — цитата с бонусами, под сообщением три кнопки:

| Кнопка | Что делает | Цвет |
|---|---|---|
| **Play** | открывает оффер как мини-приложение внутри Telegram (через `/r`) | синяя |
| **Play on the web** | открывает оффер в браузере (через `/r`) | красная |
| **Join community!** | ссылка на ваше сообщество | серая |

Обе кнопки Play идут через собственный редирект `/r`: бот логирует клик и добавляет к ссылке Coinplay `click_id=<telegram_id>`, поэтому постбэки (reg, ftd) можно привязать к конкретному пользователю.

Стек: Node 20+, telegraf, express, SQLite (better-sqlite3). Long polling, **одна реплика**.

## Запуск на Railway

1. Загрузите репозиторий в GitHub и создайте сервис в Railway из него (или `railway up`).
2. **Settings → Networking → Generate Domain** (нужен HTTPS-домен для кнопки Play).
3. **Volumes → Add Volume**, mount path `/data` (там лежит SQLite; без volume база пропадёт при редеплое).
4. **Variables** (см. `.env.example`): минимум `BOT_TOKEN` и `COINPLAY_LINK`.
5. Текст оффера лежит в `offer/welcome.html`, обложка — `assets/welcome.png`. Видео — по желанию (`assets/welcome.mp4`, `WELCOME_VIDEO` или отправить боту с аккаунта из `ADMIN_IDS`).
6. Деплой. Health-check — `/health`.

## Что править

- `offer/welcome.html` — текст поста (HTML Telegram: `<b>`, `<i>`, `<blockquote>`). Лимит подписи к картинке/видео — 1024 символа; если длиннее, текст уйдёт отдельным сообщением.
- Обложка: `assets/welcome.png` или видео (см. `assets/README.md`).
- Кнопки: тексты и цвета меняются через `BTN_*`, ряд соцсетей — `SOCIALS=off`.

## Постбэки Coinplay

В партнёрке для каждого события укажите URL:

```
https://<ваш-домен>/postback/coinplay?click_id={click_id}&event=reg&secret=<POSTBACK_SECRET>
https://<ваш-домен>/postback/coinplay?click_id={click_id}&event=ftd&secret=<POSTBACK_SECRET>
```

`{click_id}` — макрос партнёрки (проверьте, как он называется у Coinplay). События пишутся в базу и видны в `/stats`.

## Команды админа (`ADMIN_IDS`)

- `/stats` — пользователи, клики, события постбэков, топ start-параметров.
- Отправить боту фото или видео — оно станет обложкой приветствия.

## Тесты

```
npm install
npm test
```
