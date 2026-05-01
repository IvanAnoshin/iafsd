# v94 — Accessibility / Responsive Final

## Цель

Закрыть базовый слой доступности и устойчивости интерфейса перед публичными этапами: клавиатура, фокус, mobile safe-area, reduced motion, понятные dialog-семантики и быстрый автоматический чек.

## Что сделано

- Добавлен skip-link `Перейти к содержимому` на уровне root layout.
- Добавлен общий `#main-content` target для клавиатурной навигации.
- Добавлен скрытый polite live-region для будущих пользовательских статусов.
- Добавлены `.sr-only` и единые `:focus-visible` стили.
- Добавлена поддержка `prefers-reduced-motion` и пользовательского `data-reduced-motion="true"`.
- Нижняя навигация и основные панели учитывают `safe-area-inset-bottom`.
- Добавлены `100dvh` и ограничения высоты для bottom sheet / dialog на низких экранах.
- Bottom nav получил `aria-label` и `aria-current="page"` для активного раздела.
- Public trust navigation получил `aria-current="page"`.
- Notification Center получил `aria-haspopup="dialog"`, `aria-expanded`, `aria-labelledby` и фокус на кнопку закрытия при открытии.
- MinimalActionDialog получил `aria-labelledby`, `aria-describedby`, Escape-close и фокус на dialog-карту.
- Profile header menu получил `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`, `role="menuitem"`.
- Login inputs получили явные accessible names, а ошибка входа получила `role="alert"`.

## Проверка

Добавлена команда:

```bash
npm run accessibility:check
```

Скрипт проверяет наличие базовых a11y/responsive гарантий без тяжёлых зависимостей и без запуска браузера.

## Что не усложняли

- Не добавляли отдельную дизайн-систему.
- Не внедряли тяжёлый focus-trap пакет.
- Не делали массовую перепаковку компонентов.
- Не меняли визуальный стиль проекта.

## Остаточные ручные проверки

Перед публичной beta нужно руками проверить:

1. Tab-навигацию по login/register/feed/chat/settings/communities.
2. Escape-close для модалок и sheets.
3. iPhone/Android safe-area внизу экрана.
4. Поведение при открытой мобильной клавиатуре в чате.
5. Режим reduced motion на уровне ОС.
6. Узкие экраны 360–390px и низкие экраны до 680px.
