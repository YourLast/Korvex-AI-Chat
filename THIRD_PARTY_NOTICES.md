# Third-party notices

Korvex AI Chat is licensed under the Apache License 2.0 with one additional condition (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).
It includes or uses the third-party software listed below. The Docker images (x86-64 and ARM64) contain the npm packages from the last
section (platform-specific packages only for their platform); the license text of each package is in its own folder under `node_modules/`.

Where a package offers a choice of licenses (for example `jszip`: MIT OR GPL-3.0-or-later), it is used under the permissive one
(MIT). Packages under the MPL-2.0 (`web-push`) are used unmodified; their source is at the link in the table.

## libvips and its libraries (LGPL-3.0-or-later)

The image library `sharp` (Apache-2.0) loads libvips 8.18.7 from the prebuilt package
`@img/sharp-libvips-linux-x64` 1.3.4 (also: `@img/sharp-libvips-linux-arm64`, `@img/sharp-libvips-linuxmusl-arm64`, `@img/sharp-libvips-linuxmusl-x64`).
libvips and several of the libraries built into it are licensed under the GNU LGPL 3.0 or later; they are dynamically linked
shared libraries in `node_modules/@img/sharp-libvips-*/lib/` and can be replaced with your own build.

- Source code of libvips: https://github.com/libvips/libvips/tree/v8.18.7
- Build scripts with the exact versions and sources of every bundled library: https://github.com/lovell/sharp-libvips/tree/v1.3.4
- License texts: [licenses/LGPL-3.0.txt](licenses/LGPL-3.0.txt) and [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt)

Bundled library versions: aom 3.15.1, archive 3.8.9, cairo 1.18.6, cgif 0.5.4, exif 0.6.26, expat 2.8.5, ffi 3.8.0, fontconfig 2.18.3, freetype 2.14.3, fribidi 1.0.17, glib 2.90.0, harfbuzz 14.5.0, heif 1.23.5, highway 1.4.0, imagequant 2.4.1, lcms 2.19.1, mozjpeg 0826579, pango 1.58.2, pixman 0.46.4, png 1.6.58, proxy-libintl 0.5, rsvg 2.63.2, tiff 4.7.2, uhdr 2.0.2, vips 8.18.7, webp 1.6.0, xml2 2.15.4, zlib-ng 2.3.3.

Licenses of the bundled libraries (from the package README):

This software contains third-party libraries
used under the terms of the following licenses:

| Library       | Used under the terms of                                                                                   |
|---------------|-----------------------------------------------------------------------------------------------------------|
| aom           | BSD 2-Clause + [Alliance for Open Media Patent License 1.0](https://aomedia.org/license/patent-license/)  |
| cairo         | Mozilla Public License 1.1                                                                                |
| cgif          | MIT License                                                                                               |
| expat         | MIT License                                                                                               |
| fontconfig    | [fontconfig License](https://gitlab.freedesktop.org/fontconfig/fontconfig/blob/main/COPYING) (BSD-like)   |
| freetype      | [freetype License](https://git.savannah.gnu.org/cgit/freetype/freetype2.git/tree/docs/FTL.TXT) (BSD-like) |
| fribidi       | LGPLv3                                                                                                    |
| glib          | LGPLv3                                                                                                    |
| harfbuzz      | MIT License                                                                                               |
| highway       | BSD 3-Clause                                                                                              |
| lcms          | MIT License                                                                                               |
| libarchive    | BSD 2-Clause                                                                                              |
| libexif       | LGPLv3                                                                                                    |
| libffi        | MIT License                                                                                               |
| libheif       | LGPLv3                                                                                                    |
| libimagequant | [BSD 2-Clause](https://github.com/lovell/libimagequant/blob/main/COPYRIGHT)                               |
| libnsgif      | MIT License                                                                                               |
| libpng        | [libpng License](https://github.com/pnggroup/libpng/blob/master/LICENSE)                                  |
| librsvg       | LGPLv3                                                                                                    |
| libtiff       | [libtiff License](https://gitlab.com/libtiff/libtiff/blob/master/LICENSE.md) (BSD-like)                   |
| libultrahdr   | MIT License                                                                                               |
| libvips       | LGPLv3                                                                                                    |
| libwebp       | New BSD License                                                                                           |
| libxml2       | MIT License                                                                                               |
| mozjpeg       | [zlib License, IJG License, BSD 3-Clause](https://github.com/mozilla/mozjpeg/blob/master/LICENSE.md)      |
| pango         | LGPLv3                                                                                                    |
| pixman        | MIT License                                                                                               |
| proxy-libintl | LGPLv3                                                                                                    |
| zlib-ng       | [zlib License](https://github.com/zlib-ng/zlib-ng/blob/develop/LICENSE.md)                                |

Use of libraries under the terms of the LGPLv3 is via the
"any later version" clause of the LGPLv2 or LGPLv2.1.

Please report any errors or omissions via
https://github.com/lovell/sharp-libvips/issues/new

## Fonts

- **Inter** — SIL Open Font License 1.1, Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter);
  the font files are served from `.next/static/media`. License: [licenses/OFL-1.1-Inter.txt](licenses/OFL-1.1-Inter.txt).
- **KaTeX fonts** — MIT, part of the `katex` package (`node_modules/katex/LICENSE`).
- **pdf.js standard fonts** — Foxit fonts (BSD-style, `node_modules/pdfjs-dist/standard_fonts/LICENSE_FOXIT`) and
  Liberation fonts (SIL OFL 1.1, `node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION`).

## Icons and logo

The interface icons and the Korvex mark are original work of Korvex and are distributed with this project under its license (see LICENSE).
The Korvex name and logo are trademarks of Korvex (see README).

## Speech-to-text server (not in the image)

`compose.yaml` runs **speaches** (MIT, https://github.com/speaches-ai/speaches) from its own image
`ghcr.io/speaches-ai/speaches`. It is a separate program and is not part of the Korvex AI Chat image.

## npm packages in the image (312)

| Package | Version | License | Source |
|---|---|---|---|
| @ai-sdk/gateway | 4.0.128 | Apache-2.0 | https://github.com/vercel/ai |
| @ai-sdk/openai-compatible | 3.0.80 | Apache-2.0 | https://github.com/vercel/ai |
| @ai-sdk/provider | 4.0.34 | Apache-2.0 | https://github.com/vercel/ai |
| @ai-sdk/provider-utils | 5.0.70 | Apache-2.0 | https://github.com/vercel/ai |
| @anthropic-ai/sdk | 1.4.0 | Apache-2.0 | https://github.com/anthropics/anthropic-sdk-typescript |
| @babel/runtime | 7.29.10 | MIT | https://github.com/babel/babel |
| @emnapi/runtime | 1.11.3 | MIT | https://github.com/toyobayashi/emnapi |
| @fast-csv/format | 4.3.5 | MIT | https://github.com/C2FO/fast-csv |
| @fast-csv/parse | 4.3.6 | MIT | https://github.com/C2FO/fast-csv |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-arm64 |
| @img/sharp-libvips-linux-x64 | 1.3.4 | LGPL-3.0-or-later | https://github.com/lovell/sharp-libvips |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linuxmusl-arm64 |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.4 | LGPL-3.0-or-later | https://github.com/lovell/sharp-libvips |
| @img/sharp-linux-arm64 | 0.35.5 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-arm64 |
| @img/sharp-linux-x64 | 0.35.5 | Apache-2.0 | https://github.com/lovell/sharp |
| @img/sharp-linuxmusl-arm64 | 0.35.5 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linuxmusl-arm64 |
| @img/sharp-linuxmusl-x64 | 0.35.5 | Apache-2.0 | https://github.com/lovell/sharp |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | https://github.com/lovell/sharp |
| @napi-rs/canvas | 1.1.0 | MIT | https://github.com/Brooooooklyn/canvas |
| @napi-rs/canvas-linux-arm64-gnu | 1.1.0 | MIT | https://www.npmjs.com/package/@napi-rs/canvas-linux-arm64-gnu |
| @napi-rs/canvas-linux-arm64-musl | 1.1.0 | MIT | https://www.npmjs.com/package/@napi-rs/canvas-linux-arm64-musl |
| @napi-rs/canvas-linux-x64-gnu | 1.1.0 | MIT | https://github.com/Brooooooklyn/canvas |
| @napi-rs/canvas-linux-x64-musl | 1.1.0 | MIT | https://github.com/Brooooooklyn/canvas |
| @next/env | 16.4.3 | MIT | https://github.com/vercel/next.js |
| @next/swc-linux-arm64-gnu | 16.4.3 | MIT | https://www.npmjs.com/package/@next/swc-linux-arm64-gnu |
| @next/swc-linux-arm64-musl | 16.4.3 | MIT | https://www.npmjs.com/package/@next/swc-linux-arm64-musl |
| @next/swc-linux-x64-gnu | 16.4.3 | MIT | https://github.com/vercel/next.js |
| @next/swc-linux-x64-musl | 16.4.3 | MIT | https://github.com/vercel/next.js |
| @node-rs/argon2 | 2.2.2 | MIT | https://github.com/napi-rs/node-rs |
| @node-rs/argon2-linux-arm64-gnu | 2.2.2 | MIT | https://www.npmjs.com/package/@node-rs/argon2-linux-arm64-gnu |
| @node-rs/argon2-linux-arm64-musl | 2.2.2 | MIT | https://www.npmjs.com/package/@node-rs/argon2-linux-arm64-musl |
| @node-rs/argon2-linux-x64-gnu | 2.2.2 | MIT | https://github.com/napi-rs/node-rs |
| @node-rs/argon2-linux-x64-musl | 2.2.2 | MIT | https://github.com/napi-rs/node-rs |
| @opentelemetry/api | 1.10.0 | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |
| @stablelib/base64 | 1.0.1 | MIT | https://github.com/StableLib/stablelib |
| @standard-schema/spec | 1.1.0 | MIT | https://github.com/standard-schema/standard-schema |
| @swc/helpers | 0.5.23 | Apache-2.0 | https://github.com/swc-project/swc |
| @types/better-sqlite3 | 7.6.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/debug | 4.1.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/estree | 1.0.9 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/estree-jsx | 1.0.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/hast | 3.0.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/katex | 0.16.8 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/mdast | 4.0.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/ms | 2.1.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | 14.18.63 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | 22.20.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/unist | 3.0.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/unist | 2.0.11 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @ungap/structured-clone | 1.4.0 | ISC | https://github.com/ungap/structured-clone |
| @vercel/oidc | 3.2.0 | Apache-2.0 | https://github.com/vercel/vercel |
| @workflow/serde | 4.1.0 | Apache-2.0 | https://github.com/vercel/workflow |
| agent-base | 7.1.4 | MIT | https://github.com/TooTallNate/proxy-agents |
| ai | 7.0.155 | Apache-2.0 | https://github.com/vercel/ai |
| archiver | 5.3.2 | MIT | https://github.com/archiverjs/node-archiver |
| archiver-utils | 2.1.0 | MIT | https://github.com/archiverjs/archiver-utils |
| archiver-utils | 3.0.4 | MIT | https://github.com/archiverjs/archiver-utils |
| asn1.js | 5.4.1 | MIT | https://github.com/indutny/asn1.js |
| async | 3.2.6 | MIT | https://github.com/caolan/async |
| bail | 2.0.2 | MIT | https://github.com/wooorm/bail |
| balanced-match | 1.0.2 | MIT | https://github.com/juliangruber/balanced-match |
| base64-js | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| baseline-browser-mapping | 2.11.34 | Apache-2.0 | https://github.com/web-platform-dx/baseline-browser-mapping |
| better-sqlite3 | 12.11.1 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| bindings | 1.5.0 | MIT | https://github.com/TooTallNate/node-bindings |
| bl | 4.1.0 | MIT | https://github.com/rvagg/bl |
| bluebird | 3.7.2 | MIT | https://github.com/petkaantonov/bluebird |
| bn.js | 4.12.5 | MIT | https://github.com/indutny/bn.js |
| brace-expansion | 1.1.21 | MIT | https://github.com/juliangruber/brace-expansion |
| brace-expansion | 2.1.7 | MIT | https://github.com/juliangruber/brace-expansion |
| buffer | 5.7.1 | MIT | https://github.com/feross/buffer |
| buffer-crc32 | 0.2.13 | MIT | https://github.com/brianloveswords/buffer-crc32 |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause | https://github.com/goinstant/buffer-equal-constant-time |
| caniuse-lite | 1.0.30001819 | CC-BY-4.0 | https://github.com/browserslist/caniuse-lite |
| ccount | 2.0.1 | MIT | https://github.com/wooorm/ccount |
| character-entities | 2.0.2 | MIT | https://github.com/wooorm/character-entities |
| character-entities-html4 | 2.1.0 | MIT | https://github.com/wooorm/character-entities-html4 |
| character-entities-legacy | 3.0.0 | MIT | https://github.com/wooorm/character-entities-legacy |
| character-reference-invalid | 2.0.1 | MIT | https://github.com/wooorm/character-reference-invalid |
| chownr | 1.1.4 | ISC | https://github.com/isaacs/chownr |
| client-only | 0.0.1 | MIT | https://reactjs.org/ |
| comma-separated-tokens | 2.0.3 | MIT | https://github.com/wooorm/comma-separated-tokens |
| commander | 15.0.0 | MIT | https://github.com/tj/commander.js |
| commander | 8.3.0 | MIT | https://github.com/tj/commander.js |
| compress-commons | 4.1.2 | MIT | https://github.com/archiverjs/node-compress-commons |
| concat-map | 0.0.1 | MIT | https://github.com/substack/node-concat-map |
| core-util-is | 1.0.3 | MIT | https://github.com/isaacs/core-util-is |
| crc-32 | 1.2.2 | Apache-2.0 | https://github.com/SheetJS/js-crc32 |
| crc32-stream | 4.0.3 | MIT | https://github.com/archiverjs/node-crc32-stream |
| cron-parser | 5.10.2 | MIT | https://github.com/harrisiirak/cron-parser |
| csstype | 3.2.3 | MIT | https://github.com/frenic/csstype |
| dayjs | 1.11.23 | MIT | https://github.com/iamkun/dayjs |
| debug | 4.4.3 | MIT | https://github.com/debug-js/debug |
| decode-named-character-reference | 1.3.0 | MIT | https://github.com/wooorm/decode-named-character-reference |
| decompress-response | 6.0.0 | MIT | https://github.com/sindresorhus/decompress-response |
| deep-extend | 0.6.0 | MIT | https://github.com/unclechu/node-deep-extend |
| dequal | 2.0.3 | MIT | https://github.com/lukeed/dequal |
| detect-libc | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc |
| devlop | 1.1.0 | MIT | https://github.com/wooorm/devlop |
| drizzle-orm | 0.45.4 | Apache-2.0 | https://github.com/drizzle-team/drizzle-orm |
| duplexer2 | 0.1.4 | BSD-3-Clause | https://github.com/deoxxa/duplexer2 |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 | https://github.com/Brightspace/node-ecdsa-sig-formatter |
| end-of-stream | 1.4.5 | MIT | https://github.com/mafintosh/end-of-stream |
| entities | 6.0.1 | BSD-2-Clause | https://github.com/fb55/entities |
| escape-string-regexp | 5.0.0 | MIT | https://github.com/sindresorhus/escape-string-regexp |
| estree-util-is-identifier-name | 3.0.0 | MIT | https://github.com/syntax-tree/estree-util-is-identifier-name |
| eventsource-parser | 3.1.1 | MIT | https://github.com/rexxars/eventsource-parser |
| exceljs | 4.4.0 | MIT | https://github.com/exceljs/exceljs |
| expand-template | 2.0.3 | (MIT OR WTFPL) | https://github.com/ralphtheninja/expand-template |
| extend | 3.0.2 | MIT | https://github.com/justmoon/node-extend |
| fast-csv | 4.3.6 | MIT | https://github.com/C2FO/fast-csv |
| fast-sha256 | 1.3.0 | Unlicense | https://github.com/dchest/fast-sha256-js |
| file-uri-to-path | 1.0.0 | MIT | https://github.com/TooTallNate/file-uri-to-path |
| fs-constants | 1.0.0 | MIT | https://github.com/mafintosh/fs-constants |
| fs-extra | 11.3.1 | MIT | https://github.com/jprichardson/node-fs-extra |
| fs.realpath | 1.0.0 | ISC | https://github.com/isaacs/fs.realpath |
| github-from-package | 0.0.0 | MIT | https://github.com/substack/github-from-package |
| glob | 7.2.3 | ISC | https://github.com/isaacs/node-glob |
| graceful-fs | 4.2.11 | ISC | https://github.com/isaacs/node-graceful-fs |
| hast-util-from-dom | 5.0.1 | ISC | https://github.com/syntax-tree/hast-util-from-dom |
| hast-util-from-html | 2.0.3 | MIT | https://github.com/syntax-tree/hast-util-from-html |
| hast-util-from-html-isomorphic | 2.0.0 | MIT | https://github.com/syntax-tree/hast-util-from-html-isomorphic |
| hast-util-from-parse5 | 8.0.3 | MIT | https://github.com/syntax-tree/hast-util-from-parse5 |
| hast-util-parse-selector | 4.0.0 | MIT | https://github.com/syntax-tree/hast-util-parse-selector |
| hast-util-to-jsx-runtime | 2.3.6 | MIT | https://github.com/syntax-tree/hast-util-to-jsx-runtime |
| hast-util-to-text | 4.0.3 | MIT | https://github.com/syntax-tree/hast-util-to-text |
| hast-util-whitespace | 3.0.0 | MIT | https://github.com/syntax-tree/hast-util-whitespace |
| hastscript | 9.0.1 | MIT | https://github.com/syntax-tree/hastscript |
| highlight.js | 11.11.2 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| html-url-attributes | 3.0.1 | MIT | https://github.com/rehypejs/rehype-minify/tree/main/packages/html-url-attributes |
| http_ece | 1.2.0 | MIT | https://github.com/martinthomson/encrypted-content-encoding |
| https-proxy-agent | 7.0.6 | MIT | https://github.com/TooTallNate/proxy-agents |
| ieee754 | 1.2.1 | BSD-3-Clause | https://github.com/feross/ieee754 |
| immediate | 3.0.6 | MIT | https://github.com/calvinmetcalf/immediate |
| inflight | 1.0.6 | ISC | https://github.com/npm/inflight |
| inherits | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| ini | 1.3.8 | ISC | https://github.com/isaacs/ini |
| inline-style-parser | 0.2.7 | MIT | https://github.com/remarkablemark/inline-style-parser |
| is-alphabetical | 2.0.1 | MIT | https://github.com/wooorm/is-alphabetical |
| is-alphanumerical | 2.0.1 | MIT | https://github.com/wooorm/is-alphanumerical |
| is-decimal | 2.0.1 | MIT | https://github.com/wooorm/is-decimal |
| is-hexadecimal | 2.0.1 | MIT | https://github.com/wooorm/is-hexadecimal |
| is-plain-obj | 4.1.0 | MIT | https://github.com/sindresorhus/is-plain-obj |
| isarray | 1.0.0 | MIT | https://github.com/juliangruber/isarray |
| json-schema | 0.4.0 | (AFL-2.1 OR BSD-3-Clause) | https://github.com/kriszyp/json-schema |
| json-schema-to-ts | 3.1.1 | MIT | https://github.com/ThomasAribart/json-schema-to-ts |
| jsonfile | 6.2.1 | MIT | https://github.com/jprichardson/node-jsonfile |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | https://github.com/Stuk/jszip |
| jwa | 2.0.1 | MIT | https://github.com/brianloveswords/node-jwa |
| jws | 4.0.1 | MIT | https://github.com/brianloveswords/node-jws |
| katex | 0.19.1 | MIT | https://github.com/KaTeX/KaTeX |
| katex | 0.16.47 | MIT | https://github.com/KaTeX/KaTeX |
| lazystream | 1.0.1 | MIT | https://github.com/jpommerening/node-lazystream |
| lie | 3.3.0 | MIT | https://github.com/calvinmetcalf/lie |
| lodash.defaults | 4.2.0 | MIT | https://github.com/lodash/lodash |
| lodash.difference | 4.5.0 | MIT | https://github.com/lodash/lodash |
| lodash.escaperegexp | 4.1.2 | MIT | https://github.com/lodash/lodash |
| lodash.flatten | 4.4.0 | MIT | https://github.com/lodash/lodash |
| lodash.groupby | 4.6.0 | MIT | https://github.com/lodash/lodash |
| lodash.isboolean | 3.0.3 | MIT | https://github.com/lodash/lodash |
| lodash.isequal | 4.5.0 | MIT | https://github.com/lodash/lodash |
| lodash.isfunction | 3.0.9 | MIT | https://github.com/lodash/lodash |
| lodash.isnil | 4.0.0 | MIT | https://github.com/lodash/lodash |
| lodash.isplainobject | 4.0.6 | MIT | https://github.com/lodash/lodash |
| lodash.isundefined | 3.0.1 | MIT | https://github.com/lodash/lodash |
| lodash.union | 4.6.0 | MIT | https://github.com/lodash/lodash |
| lodash.uniq | 4.5.0 | MIT | https://github.com/lodash/lodash |
| longest-streak | 3.1.0 | MIT | https://github.com/wooorm/longest-streak |
| lowlight | 3.3.0 | MIT | https://github.com/wooorm/lowlight |
| luxon | 3.7.2 | MIT | https://github.com/moment/luxon |
| markdown-table | 3.0.4 | MIT | https://github.com/wooorm/markdown-table |
| mdast-util-find-and-replace | 3.0.4 | MIT | https://github.com/syntax-tree/mdast-util-find-and-replace |
| mdast-util-from-markdown | 2.1.0 | MIT | https://github.com/syntax-tree/mdast-util-from-markdown |
| mdast-util-gfm | 3.1.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm |
| mdast-util-gfm-autolink-literal | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-gfm-autolink-literal |
| mdast-util-gfm-footnote | 2.1.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-footnote |
| mdast-util-gfm-strikethrough | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-gfm-strikethrough |
| mdast-util-gfm-table | 2.0.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-table |
| mdast-util-gfm-task-list-item | 2.0.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-task-list-item |
| mdast-util-math | 3.0.0 | MIT | https://github.com/syntax-tree/mdast-util-math |
| mdast-util-mdx-expression | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-mdx-expression |
| mdast-util-mdx-jsx | 3.2.0 | MIT | https://github.com/syntax-tree/mdast-util-mdx-jsx |
| mdast-util-mdxjs-esm | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-mdxjs-esm |
| mdast-util-phrasing | 4.1.0 | MIT | https://github.com/syntax-tree/mdast-util-phrasing |
| mdast-util-to-hast | 13.2.1 | MIT | https://github.com/syntax-tree/mdast-util-to-hast |
| mdast-util-to-markdown | 2.2.1 | MIT | https://github.com/syntax-tree/mdast-util-to-markdown |
| mdast-util-to-string | 4.0.0 | MIT | https://github.com/syntax-tree/mdast-util-to-string |
| micromark | 4.0.3 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark |
| micromark-core-commonmark | 2.0.4 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-core-commonmark |
| micromark-extension-gfm | 3.0.0 | MIT | https://github.com/micromark/micromark-extension-gfm |
| micromark-extension-gfm-autolink-literal | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-autolink-literal |
| micromark-extension-gfm-footnote | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-footnote |
| micromark-extension-gfm-strikethrough | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-strikethrough |
| micromark-extension-gfm-table | 2.1.2 | MIT | https://github.com/micromark/micromark-extension-gfm-table |
| micromark-extension-gfm-tagfilter | 2.0.0 | MIT | https://github.com/micromark/micromark-extension-gfm-tagfilter |
| micromark-extension-gfm-task-list-item | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-task-list-item |
| micromark-extension-math | 3.1.0 | MIT | https://github.com/micromark/micromark-extension-math |
| micromark-factory-destination | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-destination |
| micromark-factory-label | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-label |
| micromark-factory-space | 2.1.0 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-space |
| micromark-factory-title | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-title |
| micromark-factory-whitespace | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-whitespace |
| micromark-util-character | 2.1.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-character |
| micromark-util-chunked | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-chunked |
| micromark-util-classify-character | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-classify-character |
| micromark-util-combine-extensions | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-combine-extensions |
| micromark-util-decode-numeric-character-reference | 2.0.2 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-numeric-character-reference |
| micromark-util-decode-string | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-string |
| micromark-util-edit-map | 1.0.0 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-edit-map |
| micromark-util-encode | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-encode |
| micromark-util-html-tag-name | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-html-tag-name |
| micromark-util-normalize-identifier | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-normalize-identifier |
| micromark-util-resolve-all | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-resolve-all |
| micromark-util-sanitize-uri | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-sanitize-uri |
| micromark-util-subtokenize | 2.1.0 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-subtokenize |
| micromark-util-symbol | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-symbol |
| micromark-util-types | 2.0.3 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-types |
| mimic-response | 3.1.0 | MIT | https://github.com/sindresorhus/mimic-response |
| minimalistic-assert | 1.0.1 | ISC | https://github.com/calvinmetcalf/minimalistic-assert |
| minimatch | 3.1.5 | ISC | https://github.com/isaacs/minimatch |
| minimatch | 5.1.9 | ISC | https://github.com/isaacs/minimatch |
| minimist | 1.2.8 | MIT | https://github.com/minimistjs/minimist |
| mkdirp-classic | 0.5.3 | MIT | https://github.com/mafintosh/mkdirp-classic |
| ms | 2.1.3 | MIT | https://github.com/vercel/ms |
| nanoid | 3.3.20 | MIT | https://github.com/ai/nanoid |
| napi-build-utils | 2.0.0 | MIT | https://github.com/inspiredware/napi-build-utils |
| next | 16.4.3 | MIT | https://github.com/vercel/next.js |
| node-abi | 3.101.0 | MIT | https://github.com/electron/node-abi |
| node-int64 | 0.4.0 | MIT | https://github.com/broofa/node-int64 |
| normalize-path | 3.0.0 | MIT | https://github.com/jonschlinkert/normalize-path |
| once | 1.4.0 | ISC | https://github.com/isaacs/once |
| pako | 1.0.11 | (MIT AND Zlib) | https://github.com/nodeca/pako |
| parse-entities | 4.0.2 | MIT | https://github.com/wooorm/parse-entities |
| parse5 | 7.3.0 | MIT | https://github.com/inikulin/parse5 |
| path-is-absolute | 1.0.1 | MIT | https://github.com/sindresorhus/path-is-absolute |
| pdfjs-dist | 6.5.438 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pend | 1.2.0 | MIT | https://github.com/andrewrk/node-pend |
| picocolors | 1.1.1 | ISC | https://github.com/alexeyraspopov/picocolors |
| postcss | 8.5.23 | MIT | https://github.com/postcss/postcss |
| prebuild-install | 7.1.3 | MIT | https://github.com/prebuild/prebuild-install |
| process-nextick-args | 2.0.1 | MIT | https://github.com/calvinmetcalf/process-nextick-args |
| property-information | 7.2.0 | MIT | https://github.com/wooorm/property-information |
| pump | 3.0.4 | MIT | https://github.com/mafintosh/pump |
| rc | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | https://github.com/dominictarr/rc |
| react | 19.3.1 | MIT | https://github.com/react/react |
| react-dom | 19.3.1 | MIT | https://github.com/react/react |
| react-markdown | 10.1.0 | MIT | https://github.com/remarkjs/react-markdown |
| readable-stream | 2.3.8 | MIT | https://github.com/nodejs/readable-stream |
| readable-stream | 3.6.2 | MIT | https://github.com/nodejs/readable-stream |
| readdir-glob | 1.1.3 | Apache-2.0 | https://github.com/Yqnn/node-readdir-glob |
| rehype-highlight | 7.0.2 | MIT | https://github.com/rehypejs/rehype-highlight |
| rehype-katex | 7.0.1 | MIT | https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex |
| remark-gfm | 4.0.1 | MIT | https://github.com/remarkjs/remark-gfm |
| remark-math | 6.0.0 | MIT | https://github.com/remarkjs/remark-math/tree/main/packages/remark-math |
| remark-parse | 11.0.0 | MIT | https://github.com/remarkjs/remark/tree/main/packages/remark-parse |
| remark-rehype | 11.1.2 | MIT | https://github.com/remarkjs/remark-rehype |
| remark-stringify | 11.0.0 | MIT | https://github.com/remarkjs/remark/tree/main/packages/remark-stringify |
| safe-buffer | 5.1.2 | MIT | https://github.com/feross/safe-buffer |
| safe-buffer | 5.2.1 | MIT | https://github.com/feross/safe-buffer |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer |
| saxes | 5.0.1 | ISC | https://github.com/lddubeau/saxes |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
| semver | 7.8.5 | ISC | https://github.com/npm/node-semver |
| setimmediate | 1.0.5 | MIT | https://github.com/YuzuJS/setImmediate |
| sharp | 0.35.5 | Apache-2.0 | https://github.com/lovell/sharp |
| simple-concat | 1.0.1 | MIT | https://github.com/feross/simple-concat |
| simple-get | 4.0.1 | MIT | https://github.com/feross/simple-get |
| source-map-js | 1.2.2 | BSD-3-Clause | https://github.com/7rulnik/source-map-js |
| space-separated-tokens | 2.0.2 | MIT | https://github.com/wooorm/space-separated-tokens |
| standardwebhooks | 1.1.1 | MIT | https://github.com/standard-webhooks/standard-webhooks |
| string_decoder | 1.1.1 | MIT | https://github.com/nodejs/string_decoder |
| string_decoder | 1.3.0 | MIT | https://github.com/nodejs/string_decoder |
| stringify-entities | 4.0.4 | MIT | https://github.com/wooorm/stringify-entities |
| strip-json-comments | 2.0.1 | MIT | https://github.com/sindresorhus/strip-json-comments |
| style-to-js | 1.1.21 | MIT | https://github.com/remarkablemark/style-to-js |
| style-to-object | 1.0.14 | MIT | https://github.com/remarkablemark/style-to-object |
| styled-jsx | 5.1.6 | MIT | https://github.com/vercel/styled-jsx |
| tar-fs | 2.1.5 | MIT | https://github.com/mafintosh/tar-fs |
| tar-stream | 2.2.0 | MIT | https://github.com/mafintosh/tar-stream |
| tmp | 0.2.7 | MIT | https://github.com/raszi/node-tmp |
| trim-lines | 3.0.1 | MIT | https://github.com/wooorm/trim-lines |
| trough | 2.2.0 | MIT | https://github.com/wooorm/trough |
| ts-algebra | 2.0.0 | MIT | https://github.com/ThomasAribart/ts-algebra |
| tslib | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |
| tunnel-agent | 0.6.0 | Apache-2.0 | https://github.com/mikeal/tunnel-agent |
| undici | 7.30.1 | MIT | https://github.com/nodejs/undici |
| undici-types | 6.21.0 | MIT | https://github.com/nodejs/undici |
| unified | 11.0.5 | MIT | https://github.com/unifiedjs/unified |
| unist-util-is | 6.0.1 | MIT | https://github.com/syntax-tree/unist-util-is |
| unist-util-position | 5.0.0 | MIT | https://github.com/syntax-tree/unist-util-position |
| unist-util-remove-position | 5.0.0 | MIT | https://github.com/syntax-tree/unist-util-remove-position |
| unist-util-stringify-position | 4.0.0 | MIT | https://github.com/syntax-tree/unist-util-stringify-position |
| unist-util-visit | 5.2.0 | MIT | https://github.com/syntax-tree/unist-util-visit |
| unist-util-visit-parents | 6.1.0 | MIT | https://github.com/syntax-tree/unist-util-visit-parents |
| universalify | 2.0.1 | MIT | https://github.com/RyanZim/universalify |
| unzipper | 0.12.5 | MIT | https://github.com/ZJONSSON/node-unzipper |
| util-deprecate | 1.0.2 | MIT | https://github.com/TooTallNate/util-deprecate |
| uuid | 8.3.2 | MIT | https://github.com/uuidjs/uuid |
| vfile | 6.0.3 | MIT | https://github.com/vfile/vfile |
| vfile-location | 5.0.3 | MIT | https://github.com/vfile/vfile-location |
| vfile-message | 4.0.3 | MIT | https://github.com/vfile/vfile-message |
| web-namespaces | 2.0.1 | MIT | https://github.com/wooorm/web-namespaces |
| web-push | 3.6.7 | MPL-2.0 | https://github.com/web-push-libs/web-push |
| wrappy | 1.0.2 | ISC | https://github.com/npm/wrappy |
| xlsx | 0.20.3 | Apache-2.0 | https://git.sheetjs.com/SheetJS/sheetjs |
| xmlchars | 2.2.0 | MIT | https://github.com/lddubeau/xmlchars |
| yauzl | 3.4.0 | MIT | https://github.com/thejoshwolfe/yauzl |
| zip-stream | 4.1.1 | MIT | https://github.com/archiverjs/node-zip-stream |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| zwitch | 2.0.4 | MIT | https://github.com/wooorm/zwitch |
