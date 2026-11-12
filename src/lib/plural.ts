
export type Forms = readonly [one: string, few: string, many: string];

const rules = new Intl.PluralRules('ru-RU');
const nf = new Intl.NumberFormat('ru-RU');

export function plural(n: number, forms: Forms): string {
  const r = rules.select(n);
  return r === 'one' ? forms[0] : r === 'few' || r === 'other' ? forms[1] : forms[2];
}

export const count = (n: number, forms: Forms): string => `${nf.format(n).replace(/\s/g, ' ')} ${plural(n, forms)}`;

export const W = {
  key: ['ключ', 'ключа', 'ключей'],
  record: ['запись', 'записи', 'записей'],
  activeKey: ['активный ключ', 'активных ключа', 'активных ключей'],
  user: ['пользователь', 'пользователя', 'пользователей'],
  model: ['модель', 'модели', 'моделей'],
  day: ['день', 'дня', 'дней'],
  hour: ['час', 'часа', 'часов'],
  minute: ['минута', 'минуты', 'минут'],
  request: ['запрос', 'запроса', 'запросов'],
  answer: ['ответ', 'ответа', 'ответов'],
  error: ['ошибка', 'ошибки', 'ошибок'],
  run: ['запуск', 'запуска', 'запусков'],
  invite: ['приглашение', 'приглашения', 'приглашений'],
  automation: ['автоматизация', 'автоматизации', 'автоматизаций'],
  token: ['токен', 'токена', 'токенов'],
  file: ['файл', 'файла', 'файлов'],
  chat: ['чат', 'чата', 'чатов'],
  message: ['сообщение', 'сообщения', 'сообщений'],
  match: ['совпадение', 'совпадения', 'совпадений'],
  question: ['вопрос', 'вопроса', 'вопросов'],
  rating: ['оценка', 'оценки', 'оценок'],
  view: ['просмотр', 'просмотра', 'просмотров'],
  person: ['человек', 'человека', 'человек'],
} as const satisfies Record<string, Forms>;
