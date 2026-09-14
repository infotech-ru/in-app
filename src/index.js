import {STYLES} from "./styles.generated.js";

const DEFAULT_LABELS = {
    close: "Закрыть",
    back: "Назад",
    next: "Далее",
    request: "Оставить заявку",
    submit: "Отправить запрос",
    openForm: "Запросить предложение",
    submitting: "Отправляем…",
    name: "Имя",
    contact: "Телефон или e-mail",
    contactPlaceholder: "+7 900 000-00-00",
    namePlaceholder: "Как к вам обращаться",
    consent: "Нажимая кнопку, вы соглашаетесь на обработку данных для связи.",
    more: "Подробнее о возможностях ↗",
    successTitle: "Заявка отправлена",
    successText: "Мы свяжемся с вами в ближайшее время.",
    error: "Не удалось выполнить запрос. Попробуйте ещё раз.",
};

const SCREEN_SWAP_DURATION = 250;
const SCREEN_SWAP_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

function prefersReducedMotion() {
    return typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function escapeHtml(value) {
    return String(value ? value : "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function idempotencyKey() {
    if (globalThis.crypto && globalThis.crypto.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeExternalUrl(value) {
    try {
        const url = new URL(value, window.location.origin);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (error) {
        return "";
    }
}

export class InAppModal {
    constructor({load, submit, project, user = {}, labels = {}, container = document.body}) {
        if (typeof load !== "function" || typeof submit !== "function") {
            throw new TypeError("InAppModal requires load and submit functions");
        }
        this.loadAdapter = load;
        this.submitAdapter = submit;
        this.project = project;
        this.user = user;
        this.labels = Object.assign({}, DEFAULT_LABELS, labels);
        this.host = document.createElement("div");
        this.host.hidden = true;
        this.shadow = this.host.attachShadow({mode: "open"});
        container.append(this.host);
        this.modal = null;
        this.code = null;
        this.activeProject = project;
        this.screen = 0;
        this.view = "loading";
        this.error = "";
        this.returnFocus = null;
        this.abortController = null;
        this.submissionKey = null;
        this.pointerStartedOnBackdrop = false;
        this.screenAnimation = null;
        this.dialogResizeAnimation = null;
        this.dialogHeightOverride = false;
        this.onClick = event => this.handleClick(event);
        this.onPointerDown = event => {
            this.pointerStartedOnBackdrop = Boolean(
                event.target.dataset && event.target.dataset.action === "backdrop",
            );
        };
        this.onKeyDown = event => {
            if (event.key === "Escape" && !this.host.hidden) this.close();
        };
        this.shadow.addEventListener("pointerdown", this.onPointerDown);
        this.shadow.addEventListener("click", this.onClick);
        document.addEventListener("keydown", this.onKeyDown);
    }

    async open(code, options = {}) {
        this.returnFocus = document.activeElement;
        this.code = code;
        this.activeProject = options.project || this.project;
        this.modal = null;
        this.submissionKey = null;
        this.screen = 0;
        this.view = "loading";
        this.error = "";
        this.resetDialogHeight();
        this.host.hidden = false;
        this.render();
        this.emit("open", {code});

        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        try {
            const modal = await this.loadAdapter({
                code,
                project: this.activeProject,
                signal: this.abortController.signal,
            });
            if (!modal || !Array.isArray(modal.screens) || modal.screens.length === 0) {
                throw new Error("Modal has no screens");
            }
            this.modal = modal;
            this.view = "content";
            this.render();
            this.emit("loaded", {code, modal});
        } catch (error) {
            if (error.name === "AbortError") return;
            this.error = error.message || this.labels.error;
            this.view = "error";
            this.render();
            this.emit("error", {code, error});
        }
    }

    close() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.cancelScreenAnimation();
        this.cancelDialogResize();
        this.host.hidden = true;
        this.shadow.replaceChildren();
        if (this.returnFocus && typeof this.returnFocus.focus === "function") {
            this.returnFocus.focus();
        }
        this.emit("close", {code: this.code});
    }

    destroy() {
        this.close();
        this.shadow.removeEventListener("pointerdown", this.onPointerDown);
        this.shadow.removeEventListener("click", this.onClick);
        document.removeEventListener("keydown", this.onKeyDown);
        this.host.remove();
    }

    emit(name, detail) {
        this.host.dispatchEvent(new CustomEvent(`in-app-modal:${name}`, {detail, bubbles: true, composed: true}));
    }

    render() {
        const label = this.labels;
        let body;
        let header = "";

        this.cancelScreenAnimation();
        this.cancelDialogResize();

        if (this.view === "loading") {
            body = '<div class="iam-loading" aria-live="polite">Загрузка…</div>';
        } else if (this.view === "error") {
            body = `<div class="iam-error" role="alert">${escapeHtml(this.error || label.error)}</div>`;
        } else if (this.view === "success") {
            body = `<div class="iam-success"><h3>${escapeHtml(label.successTitle)}</h3><p>${escapeHtml(label.successText)}</p><button type="button" class="iam-primary" data-action="close">${escapeHtml(label.close)}</button></div>`;
        } else {
            const screen = this.modal.screens[this.screen];
            const descriptionUrl = safeExternalUrl(this.modal.descriptionUrl);
            const more = descriptionUrl
                ? `<div class="iam-more-wrap"><a class="iam-more" href="${escapeHtml(descriptionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label.more)}</a></div>`
                : "";
            const dots = this.modal.screens.map((item, index) => `<button type="button" class="iam-dot${index === this.screen ? " is-active" : ""}" data-screen="${index}" data-dot aria-label="Экран ${index + 1}"${index === this.screen ? ' aria-current="true"' : ""}></button>`).join("");
            const contact = this.user.phone || this.user.email || "";

            header = `<header class="iam-header">
                <h2 id="in-app-title">${escapeHtml(this.modal.name)}</h2>
                <button type="button" class="iam-close" data-action="close" aria-label="${escapeHtml(label.close)}">×</button>
            </header>`;
            body = `<div class="iam-stage">
                    <div class="iam-viewport" data-viewport>
                        <div class="iam-content" data-screen-panel>${screen.html}</div>
                    </div>
                    <div class="iam-navigation">
                        <div class="iam-dots">${dots}</div>
                        <div class="iam-arrows">
                            <button type="button" class="iam-arrow" data-action="back" aria-label="${escapeHtml(label.back)}"${this.screen === 0 ? " disabled" : ""}>‹</button>
                            <button type="button" class="iam-arrow" data-action="next" aria-label="${escapeHtml(label.next)}"${this.screen === this.modal.screens.length - 1 ? " disabled" : ""}>›</button>
                        </div>
                    </div>
                </div>
                <div class="iam-open-form" data-open>
                        <button type="button" class="iam-primary" data-action="openForm">${escapeHtml(label.openForm)}</button>
                </div>
                <form class="iam-lead" style="display:none;" data-lead-form>
                    <div class="iam-form-fields">
                        <label>${escapeHtml(label.name)}<input name="name" autocomplete="name" required placeholder="${escapeHtml(label.namePlaceholder)}" value="${escapeHtml(this.user.name)}"></label>
                        <label>${escapeHtml(label.contact)}<input name="contact" autocomplete="tel email" required placeholder="${escapeHtml(label.contactPlaceholder)}" value="${escapeHtml(contact)}"></label>
                    </div>
                    <div class="iam-submit-row">
                        <button type="button" class="iam-primary" data-action="submit">${escapeHtml(label.submit)}</button>
                        <span class="iam-consent">${escapeHtml(label.consent)}</span>
                    </div>
                </form>
                ${more}
`;
        }

        this.shadow.innerHTML = `<style>${STYLES}</style>
            <div class="iam-backdrop" data-action="backdrop">
                <section class="iam-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml((this.modal && this.modal.name) || label.request)}">
                    ${header}
                    ${body}
                </section>
            </div>`;

        const leadForm = this.shadow.querySelector("[data-lead-form]");
        if (leadForm) {
            leadForm.addEventListener("submit", event => {
                event.preventDefault();
                this.submit();
            });
        }
        queueMicrotask(() => {
            const focusTarget = this.shadow.querySelector("button, input, a");
            if (focusTarget) {
                focusTarget.focus();
            }
        });
    }

    cancelScreenAnimation() {
        if (!this.screenAnimation) {
            return;
        }
        this.screenAnimation.forEach(animation => animation.cancel());
        this.screenAnimation = null;
    }

    cancelDialogResize() {
        if (!this.dialogResizeAnimation) {
            return;
        }
        this.dialogResizeAnimation.cancel();
        this.dialogResizeAnimation = null;
    }

    setDialogHeight(value) {
        const dialog = this.shadow.querySelector(".iam-dialog");
        const from = dialog ? dialog.getBoundingClientRect().height : 0;
        this.host.style.setProperty("--iam-height", value);
        this.dialogHeightOverride = true;

        if (!dialog || !dialog.animate || prefersReducedMotion()) {
            return;
        }

        const to = dialog.getBoundingClientRect().height;
        if (from === to) {
            return;
        }

        this.cancelDialogResize();
        this.dialogResizeAnimation = dialog.animate(
            [{height: `${from}px`}, {height: `${to}px`}],
            {duration: SCREEN_SWAP_DURATION, easing: SCREEN_SWAP_EASING},
        );

        if (this.dialogResizeAnimation.finished && this.dialogResizeAnimation.finished.catch) {
            this.dialogResizeAnimation.finished.catch(() => {});
        }
    }

    resetDialogHeight() {
        if (!this.dialogHeightOverride) {
            return;
        }
        this.cancelDialogResize();
        this.host.style.removeProperty("--iam-height");
        this.dialogHeightOverride = false;
    }

    updateNavigation() {
        this.shadow.querySelectorAll("[data-dot]").forEach((dot, index) => {
            const isActive = index === this.screen;
            dot.classList.toggle("is-active", isActive);
            if (isActive) dot.setAttribute("aria-current", "true");
            else dot.removeAttribute("aria-current");
        });
        const back = this.shadow.querySelector('[data-action="back"]');
        if (back) {
            back.disabled = this.screen === 0;
        }
        const next = this.shadow.querySelector('[data-action="next"]');
        if (next) {
            next.disabled = this.screen >= this.modal.screens.length - 1;
        }
    }

    goToScreen(index, {silent = false} = {}) {
        if (!this.modal) {
            return;
        }
        const last = this.modal.screens.length - 1;
        const target = Math.min(last, Math.max(0, Number(index) || 0));
        if (target === this.screen) {
            return;
        }
        const direction = target > this.screen ? "forward" : "back";
        this.screen = target;
        if (!silent) {
            this.emit("step", {code: this.code, screen: this.screen, view: "content"});
        }
        this.renderScreen(direction);
    }

    renderScreen(direction = "forward") {
        const viewport = this.shadow.querySelector("[data-viewport]");
        const screen = this.modal && this.modal.screens[this.screen];
        if (!viewport || !screen) {
            return this.render();
        }

        const active = viewport.querySelector(".iam-content:not([data-leaving])");

        this.cancelScreenAnimation();
        viewport.querySelectorAll(".iam-content[data-leaving]").forEach(panel => panel.remove());

        const next = document.createElement("div");
        next.className = "iam-content";
        next.dataset.screenPanel = "";
        next.innerHTML = screen.html;
        viewport.append(next);

        this.updateNavigation();

        if (!active) {
            return;
        }

        if (!next.animate || prefersReducedMotion()) {
            active.remove();
            return;
        }

        const offset = direction === "back" ? -1 : 1;
        const hadFocus = active.contains(this.shadow.activeElement);
        active.dataset.leaving = "";
        const leaving = active.animate([
            {transform: "translateX(0)", opacity: 1},
            {transform: `translateX(${-100 * offset}%)`, opacity: 0.35},
        ], {duration: SCREEN_SWAP_DURATION, easing: SCREEN_SWAP_EASING, fill: "forwards"});
        const entering = next.animate([
            {transform: `translateX(${100 * offset}%)`, opacity: 0.35},
            {transform: "translateX(0)", opacity: 1},
        ], {duration: SCREEN_SWAP_DURATION, easing: SCREEN_SWAP_EASING});
        const animations = [leaving, entering];
        this.screenAnimation = animations;

        if (hadFocus) {
            const focusTarget = next.querySelector("button, input, a");
            if (focusTarget) {
                focusTarget.focus();
            }
        }

        Promise.all(animations.map(animation => animation.finished))
            .catch(() => {})
            .then(() => {
                if (this.screenAnimation === animations) {
                    this.screenAnimation = null;
                }
                active.remove();
            });
    }

    handleClick(event) {
        const actionTarget = event.target.closest("[data-action]");
        const dotTarget = event.target.closest("[data-dot]");
        const action = actionTarget ? actionTarget.dataset.action : undefined;
        if (action === "backdrop" && event.target.dataset.action === "backdrop") {
            const shouldClose = this.pointerStartedOnBackdrop;
            this.pointerStartedOnBackdrop = false;
            if (shouldClose) return this.close();
            return;
        }
        this.pointerStartedOnBackdrop = false;
        if (action === "openForm") {
            this.shadow.querySelector("[data-open]").style = 'display: none;';
            this.shadow.querySelector("[data-lead-form]").style = '';
            this.setDialogHeight('700px');
        }

        if (action === "close") {
            return this.close();
        }

        if (action === "back") {
            return this.goToScreen(this.screen - 1, {silent: true});
        }

        if (action === "next") {
            return this.goToScreen(this.screen + 1);
        }

        if (dotTarget) {
            return this.goToScreen(Number(dotTarget.dataset.screen));
        }

        if (action === "submit") {
            return this.submit();
        }
    }

    async submit() {
        const form = this.shadow.querySelector("[data-lead-form]");
        if (!form.reportValidity()){
            return;
        }
        const button = this.shadow.querySelector('[data-action="submit"]');
        button.disabled = true;
        button.textContent = this.labels.submitting;
        const currentError = this.shadow.querySelector(".iam-error");
        if (currentError) {
            currentError.remove();
        }
        const values = Object.fromEntries(new FormData(form));
        const contact = String(values.contact || "").trim();
        const lead = {
            name: values.name,
            phone: this.user.phone || "",
            email: this.user.email || "",
        };
        if (contact.includes("@")) {
            lead.email = contact;
        } else {
            lead.phone = contact;
        }
        try {
            await this.submitAdapter({
                code: this.code,
                project: this.activeProject,
                lead,
                idempotencyKey: this.submissionKey || (this.submissionKey = idempotencyKey()),
            });
            this.view = "success";
            this.render();
            this.emit("submitted", {code: this.code});
        } catch (error) {
            button.disabled = false;
            button.textContent = this.labels.submit;
            const message = document.createElement("p");
            message.className = "iam-error";
            message.setAttribute("role", "alert");
            message.textContent = error.message || this.labels.error;
            form.prepend(message);
            this.emit("error", {code: this.code, error});
        }
    }
}

export function bindInAppModalLinks(modal, {root = document, selector = 'a.js-in-app-modal', project} = {}) {
    const listener = event => {
        const linkElement = event.target.closest(selector);
        if (!linkElement) {
            return;
        }
        let code = undefined;
        if (linkElement.href) {
            code = (new URL(linkElement.href, window.location.href)).searchParams.get("modal");
        } else if (linkElement.dataset.code) {
            code = linkElement.dataset.code;
        }

        if (!code) {
            return;
        }

        event.preventDefault();
        modal.open(code, {project: linkElement.dataset.project || project});
    };
    root.addEventListener("click", listener);
    return () => root.removeEventListener("click", listener);
}

export function openInAppModalFromLocation(modal, {parameter = "modal", project} = {}) {
    const code = new URL(window.location.href).searchParams.get(parameter);
    if (code) {
        modal.open(code, {project});
    }
    return code;
}
