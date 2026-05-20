<script>
  import appState from "../state.js";

  // Каждый шаблон: title (заголовок для юзера), prompt (готовое сообщение для Алисы)
  const TEMPLATES = [
    {
      icon: "❓",
      title: "Что ты умеешь? (self-check)",
      hint: "Проверь что Алиса видит наши инструкции — она должна перечислить все bap-* форматы",
      prompt: "Перечисли через запятую все форматы кодовых блоков расширения Better Alice (bap-*), которые ты поддерживаешь. Не используй ```bap-ask. Просто список через запятую.",
    },
    {
      icon: "🎨",
      title: "Визуализация / схема",
      hint: "Алиса вернёт HTML+SVG, я отрисую интерактивный preview",
      prompt: "Нарисуй интерактивную схему: <ОПИШИ ЧТО>. Используй формат ```bap-visualizer как описано в инструкциях.",
    },
    {
      icon: "📄",
      title: "Скачиваемый файл",
      hint: "Получи файл одной кнопкой",
      prompt: "Напиши <ЧТО> и оформи в формате ```filename=имя.расширение чтобы я мог его скачать.",
    },
    {
      icon: "📊",
      title: "PowerPoint презентация",
      hint: "Скачивается готовый .pptx файл",
      prompt: "Сделай PowerPoint на тему «<ТЕМА>», <N> слайдов. Используй формат ```bap-pptx как описано в инструкциях.",
    },
    {
      icon: "📈",
      title: "Excel таблица",
      hint: "Скачивается готовый .xlsx файл",
      prompt: "Сделай Excel таблицу <КАКУЮ>. Используй формат ```bap-excel как описано в инструкциях.",
    },
    {
      icon: "📝",
      title: "Word документ",
      hint: "Скачивается готовый .docx файл",
      prompt: "Сделай Word документ <О ЧЁМ>. Используй формат ```bap-docx как описано в инструкциях.",
    },
    {
      icon: "∑",
      title: "Математическая формула",
      hint: "Длинные формулы отрендерятся через KaTeX",
      prompt: "Напиши формулу для <ЧЕГО> в LaTeX. Оформи через ```bap-latex как описано в инструкциях.",
    },
    {
      icon: "❔",
      title: "Уточняющие вопросы",
      hint: "Алиса задаст вопросы интерактивной панелью внутри поля ввода",
      prompt: "Помоги мне <ЗАДАЧА>. Сначала задай 2-3 уточняющих вопроса через формат ```bap-ask (массив объектов с id/question/type=single|multiple|input/options/allowCustom).",
    },
    {
      icon: "💾",
      title: "Запомни факт обо мне",
      hint: "Алиса сохранит факт в локальной памяти через ```bap-memory (без открытия Drawer)",
      prompt: "Запомни: <ФАКТ ОБО МНЕ>. Сохрани через формат ```bap-memory с JSON {key:..., value:..., importance:always|called}.",
    },
    {
      icon: "🎭",
      title: "Создай персонажа для RP",
      hint: "Алиса создаст и активирует персонажа через ```bap-character",
      prompt: "Создай мне персонажа для ролевой игры: <ОПИСАНИЕ>. Используй формат ```bap-character с JSON {name, usage, content}.",
    },
    {
      icon: "📦",
      title: "Многофайловый проект (.zip)",
      hint: "Архив из нескольких файлов одной кнопкой",
      prompt: "Сделай минимальный <ТИП ПРОЕКТА> (3-5 файлов). Упакуй в формате ```bap-zip с JSON {fileName, files:[{path, content}]}.",
    },
    {
      icon: "▶",
      title: "Прогони код и покажи результат",
      hint: "Код выполнится в Pyodide / JS-runtime в браузере",
      prompt: "Посчитай <ВЫРАЖЕНИЕ>. Используй формат ```bap-run-python (или bap-run-js) чтобы расширение само запустило код.",
    },
  ];

  let collapsed = $state(true);

  function findTextarea() {
    return document.querySelector("textarea#message-textarea") ||
           document.querySelector('[data-testid="inputbase-textarea"]') ||
           document.querySelector("textarea.AliceInput-Textarea") ||
           document.querySelector("textarea");
  }

  function pasteIntoChat(prompt) {
    const t = findTextarea();
    if (!t) {
      if (appState.ui) appState.ui.showToast("Не удалось найти поле ввода.");
      return;
    }
    t.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;
    if (setter) setter.call(t, prompt); else t.value = prompt;
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.dispatchEvent(new Event("change", { bubbles: true }));
    if (appState.ui) appState.ui.showToast("Шаблон вставлен — подставь свои значения и отправь.");
  }
</script>

<div class="bal-templates">
  <button class="bal-templates-toggle" type="button" onclick={() => collapsed = !collapsed}>
    <span>✨ Что я умею — шаблоны запросов</span>
    <span class="bal-chevron" class:bal-rotated={!collapsed}>▼</span>
  </button>

  {#if !collapsed}
    <div class="bal-templates-list">
      <p class="bal-templates-hint">
        Better Alice инструктирует Алису использовать специальные форматы кодовых блоков, которые я отрисовываю в виде preview/кнопки скачивания.
        Жми шаблон → готовый prompt вставится в поле ввода Алисы → подставь свои значения вместо <code>&lt;...&gt;</code> и отправь.
      </p>
      {#each TEMPLATES as t}
        <div class="bal-template-item">
          <div class="bal-template-row">
            <span class="bal-template-icon">{t.icon}</span>
            <div class="bal-template-text">
              <div class="bal-template-title">{t.title}</div>
              <div class="bal-template-hint">{t.hint}</div>
            </div>
            {#if !t.noPaste}
              <button class="bal-template-paste" type="button" onclick={() => pasteIntoChat(t.prompt)}>
                Вставить
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bal-templates {
    margin-top: 12px;
    border-top: 1px solid var(--bap-border, #444);
    padding-top: 10px;
  }
  .bal-templates-toggle {
    width: 100%;
    background: transparent;
    border: 0;
    padding: 6px 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: inherit;
  }
  .bal-templates-toggle:hover { opacity: 0.8; }
  .bal-chevron { transition: transform 150ms ease; }
  .bal-rotated { transform: rotate(180deg); }
  .bal-templates-hint {
    font-size: 11px;
    opacity: 0.65;
    margin: 6px 0 10px;
    line-height: 1.4;
  }
  .bal-templates-hint code {
    background: rgba(128, 128, 128, 0.15);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .bal-template-item {
    margin: 4px 0;
  }
  .bal-template-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    background: rgba(128, 128, 128, 0.08);
  }
  .bal-template-icon { font-size: 18px; }
  .bal-template-text { flex: 1; min-width: 0; }
  .bal-template-title { font-size: 12px; font-weight: 600; }
  .bal-template-hint { font-size: 10px; opacity: 0.6; margin-top: 1px; }
  .bal-template-paste {
    background: var(--bap-primary, #4d6bfe);
    color: white;
    border: 0;
    border-radius: 3px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }
  .bal-template-paste:hover { opacity: 0.9; }
</style>
