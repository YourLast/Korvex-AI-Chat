import type { Dict } from '../types';

export default {
  'seat.warn': [
    'Похоже, этим аккаунтом пользуются несколько человек. В Korvex одно место — для одного человека. В первый раз мы ничего не делаем. Если повторится, на время приостановим доступ. Если мы ошиблись, напишите нам в поддержку.',
    "It looks like several people are using this account. In Korvex, one seat is for one person. This time we're not doing anything. If it happens again, we'll pause access for a while. If we got it wrong, contact support.",
    'Izgleda da ovaj nalog koristi više ljudi. U Korvexu je jedno mesto za jednu osobu. Ovaj put ništa ne preduzimamo. Ako se ponovi, privremeno ćemo obustaviti pristup. Ako smo pogrešili, pišite nam u podršku.'],
  'seat.pause24': [
    'Доступ временно приостановлен: похоже, аккаунтом пользуются несколько человек. Он вернётся сам {when}. Напишите нам в поддержку, разберёмся.',
    "Access is paused for now: it looks like several people are using this account. It will come back on its own {when}. Contact support and we'll sort it out.",
    'Pristup je privremeno obustavljen: izgleda da nalog koristi više ljudi. Vratiće se sam {when}. Pišite nam u podršku, razrešićemo.'],
  'seat.pause': [
    'Доступ временно приостановлен: похоже, аккаунтом пользуются несколько человек. Напишите нам в поддержку, разберёмся.',
    "Access is paused for now: it looks like several people are using this account. Contact support and we'll sort it out.",
    'Pristup je privremeno obustavljen: izgleda da nalog koristi više ljudi. Pišite nam u podršku, razrešićemo.'],
  'week.80': [
    'Вы использовали 80% недельного лимита. Он обновится в понедельник.',
    "You've used 80% of your weekly limit. It resets on Monday.",
    'Iskoristili ste 80% nedeljnog limita. Obnoviće se u ponedeljak.'],
  'week.soft': [
    'Недельный лимит исчерпан. Отвечать продолжим, но в часы нагрузки — после других. Если вы сталкиваетесь с лимитами, напишите нам в поддержку: в некоторых случаях мы можем бесплатно поднять лимит для вас. Обещать не можем, но посмотрим.',
    "You've reached your weekly limit. We'll keep answering, but at busy times you'll be after others. If limits get in your way, contact support: in some cases we can raise your limit for free. We can't promise, but we'll take a look.",
    'Nedeljni limit je potrošen. Nastavljamo da odgovaramo, ali u satima opterećenja — posle drugih. Ako vam limiti smetaju, pišite nam u podršku: u nekim slučajevima možemo besplatno da podignemo vaš limit. Ne možemo da obećamo, ali ćemo pogledati.'],
  'week.hard': [
    'Недельный лимит исчерпан, новые сообщения — с понедельника. Если вам нужно больше для работы, напишите нам в поддержку: в некоторых случаях мы можем бесплатно поднять лимит для вас. Обещать не можем, но посмотрим.',
    "You've used up your weekly limit. You can send new messages from Monday. If you need more for work, contact support: in some cases we can raise your limit for free. We can't promise, but we'll take a look.",
    'Nedeljni limit je potrošen, nove poruke — od ponedeljka. Ako vam treba više za posao, pišite nam u podršku: u nekim slučajevima možemo besplatno da podignemo vaš limit. Ne možemo da obećamo, ali ćemo pogledati.'],
  'support.line': [
    'Поддержка: Telegram {tg}, почта {email}',
    'Support: Telegram {tg}, email {email}',
    'Podrška: Telegram {tg}, e-pošta {email}'],
  'seat.ok': ['Понятно', 'Got it', 'Razumem'],
  'week.line': [
    'Недельный лимит исчерпан: в часы нагрузки отвечаем после других',
    'Weekly limit reached: at busy times you go after others',
    'Nedeljni limit je potrošen: u satima opterećenja odgovaramo posle drugih'],
  'week.used': [
    'На этой неделе использовано {pct}% недельного лимита',
    "This week you've used {pct}% of your weekly limit",
    'Ove nedelje iskorišćeno je {pct}% nedeljnog limita'],
  'lim.week': ['Недельный лимит', 'Weekly limit', 'Nedeljni limit'],
  'lim.used': ['Использовано {pct}%', '{pct}% used', 'Iskorišćeno {pct}%'],
  'lim.reset': ['Обновится в понедельник, {date}, в 00:00', 'Resets Monday, {date}, at 00:00', 'Obnavlja se u ponedeljak, {date}, u 00:00'],
  'lim.none': ['Без лимита', 'No limit', 'Bez limita'],
  'lim.noneSub': ['На этой неделе: {pct}% обычного лимита', 'This week: {pct}% of the standard limit', 'Ove nedelje: {pct}% uobičajenog limita'],
  'lim.about': [
    'Лимит нужен только на случай очень большой нагрузки, обычной работе он не мешает. Считаем не сообщения, а сколько вычислений ушло на ответы: длинные документы и долгие задачи весят больше.',
    "The limit is only there for very heavy use and doesn't get in the way of normal work. We count how much computing your answers took, not messages: long documents and long tasks weigh more.",
    'Limit postoji samo za veoma veliko opterećenje i ne smeta običnom radu. Ne brojimo poruke, već koliko je računanja otišlo na odgovore: dugi dokumenti i dugi zadaci teže više.'],
  'lim.support': ['Поддержка', 'Support', 'Podrška'],
  'lim.email': ['Почта', 'Email', 'E-pošta'],
  'lim.help': [
    'Не хватает для работы? Напишите нам в поддержку: в некоторых случаях мы можем бесплатно поднять лимит для вас. Обещать не можем, но посмотрим.',
    "Need more for work? Contact support: in some cases we can raise your limit for free. We can't promise, but we'll take a look.",
    'Treba vam više za posao? Pišite nam u podršku: u nekim slučajevima možemo besplatno da podignemo vaš limit. Ne možemo da obećamo, ali ćemo pogledati.'],
} satisfies Dict;
