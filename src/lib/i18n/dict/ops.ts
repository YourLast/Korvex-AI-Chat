import type { Dict } from '../types';

export default {
  'ops.sec': ['{n} с', '{n} s', '{n} s'],
  'ops.min': ['{n} мин', '{n} min', '{n} min'],
  'ops.waiting': [' Ждут: {who}.', ' Waiting: {who}.', ' Čekaju: {who}.'],

  'ops.spike.t': ['Нагрузка резко выросла', 'Load is rising fast', 'Opterećenje naglo raste'],
  'ops.spike.b': ['В работе {running}, в очереди {queued}, за минуту новых запросов: {turns}.', '{running} running, {queued} queued, {turns} new requests in the last minute.', 'U radu {running}, u redu {queued}, novih zahteva u poslednjem minutu: {turns}.'],
  'ops.queue.t': ['Появилась очередь', 'A queue has formed', 'Pojavio se red čekanja'],
  'ops.queue.b': ['Самое долгое ожидание места — {wait}. В работе {running}, в очереди {queued}.', 'Longest wait for a slot: {wait}. {running} running, {queued} queued.', 'Najduže čekanje na mesto: {wait}. U radu {running}, u redu {queued}.'],
  'ops.eta.t': ['Ожидание растёт', 'Wait times are growing', 'Čekanje se produžava'],
  'ops.eta.b': ['Новому сообщению ждать ~{eta}. В работе {running}, в очереди {queued}.', 'A new message would wait ~{eta}. {running} running, {queued} queued.', 'Nova poruka čeka ~{eta}. U radu {running}, u redu {queued}.'],
  'ops.busyOn.t': ['Включился режим высокой нагрузки', 'Heavy-load mode is on', 'Uključen je režim velikog opterećenja'],
  'ops.busyOn.b': ['Пользователи видят баннер. Ожидание ~{eta}, в работе {running}, в очереди {queued}.', 'Users now see the banner. Wait ~{eta}, {running} running, {queued} queued.', 'Korisnici sada vide baner. Čekanje ~{eta}, u radu {running}, u redu {queued}.'],
  'ops.busyOff.t': ['Режим высокой нагрузки выключился', 'Heavy-load mode is off', 'Režim velikog opterećenja je isključen'],
  'ops.busyOff.b': ['Баннер у пользователей убран. В работе {running}, в очереди {queued}.', 'The banner is gone for users. {running} running, {queued} queued.', 'Baner je uklonjen kod korisnika. U radu {running}, u redu {queued}.'],
  'ops.clear.t': ['Нагрузка спала', 'Load has calmed down', 'Opterećenje je splasnulo'],
  'ops.clear.b': ['Очереди и ожидания нет — новые сообщения начинаются сразу.', 'No queue and no waiting — new messages start right away.', 'Nema reda ni čekanja — nove poruke počinju odmah.'],
} satisfies Dict;
