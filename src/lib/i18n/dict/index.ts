import type { Dict, Entry } from '../types';
import common from './common';
import auth from './auth';
import chat from './chat';
import shell from './shell';
import picker from './picker';
import server from './server';
import work from './work';
import tools from './tools';
import install from './install';
import ops from './ops';
import files from './files';
import seat from './seat';
import { EXT_DICT } from '@/ext/i18n';

export const PARTS: Record<string, Dict> = { common, auth, chat, shell, picker, server, work, tools, install, ops, files, seat };
export const DICT = { ...common, ...auth, ...chat, ...shell, ...picker, ...server, ...work, ...tools, ...install, ...ops, ...files, ...seat, ...EXT_DICT } as typeof common & typeof auth & typeof chat & typeof shell
  & typeof picker & typeof server & typeof work & typeof tools & typeof install & typeof ops & typeof files & typeof seat;
export type Key = keyof typeof DICT;
export type { Entry };
