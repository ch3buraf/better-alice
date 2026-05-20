export const VERSION_HISTORY = [
  {
    version: "0.1.0",
    date: "2026-05-19",
    title: "Better Alice — первый релиз",
    features: [
      {
        type: "platform",
        title: "Поддержка Алисы и Алисы Про",
        description: "Расширение работает на <code>alice.yandex.ru</code> (WebSocket / Vins-протокол) и <code>alicepro.yandex.ru</code> (SvelteKit form action)."
      },
      {
        type: "feature",
        title: "Системные промпты + Память + Навыки",
        description: "Префикс-инжекция перед каждым user-сообщением. Память умеет always/called, навыки и персонажи переключаются radio-выбором."
      },
      {
        type: "organization",
        title: "Проекты с RAG",
        description: "Прикрепляйте файлы к проекту, активируйте локальный TF-IDF RAG чтобы только релевантные чанки попадали в контекст."
      },
      {
        type: "export",
        title: "Экспорт сессий",
        description: "Markdown, PDF, HTML, картинки. Алисины ART-картинки сохраняются как ссылки в markdown."
      },
      {
        type: "feature",
        title: "ART image enhancer",
        description: "На сгенерированных Алисой картинках появляется overlay со скачиванием/копированием URL/открытием в новой вкладке."
      },
      {
        type: "feature",
        title: "Поиск по чатам в сайдбаре",
        description: "Фильтр по названию + тегам #tag. Работает в сайдбаре Алисы (data-testid) и Алисы Про."
      }
    ]
  }
];

export const LATEST_VERSION = VERSION_HISTORY[0];
