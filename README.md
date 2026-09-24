# @autocrm/in-app-modal

Мультипроектный модальный компонент без зависимостей. Компонент использует Shadow DOM.

Стили каркаса редактируются в `src/styles.css`. После изменения выполните `npm run build:styles`.
Стили содержимого экранов пакет не хранит: адаптер `load` должен вернуть их в поле `styles`
вместе с остальными данными модалки.

```js
import {
    InAppModal,
    InAppPreview,
    bindInAppModalLinks,
    openInAppModalFromLocation,
} from "@autocrm/in-app-modal";

const project = "crm";
const modal = new InAppModal({
    project,
    user: {
        name: window.currentUser.fullName,
        phone: window.currentUser.phone,
        email: window.currentUser.email,
    },
    load: ({code, signal}) => fetch(`/in-app/config?modal=${encodeURIComponent(code)}`, {signal})
        .then(response => {
            if (!response.ok) throw new Error("Модальное окно недоступно");
            return response.json();
        }),
    submit: ({code, lead, idempotencyKey}) => fetch(`/in-app/lead?modal=${encodeURIComponent(code)}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(lead),
    }).then(response => {
        if (!response.ok) throw new Error("Не удалось отправить заявку");
        return response.json();
    }),
});

bindInAppModalLinks(modal, {project});
openInAppModalFromLocation(modal, {project});
```

Минимальный ответ `load`:

```js
{
    name: "Телефония",
    styles: ".h3 { font-size: 24px; }",
    screens: [{position: 1, html: '<h3 class="h3">Заголовок</h3>'}],
}
```

Inline-компонент:

```js
const preview = new InAppPreview({container: document.querySelector("#preview"), modal});
preview.update(updatedModal);
```


Компонент генерирует события `in-app-modal:open`, `loaded`, `step`, `submitted`, `error` и `close` на своём host-элементе.
