/**
 * The words of the interface (not of the docs): navigation labels, notices, the feedback prompt. English is the
 * source; the languages below are bundled; sites can override any of them with `i18n.messages` in docs.json.
 * Text with `{name}` has values put in by `format`.
 */
export const en = {
  skipToContent: 'Skip to content',
  sidebar: 'Sidebar',
  sections: 'Sections',
  openNavigation: 'Open navigation',
  closeNavigation: 'Close navigation',
  breadcrumb: 'Breadcrumb',
  onThisPage: 'On this page',
  pager: 'Previous and next pages',
  previous: 'Previous',
  next: 'Next',
  lastUpdated: 'Last updated',
  search: 'Search',
  helpful: 'Was this page helpful?',
  thanks: 'Thanks for your feedback',
  yes: 'Yes',
  no: 'No',
  version: 'Version',
  language: 'Language',
  versionOutdated:
    'You are reading the documentation for version {version}, which is not the latest.',
  versionDeprecated:
    'Version {version} is deprecated and no longer maintained.',
  versionUnreleased:
    'This is a preview of version {version}, which is not released yet.',
  goToLatest: 'Go to the latest version',
  goToLatestPage: 'Go to this page in the latest version',
  fallbackNotice:
    'This page is not available in {language} yet. It is shown in {original}.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

type Bundle = Partial<Messages>;

/** Bundled translations, by base language. */
export const translations: Record<string, Bundle> = {
  es: {
    skipToContent: 'Saltar al contenido',
    sidebar: 'Barra lateral',
    sections: 'Secciones',
    openNavigation: 'Abrir navegación',
    closeNavigation: 'Cerrar navegación',
    breadcrumb: 'Ruta de navegación',
    onThisPage: 'En esta página',
    pager: 'Páginas anterior y siguiente',
    previous: 'Anterior',
    next: 'Siguiente',
    lastUpdated: 'Última actualización',
    search: 'Buscar',
    helpful: '¿Te ha resultado útil esta página?',
    thanks: 'Gracias por tus comentarios',
    yes: 'Sí',
    no: 'No',
    version: 'Versión',
    language: 'Idioma',
    versionOutdated:
      'Estás leyendo la documentación de la versión {version}, que no es la más reciente.',
    versionDeprecated:
      'La versión {version} está obsoleta y ya no recibe mantenimiento.',
    versionUnreleased:
      'Esta es una vista previa de la versión {version}, que aún no se ha publicado.',
    goToLatest: 'Ir a la última versión',
    goToLatestPage: 'Ir a esta página en la última versión',
    fallbackNotice:
      'Esta página aún no está disponible en {language}. Se muestra en {original}.',
  },
  fr: {
    skipToContent: 'Aller au contenu',
    sidebar: 'Barre latérale',
    sections: 'Sections',
    openNavigation: 'Ouvrir la navigation',
    closeNavigation: 'Fermer la navigation',
    breadcrumb: "Fil d'Ariane",
    onThisPage: 'Sur cette page',
    pager: 'Pages précédente et suivante',
    previous: 'Précédent',
    next: 'Suivant',
    lastUpdated: 'Dernière mise à jour',
    search: 'Rechercher',
    helpful: 'Cette page vous a-t-elle été utile ?',
    thanks: 'Merci pour votre retour',
    yes: 'Oui',
    no: 'Non',
    version: 'Version',
    language: 'Langue',
    versionOutdated:
      'Vous lisez la documentation de la version {version}, qui n’est pas la plus récente.',
    versionDeprecated:
      'La version {version} est obsolète et n’est plus maintenue.',
    versionUnreleased:
      'Ceci est un aperçu de la version {version}, qui n’est pas encore publiée.',
    goToLatest: 'Aller à la dernière version',
    goToLatestPage: 'Aller à cette page dans la dernière version',
    fallbackNotice:
      'Cette page n’est pas encore disponible en {language}. Elle est affichée en {original}.',
  },
  de: {
    skipToContent: 'Zum Inhalt springen',
    sidebar: 'Seitenleiste',
    sections: 'Bereiche',
    openNavigation: 'Navigation öffnen',
    closeNavigation: 'Navigation schließen',
    breadcrumb: 'Brotkrumennavigation',
    onThisPage: 'Auf dieser Seite',
    pager: 'Vorherige und nächste Seite',
    previous: 'Zurück',
    next: 'Weiter',
    lastUpdated: 'Zuletzt aktualisiert',
    search: 'Suchen',
    helpful: 'War diese Seite hilfreich?',
    thanks: 'Danke für Ihr Feedback',
    yes: 'Ja',
    no: 'Nein',
    version: 'Version',
    language: 'Sprache',
    versionOutdated:
      'Sie lesen die Dokumentation für Version {version}, die nicht die neueste ist.',
    versionDeprecated:
      'Version {version} ist veraltet und wird nicht mehr gepflegt.',
    versionUnreleased:
      'Dies ist eine Vorschau auf Version {version}, die noch nicht veröffentlicht ist.',
    goToLatest: 'Zur neuesten Version',
    goToLatestPage: 'Diese Seite in der neuesten Version öffnen',
    fallbackNotice:
      'Diese Seite ist noch nicht auf {language} verfügbar. Sie wird auf {original} angezeigt.',
  },
  pt: {
    skipToContent: 'Ir para o conteúdo',
    sidebar: 'Barra lateral',
    sections: 'Seções',
    openNavigation: 'Abrir navegação',
    closeNavigation: 'Fechar navegação',
    breadcrumb: 'Caminho de navegação',
    onThisPage: 'Nesta página',
    pager: 'Páginas anterior e seguinte',
    previous: 'Anterior',
    next: 'Próxima',
    lastUpdated: 'Última atualização',
    search: 'Pesquisar',
    helpful: 'Esta página foi útil?',
    thanks: 'Obrigado pelo seu feedback',
    yes: 'Sim',
    no: 'Não',
    version: 'Versão',
    language: 'Idioma',
    versionOutdated:
      'Você está lendo a documentação da versão {version}, que não é a mais recente.',
    versionDeprecated:
      'A versão {version} está obsoleta e não recebe mais manutenção.',
    versionUnreleased:
      'Esta é uma prévia da versão {version}, que ainda não foi lançada.',
    goToLatest: 'Ir para a versão mais recente',
    goToLatestPage: 'Ir para esta página na versão mais recente',
    fallbackNotice:
      'Esta página ainda não está disponível em {language}. Ela é exibida em {original}.',
  },
  ja: {
    skipToContent: 'コンテンツへスキップ',
    sidebar: 'サイドバー',
    sections: 'セクション',
    openNavigation: 'ナビゲーションを開く',
    closeNavigation: 'ナビゲーションを閉じる',
    breadcrumb: 'パンくずリスト',
    onThisPage: 'このページの内容',
    pager: '前後のページ',
    previous: '前へ',
    next: '次へ',
    lastUpdated: '最終更新',
    search: '検索',
    helpful: 'このページは役に立ちましたか？',
    thanks: 'フィードバックありがとうございます',
    yes: 'はい',
    no: 'いいえ',
    version: 'バージョン',
    language: '言語',
    versionOutdated:
      'バージョン {version} のドキュメントを表示しています。最新版ではありません。',
    versionDeprecated:
      'バージョン {version} は非推奨で、メンテナンスされていません。',
    versionUnreleased:
      'これは未リリースのバージョン {version} のプレビューです。',
    goToLatest: '最新バージョンへ',
    goToLatestPage: '最新バージョンのこのページへ',
    fallbackNotice:
      'このページはまだ{language}では利用できません。{original}で表示しています。',
  },
  zh: {
    skipToContent: '跳到内容',
    sidebar: '侧边栏',
    sections: '栏目',
    openNavigation: '打开导航',
    closeNavigation: '关闭导航',
    breadcrumb: '面包屑导航',
    onThisPage: '本页内容',
    pager: '上一页和下一页',
    previous: '上一页',
    next: '下一页',
    lastUpdated: '最后更新',
    search: '搜索',
    helpful: '这个页面对你有帮助吗？',
    thanks: '感谢你的反馈',
    yes: '是',
    no: '否',
    version: '版本',
    language: '语言',
    versionOutdated: '你正在阅读 {version} 版本的文档，它不是最新版本。',
    versionDeprecated: '{version} 版本已弃用，不再维护。',
    versionUnreleased: '这是尚未发布的 {version} 版本的预览。',
    goToLatest: '前往最新版本',
    goToLatestPage: '在最新版本中查看此页',
    fallbackNotice: '此页面暂无{language}版本，当前以{original}显示。',
  },
  ar: {
    skipToContent: 'تخطَّ إلى المحتوى',
    sidebar: 'الشريط الجانبي',
    sections: 'الأقسام',
    openNavigation: 'افتح التنقل',
    closeNavigation: 'أغلق التنقل',
    breadcrumb: 'مسار التنقل',
    onThisPage: 'في هذه الصفحة',
    pager: 'الصفحتان السابقة والتالية',
    previous: 'السابق',
    next: 'التالي',
    lastUpdated: 'آخر تحديث',
    search: 'بحث',
    helpful: 'هل كانت هذه الصفحة مفيدة؟',
    thanks: 'شكرًا على ملاحظاتك',
    yes: 'نعم',
    no: 'لا',
    version: 'الإصدار',
    language: 'اللغة',
    versionOutdated: 'أنت تقرأ وثائق الإصدار {version}، وهو ليس الأحدث.',
    versionDeprecated: 'الإصدار {version} متوقف ولم تعد تتم صيانته.',
    versionUnreleased: 'هذه معاينة للإصدار {version} الذي لم يصدر بعد.',
    goToLatest: 'انتقل إلى أحدث إصدار',
    goToLatestPage: 'انتقل إلى هذه الصفحة في أحدث إصدار',
    fallbackNotice:
      'هذه الصفحة غير متوفرة بعد باللغة {language}. تُعرض بلغة {original}.',
  },
};

/** Fill `{name}` placeholders. A placeholder with no value stays as written. */
export function format(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * All the messages for a language: English, then the bundled translation (`pt-BR` finds `pt-BR`, else `pt`), then the
 * site's own wording for exactly that language tag.
 */
export function messagesFor(
  locale: string | undefined,
  overrides: Record<string, Record<string, string>> = {},
): Messages {
  const out: Messages = { ...en };
  if (locale) {
    const bundle =
      translations[locale] ?? translations[locale.split('-')[0] as string];
    Object.assign(out, bundle);
    for (const [key, value] of Object.entries(overrides[locale] ?? {}))
      if (key in en && typeof value === 'string')
        out[key as MessageKey] = value;
  }
  return out;
}
