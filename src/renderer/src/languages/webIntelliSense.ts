import * as monaco from 'monaco-editor';
import type {
  CssClassSymbol,
  CssVariableSymbol,
  JsClassSymbol,
  JsFunctionSymbol,
  WebSymbolCatalog
} from '@shared/types';
import {
  buildAmbientWebExtraLibDts,
  createEmptyWebSymbolCatalog,
  detectWebSubContext,
  extractWebSymbolsFromSource,
  mergeWebSymbolCatalogs
} from '@shared/webAssetAnalyzer';
import type { OpenPhpBufferInfo, PhpNavigationTarget } from './phpIntelliSense';

interface JsMemberMeta {
  name: string;
  kind: 'method' | 'property';
  signature?: string;
  insertText?: string;
  isSnippet?: boolean;
  doc: string;
}

interface CssPropertySpec {
  name: string;
  values?: string[];
  doc: string;
}

let registered = false;
let workspaceWebCatalog: WebSymbolCatalog = createEmptyWebSymbolCatalog();
let remoteWebCatalog: WebSymbolCatalog = createEmptyWebSymbolCatalog();
let remoteIndexedAssetCatalog: WebSymbolCatalog = createEmptyWebSymbolCatalog();
let openWebBuffersReader: () => OpenPhpBufferInfo[] = () => [];
let extraLibJsDisposable: monaco.IDisposable | null = null;
let extraLibTsDisposable: monaco.IDisposable | null = null;
let dtsSyncTimer: ReturnType<typeof setTimeout> | null = null;

export function setOpenWebBuffersProvider(provider: () => OpenPhpBufferInfo[]): void {
  openWebBuffersReader = provider;
  scheduleAmbientExtraLibSync();
}

export function hydrateWorkspaceWebCatalog(catalog: WebSymbolCatalog | null): void {
  workspaceWebCatalog = catalog ?? createEmptyWebSymbolCatalog();
  scheduleAmbientExtraLibSync();
}

export function hydrateRemoteWebCatalog(catalog: WebSymbolCatalog | null): void {
  remoteWebCatalog = catalog ?? createEmptyWebSymbolCatalog();
  scheduleAmbientExtraLibSync();
}

export function hydrateRemoteIndexedAssetPaths(relativePaths: string[]): void {
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];
  for (const rel of relativePaths) {
    const low = rel.toLowerCase();
    if (low.endsWith('.js') || low.endsWith('.mjs') || low.endsWith('.cjs')) {
      jsFiles.push(rel);
    } else if (low.endsWith('.css') || low.endsWith('.scss') || low.endsWith('.less')) {
      cssFiles.push(rel);
    }
  }
  remoteIndexedAssetCatalog = {
    jsFunctions: [],
    jsClasses: [],
    cssClasses: [],
    cssVariables: [],
    htmlIds: [],
    jsFiles,
    cssFiles
  };
}

export function getCombinedWebCatalog(currentModel?: monaco.editor.ITextModel): WebSymbolCatalog {
  const openBufs = openWebBuffersReader();
  const dynamicCatalogs: WebSymbolCatalog[] = [];

  if (currentModel && !currentModel.isDisposed()) {
    const uriPath = currentModel.uri?.path || 'active';
    dynamicCatalogs.push(
      extractWebSymbolsFromSource(currentModel.getValue(), uriPath, uriPath)
    );
  }

  for (const buf of openBufs) {
    dynamicCatalogs.push(
      extractWebSymbolsFromSource(buf.content, buf.title, buf.uriOrPath)
    );
  }

  // Merge Live Tabs -> Remote SFTP Scanned Symbols -> Local Workspace Symbols -> Full Remote Asset Paths
  return mergeWebSymbolCatalogs([
    ...dynamicCatalogs,
    remoteWebCatalog,
    workspaceWebCatalog,
    remoteIndexedAssetCatalog
  ]);
}

export function scheduleAmbientExtraLibSync(): void {
  if (dtsSyncTimer) clearTimeout(dtsSyncTimer);
  dtsSyncTimer = setTimeout(() => {
    try {
      const merged = getCombinedWebCatalog();
      const dts = buildAmbientWebExtraLibDts(merged);
      extraLibJsDisposable?.dispose();
      extraLibTsDisposable?.dispose();
      extraLibJsDisposable = monaco.typescript.javascriptDefaults.addExtraLib(
        dts,
        'ts:hmw-web-ambient.d.ts'
      );
      extraLibTsDisposable = monaco.typescript.typescriptDefaults.addExtraLib(
        dts,
        'ts:hmw-web-ambient.d.ts'
      );
    } catch {
      // Ignore if Monaco TS defaults not yet ready
    }
  }, 260);
}

// ============================================================================
// CURATED JAVASCRIPT, DOM, JQUERY & WEB ECOSYSTEM CATALOGS
// ============================================================================

const JS_OBJECT_MEMBERS: Record<string, JsMemberMeta[]> = {
  document: [
    {
      name: 'getElementById',
      kind: 'method',
      signature: '(elementId: string): HTMLElement | null',
      insertText: "getElementById('${1:id}')",
      isSnippet: true,
      doc: 'Mengambil elemen DOM berdasarkan atribut `id`.'
    },
    {
      name: 'querySelector',
      kind: 'method',
      signature: '(selector: string): Element | null',
      insertText: "querySelector('${1:.selector}')",
      isSnippet: true,
      doc: 'Mengambil elemen pertama yang cocok dengan selector CSS (`#id`, `.class`, `input[name=...]`).'
    },
    {
      name: 'querySelectorAll',
      kind: 'method',
      signature: '(selector: string): NodeListOf<Element>',
      insertText: "querySelectorAll('${1:.selector}')",
      isSnippet: true,
      doc: 'Mengambil seluruh elemen yang cocok dengan selector CSS.'
    },
    {
      name: 'createElement',
      kind: 'method',
      signature: '(tagName: string): HTMLElement',
      insertText: "createElement('${1:div}')",
      isSnippet: true,
      doc: 'Membuat elemen HTML baru di memori.'
    },
    {
      name: 'addEventListener',
      kind: 'method',
      signature: '(type: string, listener: (ev: Event) => void): void',
      insertText: "addEventListener('${1:DOMContentLoaded}', (${2:e}) => {\n\t$0\n})",
      isSnippet: true,
      doc: 'Mendaftarkan event listener pada dokumen (mis. `DOMContentLoaded`, `click`, `keydown`).'
    },
    {
      name: 'getElementsByClassName',
      kind: 'method',
      signature: '(classNames: string): HTMLCollectionOf<Element>',
      insertText: "getElementsByClassName('${1:nama-class}')",
      isSnippet: true,
      doc: 'Mengambil koleksi elemen berdasarkan nama class CSS.'
    },
    {
      name: 'getElementsByName',
      kind: 'method',
      signature: '(elementName: string): NodeListOf<HTMLElement>',
      insertText: "getElementsByName('${1:nama_input}')",
      isSnippet: true,
      doc: 'Mengambil daftar elemen berdasarkan atribut `name="..."` pada form.'
    },
    { name: 'body', kind: 'property', doc: 'Elemen `<body>` dokumen aktif.' },
    { name: 'head', kind: 'property', doc: 'Elemen `<head>` dokumen aktif.' },
    { name: 'forms', kind: 'property', doc: 'Koleksi seluruh `<form>` di halaman.' },
    { name: 'cookie', kind: 'property', doc: 'Membaca atau menulis cookie dokumen.' },
    { name: 'title', kind: 'property', doc: 'Judul tab halaman (`<title>`).' }
  ],
  window: [
    {
      name: 'addEventListener',
      kind: 'method',
      signature: '(type: string, listener: (ev: Event) => void): void',
      insertText: "addEventListener('${1:load}', () => {\n\t$0\n})",
      isSnippet: true,
      doc: 'Mendaftarkan event listener pada objek global `window` (`load`, `resize`, `scroll`).'
    },
    {
      name: 'open',
      kind: 'method',
      signature: '(url?: string, target?: string, features?: string): Window | null',
      insertText: "open('${1:cetak.php}', '${2:_blank}')",
      isSnippet: true,
      doc: 'Membuka URL atau halaman cetak di tab / jendela baru.'
    },
    {
      name: 'scrollTo',
      kind: 'method',
      signature: '(options: ScrollToOptions | number, y?: number): void',
      insertText: "scrollTo({ top: ${1:0}, behavior: 'smooth' })",
      isSnippet: true,
      doc: 'Menggulir halaman ke posisi tertentu secara halus.'
    },
    { name: 'location', kind: 'property', doc: 'Informasi & navigasi URL halaman saat ini (`window.location.href`).' },
    { name: 'localStorage', kind: 'property', doc: 'Penyimpanan key-value permanen di browser.' },
    { name: 'sessionStorage', kind: 'property', doc: 'Penyimpanan key-value per sesi tab browser.' },
    { name: 'history', kind: 'property', doc: 'Navigasi riwayat halaman (`history.back()`, `pushState`).' },
    { name: 'innerWidth', kind: 'property', doc: 'Lebar viewport jendela dalam piksel.' },
    { name: 'innerHeight', kind: 'property', doc: 'Tinggi viewport jendela dalam piksel.' }
  ],
  location: [
    { name: 'href', kind: 'property', doc: 'URL lengkap halaman saat ini; ubah nilainya untuk redirect.' },
    { name: 'reload', kind: 'method', signature: '(): void', insertText: 'reload()', doc: 'Memuat ulang halaman saat ini.' },
    { name: 'replace', kind: 'method', signature: '(url: string): void', insertText: "replace('${1:url}')", isSnippet: true, doc: 'Pindah halaman tanpa menyisakan riwayat tombol Back.' },
    { name: 'search', kind: 'property', doc: 'Query string URL termasuk tanda `?` (mis. `?id=10&act=edit`).' },
    { name: 'pathname', kind: 'property', doc: 'Path URL setelah nama domain.' }
  ],
  console: [
    { name: 'log', kind: 'method', signature: '(...data: any[]): void', insertText: 'log($1)', isSnippet: true, doc: 'Menampilkan nilai ke Console DevTools.' },
    { name: 'error', kind: 'method', signature: '(...data: any[]): void', insertText: 'error($1)', isSnippet: true, doc: 'Menampilkan pesan error ke Console DevTools.' },
    { name: 'warn', kind: 'method', signature: '(...data: any[]): void', insertText: 'warn($1)', isSnippet: true, doc: 'Menampilkan peringatan kuning ke Console.' },
    { name: 'table', kind: 'method', signature: '(tabularData: any): void', insertText: 'table($1)', isSnippet: true, doc: 'Menampilkan array/objek dalam bentuk tabel rapi di Console.' },
    { name: 'time', kind: 'method', signature: '(label?: string): void', insertText: "time('${1:timer}')", isSnippet: true, doc: 'Memulai penghitung waktu eksekusi.' },
    { name: 'timeEnd', kind: 'method', signature: '(label?: string): void', insertText: "timeEnd('${1:timer}')", isSnippet: true, doc: 'Menghentikan dan mencetak durasi penghitung waktu.' }
  ],
  JSON: [
    { name: 'parse', kind: 'method', signature: '(text: string): any', insertText: 'parse(${1:jsonText})', isSnippet: true, doc: 'Mengurai string JSON menjadi objek/array JavaScript.' },
    { name: 'stringify', kind: 'method', signature: '(value: any, replacer?: any, space?: number): string', insertText: 'stringify(${1:data}, null, 2)', isSnippet: true, doc: 'Mengubah objek/array JavaScript menjadi string JSON.' }
  ],
  localStorage: [
    { name: 'getItem', kind: 'method', signature: '(key: string): string | null', insertText: "getItem('${1:key}')", isSnippet: true, doc: 'Membaca nilai dari LocalStorage.' },
    { name: 'setItem', kind: 'method', signature: '(key: string, value: string): void', insertText: "setItem('${1:key}', ${2:value})", isSnippet: true, doc: 'Menyimpan nilai string ke LocalStorage.' },
    { name: 'removeItem', kind: 'method', signature: '(key: string): void', insertText: "removeItem('${1:key}')", isSnippet: true, doc: 'Menghapus item dari LocalStorage.' },
    { name: 'clear', kind: 'method', signature: '(): void', insertText: 'clear()', doc: 'Mengosongkan seluruh LocalStorage domain ini.' }
  ],
  $: [
    {
      name: 'ajax',
      kind: 'method',
      signature: '(settings: JQueryAjaxSettings): jqXHR',
      insertText:
        "ajax({\n\turl: '${1:modul_save.php}',\n\ttype: '${2:POST}',\n\tdata: ${3:$('#form_utama').serialize()},\n\tdataType: '${4:json}',\n\tsuccess: function(res) {\n\t\t$0\n\t},\n\terror: function(xhr) {\n\t\tconsole.error(xhr.responseText);\n\t}\n})",
      isSnippet: true,
      doc: 'jQuery AJAX request lengkap (`POST`/`GET`, serialisasi form, dan callback JSON).'
    },
    {
      name: 'post',
      kind: 'method',
      signature: '(url: string, data?: any, success?: (res: any) => void, dataType?: string)',
      insertText: "post('${1:modul_save.php}', { ${2:id}: ${3:id} }, function(res) {\n\t$0\n}, 'json')",
      isSnippet: true,
      doc: 'jQuery HTTP POST singkat ke endpoint PHP.'
    },
    {
      name: 'get',
      kind: 'method',
      signature: '(url: string, data?: any, success?: (res: any) => void)',
      insertText: "get('${1:modul_ajax.php}', { ${2:kd}: ${3:val} }, function(res) {\n\t$0\n})",
      isSnippet: true,
      doc: 'jQuery HTTP GET singkat.'
    },
    {
      name: 'getJSON',
      kind: 'method',
      signature: '(url: string, data?: any, success?: (res: any) => void)',
      insertText: "getJSON('${1:data_json.php}', { ${2:q}: ${3:term} }, function(data) {\n\t$0\n})",
      isSnippet: true,
      doc: 'Mengambil data JSON dari server via HTTP GET.'
    },
    {
      name: 'each',
      kind: 'method',
      signature: '(collection: any, callback: (index: number, item: any) => void)',
      insertText: 'each(${1:list}, function(idx, item) {\n\t$0\n})',
      isSnippet: true,
      doc: 'Iterasi array atau objek dengan jQuery.'
    }
  ],
  Swal: [
    {
      name: 'fire',
      kind: 'method',
      signature: '(options: SweetAlertOptions): Promise<SweetAlertResult>',
      insertText:
        "fire({\n\ttitle: '${1:Berhasil!}',\n\ttext: '${2:Data berhasil disimpan.}',\n\ticon: '${3:success}'\n})",
      isSnippet: true,
      doc: 'Menampilkan dialog modal modern SweetAlert2 (`success`, `error`, `warning`, `question`).'
    }
  ],
  axios: [
    {
      name: 'get',
      kind: 'method',
      signature: '(url: string, config?: object): Promise<AxiosResponse>',
      insertText: "get('${1:/api/data}')",
      isSnippet: true,
      doc: 'HTTP GET menggunakan Axios.'
    },
    {
      name: 'post',
      kind: 'method',
      signature: '(url: string, data?: any, config?: object): Promise<AxiosResponse>',
      insertText: "post('${1:/api/simpan}', {\n\t$0\n})",
      isSnippet: true,
      doc: 'HTTP POST menggunakan Axios.'
    },
    {
      name: 'put',
      kind: 'method',
      signature: '(url: string, data?: any): Promise<AxiosResponse>',
      insertText: "put('${1:/api/update}', { $0 })",
      isSnippet: true,
      doc: 'HTTP PUT menggunakan Axios.'
    },
    {
      name: 'delete',
      kind: 'method',
      signature: '(url: string): Promise<AxiosResponse>',
      insertText: "delete('${1:/api/hapus}')",
      isSnippet: true,
      doc: 'HTTP DELETE menggunakan Axios.'
    }
  ]
};
JS_OBJECT_MEMBERS.jQuery = JS_OBJECT_MEMBERS.$;
JS_OBJECT_MEMBERS.sessionStorage = JS_OBJECT_MEMBERS.localStorage;

const JQUERY_INSTANCE_MEMBERS: JsMemberMeta[] = [
  { name: 'val', kind: 'method', signature: '(value?: string | number): string | this', insertText: 'val($1)', isSnippet: true, doc: 'Membaca atau mengisi nilai `<input>`, `<select>`, atau `<textarea>`.' },
  { name: 'html', kind: 'method', signature: '(htmlString?: string): string | this', insertText: 'html($1)', isSnippet: true, doc: 'Membaca atau mengubah isi HTML elemen.' },
  { name: 'text', kind: 'method', signature: '(text?: string): string | this', insertText: 'text($1)', isSnippet: true, doc: 'Membaca atau mengubah teks murni elemen (aman dari XSS).' },
  { name: 'on', kind: 'method', signature: '(events: string, handler: (e) => void): this', insertText: "on('${1:click}', function(e) {\n\t$0\n})", isSnippet: true, doc: 'Memasang event handler jQuery (`click`, `change`, `submit`, `keyup`).' },
  { name: 'click', kind: 'method', signature: '(handler?: (e) => void): this', insertText: 'click(function(e) {\n\t$0\n})', isSnippet: true, doc: 'Event klik atau pemicu klik elemen.' },
  { name: 'change', kind: 'method', signature: '(handler?: (e) => void): this', insertText: 'change(function() {\n\t$0\n})', isSnippet: true, doc: 'Event saat nilai `<select>` / `<input>` berubah.' },
  { name: 'submit', kind: 'method', signature: '(handler?: (e) => void): this', insertText: 'submit(function(e) {\n\te.preventDefault();\n\t$0\n})', isSnippet: true, doc: 'Event submit pada `<form>`.' },
  { name: 'serialize', kind: 'method', signature: '(): string', insertText: 'serialize()', doc: 'Mengubah seluruh input `<form>` menjadi query string siap kirim ke `$.ajax`.' },
  { name: 'serializeArray', kind: 'method', signature: '(): Array<{name, value}>', insertText: 'serializeArray()', doc: 'Mengubah input `<form>` menjadi array objek `{ name, value }`.' },
  { name: 'attr', kind: 'method', signature: '(name: string, value?: any)', insertText: "attr('${1:disabled}', ${2:true})", isSnippet: true, doc: 'Membaca atau mengubah atribut HTML elemen.' },
  { name: 'prop', kind: 'method', signature: '(name: string, value?: boolean)', insertText: "prop('${1:checked}', ${2:true})", isSnippet: true, doc: 'Membaca atau mengubah properti DOM (`checked`, `disabled`, `readonly`).' },
  { name: 'data', kind: 'method', signature: '(key: string, value?: any)', insertText: "data('${1:id}')", isSnippet: true, doc: 'Membaca nilai atribut `data-*`.' },
  { name: 'addClass', kind: 'method', signature: '(className: string): this', insertText: "addClass('${1:active}')", isSnippet: true, doc: 'Menambahkan class CSS ke elemen.' },
  { name: 'removeClass', kind: 'method', signature: '(className?: string): this', insertText: "removeClass('${1:d-none}')", isSnippet: true, doc: 'Menghapus class CSS dari elemen.' },
  { name: 'toggleClass', kind: 'method', signature: '(className: string): this', insertText: "toggleClass('${1:active}')", isSnippet: true, doc: 'Membalik status class CSS pada elemen.' },
  { name: 'show', kind: 'method', signature: '(speed?: number): this', insertText: 'show()', doc: 'Menampilkan elemen yang tersembunyi.' },
  { name: 'hide', kind: 'method', signature: '(speed?: number): this', insertText: 'hide()', doc: 'Menyembunyikan elemen.' },
  { name: 'fadeIn', kind: 'method', signature: '(duration?: number): this', insertText: 'fadeIn(200)', doc: 'Menampilkan elemen dengan efek transisi halus.' },
  { name: 'fadeOut', kind: 'method', signature: '(duration?: number): this', insertText: 'fadeOut(200)', doc: 'Menyembunyikan elemen dengan efek transisi halus.' },
  { name: 'find', kind: 'method', signature: '(selector: string): JQuery', insertText: "find('${1:input}')", isSnippet: true, doc: 'Mencari elemen turunan di dalam elemen ini.' },
  { name: 'closest', kind: 'method', signature: '(selector: string): JQuery', insertText: "closest('${1:tr}')", isSnippet: true, doc: 'Mencari elemen induk terdekat yang cocok (mis. `tr`, `.card`).' },
  { name: 'append', kind: 'method', signature: '(content: string): this', insertText: 'append(${1:html})', isSnippet: true, doc: 'Menambahkan konten HTML di bagian akhir dalam elemen.' },
  { name: 'empty', kind: 'method', signature: '(): this', insertText: 'empty()', doc: 'Mengosongkan seluruh isi anak elemen.' },
  { name: 'focus', kind: 'method', signature: '(): this', insertText: 'focus()', doc: 'Memfokuskan kursor ke elemen input.' },
  { name: 'modal', kind: 'method', signature: "(action: 'show' | 'hide' | 'toggle'): this", insertText: "modal('${1:show}')", isSnippet: true, doc: 'Membuka atau menutup komponen Bootstrap Modal.' },
  { name: 'select2', kind: 'method', signature: '(options?: object): this', insertText: "select2({ placeholder: '${1:-- Pilih --}', allowClear: true })", isSnippet: true, doc: 'Mengaktifkan komponen dropdown pencarian Select2.' },
  { name: 'DataTable', kind: 'method', signature: '(options?: object): DataTable', insertText: 'DataTable({\n\tpageLength: 25,\n\torder: [[0, "asc"]]\n})', isSnippet: true, doc: 'Mengaktifkan tabel interaktif jQuery DataTables.' }
];

const GENERIC_DOM_AND_JS_MEMBERS: JsMemberMeta[] = [
  { name: 'value', kind: 'property', doc: 'Nilai elemen `<input>`, `<select>`, atau `<textarea>`.' },
  { name: 'checked', kind: 'property', doc: 'Status centang checkbox / radio (`boolean`).' },
  { name: 'disabled', kind: 'property', doc: 'Status nonaktif elemen form (`boolean`).' },
  { name: 'innerHTML', kind: 'property', doc: 'Konten markup HTML di dalam elemen.' },
  { name: 'textContent', kind: 'property', doc: 'Teks murni di dalam elemen DOM.' },
  { name: 'classList', kind: 'property', doc: 'Manipulasi daftar class CSS (`add`, `remove`, `toggle`, `contains`).' },
  { name: 'style', kind: 'property', doc: 'Gaya CSS inline pada elemen (`el.style.display = "none"`).' },
  { name: 'dataset', kind: 'property', doc: 'Akses atribut `data-*` pada elemen (`el.dataset.nip`).' },
  { name: 'addEventListener', kind: 'method', signature: '(type: string, handler: (e) => void)', insertText: "addEventListener('${1:click}', (${2:e}) => {\n\t$0\n})", isSnippet: true, doc: 'Memasang pendengar event DOM.' },
  { name: 'setAttribute', kind: 'method', signature: '(name: string, value: string)', insertText: "setAttribute('${1:name}', '${2:value}')", isSnippet: true, doc: 'Mengatur nilai atribut HTML.' },
  { name: 'getAttribute', kind: 'method', signature: '(name: string): string | null', insertText: "getAttribute('${1:data-id}')", isSnippet: true, doc: 'Membaca nilai atribut HTML.' },
  { name: 'preventDefault', kind: 'method', signature: '(): void', insertText: 'preventDefault()', doc: 'Mencegah aksi bawaan browser (mis. submit form reload).' },
  { name: 'stopPropagation', kind: 'method', signature: '(): void', insertText: 'stopPropagation()', doc: 'Menghentikan rambatan event ke elemen induk.' },
  { name: 'target', kind: 'property', doc: 'Elemen asal yang memicu event.' },
  { name: 'focus', kind: 'method', signature: '(): void', insertText: 'focus()', doc: 'Memfokuskan elemen.' },
  { name: 'submit', kind: 'method', signature: '(): void', insertText: 'submit()', doc: 'Mengirimkan `<form>` secara programatis.' },
  { name: 'length', kind: 'property', doc: 'Jumlah elemen array atau panjang string.' },
  { name: 'forEach', kind: 'method', signature: '(cb: (item, idx) => void)', insertText: 'forEach((${1:item}) => {\n\t$0\n})', isSnippet: true, doc: 'Melakukan perulangan untuk setiap item.' },
  { name: 'map', kind: 'method', signature: '(cb: (item, idx) => any): Array', insertText: 'map((${1:item}) => ${2:item})', isSnippet: true, doc: 'Memetakan setiap elemen array menjadi array baru.' },
  { name: 'filter', kind: 'method', signature: '(cb: (item) => boolean): Array', insertText: 'filter((${1:item}) => ${2:Boolean(item)})', isSnippet: true, doc: 'Menyaring elemen array yang memenuhi kondisi.' },
  { name: 'find', kind: 'method', signature: '(cb: (item) => boolean): any', insertText: 'find((${1:item}) => ${2:item.id === id})', isSnippet: true, doc: 'Mencari elemen pertama yang cocok.' },
  { name: 'includes', kind: 'method', signature: '(searchElement: any): boolean', insertText: 'includes(${1:val})', isSnippet: true, doc: 'Memeriksa apakah array/string memuat nilai tertentu.' },
  { name: 'push', kind: 'method', signature: '(...items: any[]): number', insertText: 'push(${1:item})', isSnippet: true, doc: 'Menambahkan elemen ke akhir array.' },
  { name: 'join', kind: 'method', signature: '(separator?: string): string', insertText: "join('${1:, }')", isSnippet: true, doc: 'Menggabungkan array menjadi satu string.' },
  { name: 'trim', kind: 'method', signature: '(): string', insertText: 'trim()', doc: 'Menghapus spasi di awal dan akhir string.' },
  { name: 'split', kind: 'method', signature: '(separator: string): string[]', insertText: "split('${1:,}')", isSnippet: true, doc: 'Memecah string menjadi array.' },
  { name: 'replace', kind: 'method', signature: '(search: string | RegExp, replacement: string): string', insertText: "replace(${1:/\\D/g}, '${2:}')", isSnippet: true, doc: 'Mengganti teks di dalam string.' },
  { name: 'then', kind: 'method', signature: '(onfulfilled: (val) => any): Promise', insertText: 'then((${1:res}) => {\n\t$0\n})', isSnippet: true, doc: 'Menangani hasil sukses `Promise` / `fetch`.' },
  { name: 'catch', kind: 'method', signature: '(onrejected: (err) => any): Promise', insertText: 'catch((${1:err}) => {\n\tconsole.error(${1:err});\n})', isSnippet: true, doc: 'Menangani kegagalan `Promise` / `fetch`.' },
  { name: 'json', kind: 'method', signature: '(): Promise<any>', insertText: 'json()', doc: 'Mengurai body respons `fetch()` sebagai JSON.' }
];

const JS_TOP_SNIPPETS: Array<{ label: string; detail: string; body: string; doc: string }> = [
  {
    label: 'fetch-post',
    detail: '[JS Snippet] Async Fetch POST JSON / FormData',
    body: "const res = await fetch('${1:modul_save.php}', {\n\tmethod: 'POST',\n\tbody: new FormData(document.getElementById('${2:form_utama}'))\n});\nconst data = await res.json();\n$0",
    doc: 'Mengirim form atau JSON ke endpoint PHP dengan `fetch()` modern.'
  },
  {
    label: 'ajax-post',
    detail: '[jQuery Snippet] $.ajax POST ke Endpoint PHP',
    body: "$.ajax({\n\turl: '${1:modul_save.php}',\n\ttype: 'POST',\n\tdata: $('#${2:form_utama}').serialize(),\n\tdataType: 'json',\n\tsuccess: function(res) {\n\t\t$0\n\t}\n});",
    doc: 'Mengirimkan form dengan `$.ajax` ke script `_save.php`.'
  },
  {
    label: 'doc-ready',
    detail: '[jQuery Snippet] $(document).ready(...)',
    body: '$(document).ready(function() {\n\t$0\n});',
    doc: 'Menjalankan kode jQuery segera setelah DOM selesai dimuat.'
  },
  {
    label: 'dom-ready',
    detail: '[DOM Snippet] document.addEventListener("DOMContentLoaded")',
    body: "document.addEventListener('DOMContentLoaded', () => {\n\t$0\n});",
    doc: 'Menjalankan JavaScript murni saat dokumen siap tanpa jQuery.'
  },
  {
    label: 'swal-confirm',
    detail: '[SweetAlert2] Dialog Konfirmasi Hapus / Simpan',
    body: "Swal.fire({\n\ttitle: '${1:Apakah Anda yakin?}',\n\ttext: '${2:Data yang dihapus tidak dapat dikembalikan!}',\n\ticon: 'warning',\n\tshowCancelButton: true,\n\tconfirmButtonText: '${3:Ya, Lanjutkan}',\n\tcancelButtonText: 'Batal'\n}).then((result) => {\n\tif (result.isConfirmed) {\n\t\t$0\n\t}\n});",
    doc: 'Menampilkan konfirmasi interaktif SweetAlert2 sebelum aksi penting.'
  },
  {
    label: 'format-rupiah',
    detail: '[JS Helper] Intl.NumberFormat Mata Uang IDR',
    body: "new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(${1:nominal})",
    doc: 'Memformat angka menjadi format Rupiah (`Rp 1.500.000`).'
  }
];

const JS_GLOBALS: Array<{ name: string; detail: string; insertText?: string; isSnippet?: boolean }> = [
  { name: 'document', detail: 'DOM Document Global' },
  { name: 'window', detail: 'Browser Window Global' },
  { name: 'console', detail: 'Console Debugging API' },
  { name: 'fetch', detail: 'Fetch HTTP Request API', insertText: "fetch('${1:url}')", isSnippet: true },
  { name: 'FormData', detail: 'Multipart Form Payload Builder', insertText: 'new FormData(${1:formEl})', isSnippet: true },
  { name: 'URLSearchParams', detail: 'URL Query String Builder', insertText: 'new URLSearchParams(${1:window.location.search})', isSnippet: true },
  { name: 'JSON', detail: 'JSON Parser & Serializer' },
  { name: 'localStorage', detail: 'Browser Local Storage' },
  { name: 'sessionStorage', detail: 'Browser Session Storage' },
  { name: 'setTimeout', detail: 'Timer Sekali Jalan', insertText: 'setTimeout(() => {\n\t$0\n}, ${1:300})', isSnippet: true },
  { name: 'setInterval', detail: 'Timer Berulang', insertText: 'setInterval(() => {\n\t$0\n}, ${1:1000})', isSnippet: true },
  { name: 'Promise', detail: 'ES6 Promise API' },
  { name: 'Intl', detail: 'Internationalization Formatting API' },
  { name: 'Math', detail: 'Fungsi Matematika Bawaan' },
  { name: 'Date', detail: 'Tanggal & Waktu JavaScript' },
  { name: 'parseInt', detail: 'Konversi String ke Bilangan Bulat', insertText: 'parseInt(${1:str}, 10)', isSnippet: true },
  { name: 'parseFloat', detail: 'Konversi String ke Angka Desimal', insertText: 'parseFloat(${1:str})', isSnippet: true },
  { name: 'encodeURIComponent', detail: 'Escape Parameter Query URL', insertText: 'encodeURIComponent(${1:val})', isSnippet: true },
  { name: '$', detail: 'jQuery Selector / AJAX (`$(...)` & `$.ajax`)' },
  { name: 'jQuery', detail: 'jQuery Global Object' },
  { name: 'Swal', detail: 'SweetAlert2 Dialog API' },
  { name: 'axios', detail: 'Axios HTTP Client' },
  { name: 'alert', detail: 'Dialog Peringatan Browser', insertText: "alert('${1:Pesan}')", isSnippet: true },
  { name: 'confirm', detail: 'Dialog Konfirmasi Ya/Batal Browser', insertText: "confirm('${1:Yakin ingin menghapus data ini?}')", isSnippet: true }
];

// ============================================================================
// CURATED CSS PROPERTIES, VALUES & BOOTSTRAP / UTILITY CLASSES
// ============================================================================

const CSS_PROPERTIES: CssPropertySpec[] = [
  { name: 'display', values: ['flex', 'grid', 'inline-flex', 'block', 'inline-block', 'none', 'table', 'contents'], doc: 'Mengatur jenis kotak tata letak elemen (`flex`, `grid`, `block`, `none`).' },
  { name: 'flex-direction', values: ['row', 'column', 'row-reverse', 'column-reverse'], doc: 'Arah sumbu utama Flexbox.' },
  { name: 'justify-content', values: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'], doc: 'Perataan item sepanjang sumbu utama Flexbox/Grid.' },
  { name: 'align-items', values: ['stretch', 'center', 'flex-start', 'flex-end', 'baseline'], doc: 'Perataan item sepanjang sumbu silang Flexbox/Grid.' },
  { name: 'flex-wrap', values: ['nowrap', 'wrap', 'wrap-reverse'], doc: 'Mengatur apakah item flex boleh turun baris.' },
  { name: 'flex', values: ['1', '1 1 auto', '0 0 auto', 'none'], doc: 'Shorthand `flex-grow`, `flex-shrink`, dan `flex-basis`.' },
  { name: 'gap', values: ['4px', '8px', '12px', '16px', '24px', '0.5rem', '1rem'], doc: 'Jarak antar baris dan kolom pada Flex/Grid.' },
  { name: 'grid-template-columns', values: ['1fr 1fr', 'repeat(3, 1fr)', 'repeat(auto-fit, minmax(220px, 1fr))', '240px 1fr'], doc: 'Struktur kolom CSS Grid.' },
  { name: 'position', values: ['relative', 'absolute', 'fixed', 'sticky', 'static'], doc: 'Metode penempatan posisi elemen.' },
  { name: 'top', values: ['0', '50%', 'auto', '8px'], doc: 'Jarak dari tepi atas induk berposisi.' },
  { name: 'right', values: ['0', 'auto', '8px'], doc: 'Jarak dari tepi kanan.' },
  { name: 'bottom', values: ['0', 'auto', '8px'], doc: 'Jarak dari tepi bawah.' },
  { name: 'left', values: ['0', '50%', 'auto', '8px'], doc: 'Jarak dari tepi kiri.' },
  { name: 'inset', values: ['0', 'auto'], doc: 'Shorthand `top`, `right`, `bottom`, `left`.' },
  { name: 'z-index', values: ['1', '10', '100', '999', '1050'], doc: 'Urutan tumpukan lapisan elemen.' },
  { name: 'width', values: ['100%', 'auto', 'fit-content', 'max-content', '100vw'], doc: 'Lebar elemen.' },
  { name: 'min-width', values: ['0', '100%', '200px'], doc: 'Lebar minimum elemen.' },
  { name: 'max-width', values: ['100%', '1200px', '960px', '640px', 'none'], doc: 'Lebar maksimum elemen.' },
  { name: 'height', values: ['100%', 'auto', '100vh', 'fit-content'], doc: 'Tinggi elemen.' },
  { name: 'min-height', values: ['0', '100%', '100vh'], doc: 'Tinggi minimum elemen.' },
  { name: 'max-height', values: ['100%', '80vh', '400px', 'none'], doc: 'Tinggi maksimum elemen.' },
  { name: 'padding', values: ['0', '4px 8px', '8px 12px', '12px 16px', '16px', '1rem'], doc: 'Ruang dalam di sekeliling konten.' },
  { name: 'padding-top', values: ['4px', '8px', '12px', '16px'], doc: 'Ruang dalam atas.' },
  { name: 'padding-right', values: ['4px', '8px', '12px', '16px'], doc: 'Ruang dalam kanan.' },
  { name: 'padding-bottom', values: ['4px', '8px', '12px', '16px'], doc: 'Ruang dalam bawah.' },
  { name: 'padding-left', values: ['4px', '8px', '12px', '16px'], doc: 'Ruang dalam kiri.' },
  { name: 'margin', values: ['0', '0 auto', '8px 0', '12px 0', '16px', 'auto'], doc: 'Ruang luar di sekeliling batas elemen.' },
  { name: 'margin-top', values: ['0', '4px', '8px', '12px', '16px', 'auto'], doc: 'Ruang luar atas.' },
  { name: 'margin-bottom', values: ['0', '4px', '8px', '12px', '16px'], doc: 'Ruang luar bawah.' },
  { name: 'margin-left', values: ['0', '8px', 'auto'], doc: 'Ruang luar kiri.' },
  { name: 'margin-right', values: ['0', '8px', 'auto'], doc: 'Ruang luar kanan.' },
  { name: 'box-sizing', values: ['border-box', 'content-box'], doc: 'Cara menghitung total lebar dan tinggi elemen.' },
  { name: 'border', values: ['1px solid #cbd5e1', '1px solid rgba(148, 163, 184, 0.25)', 'none'], doc: 'Garis tepi elemen (`lebar gaya warna`).' },
  { name: 'border-top', values: ['1px solid #e2e8f0', 'none'], doc: 'Garis tepi atas.' },
  { name: 'border-bottom', values: ['1px solid #e2e8f0', 'none'], doc: 'Garis tepi bawah.' },
  { name: 'border-radius', values: ['4px', '6px', '8px', '12px', '9999px', '50%'], doc: 'Kelengkungan sudut elemen.' },
  { name: 'border-collapse', values: ['collapse', 'separate'], doc: 'Penggabungan garis batas sel `<table>`.' },
  { name: 'background', values: ['transparent', '#ffffff', '#0f172a', 'linear-gradient(135deg, #0ea5e9, #2563eb)'], doc: 'Shorthand latar belakang elemen.' },
  { name: 'background-color', values: ['transparent', '#ffffff', '#f8fafc', '#0f172a', 'rgba(0, 0, 0, 0.5)'], doc: 'Warna latar belakang elemen.' },
  { name: 'color', values: ['inherit', '#0f172a', '#334155', '#64748b', '#ffffff', '#ef4444', '#10b981'], doc: 'Warna teks elemen.' },
  { name: 'font-family', values: ['inherit', "'Inter', system-ui, sans-serif", "'JetBrains Mono', monospace"], doc: 'Keluarga huruf teks.' },
  { name: 'font-size', values: ['11px', '12px', '13px', '14px', '16px', '0.875rem', '1rem', '1.25rem'], doc: 'Ukuran huruf teks.' },
  { name: 'font-weight', values: ['400', '500', '600', '700', 'bold', 'normal'], doc: 'Ketebalan huruf teks.' },
  { name: 'line-height', values: ['1', '1.25', '1.5', '1.65'], doc: 'Tinggi baris teks.' },
  { name: 'text-align', values: ['left', 'center', 'right', 'justify'], doc: 'Perataan horizontal teks.' },
  { name: 'text-decoration', values: ['none', 'underline', 'line-through'], doc: 'Dekorasi garis teks.' },
  { name: 'text-transform', values: ['uppercase', 'lowercase', 'capitalize', 'none'], doc: 'Transformasi huruf besar/kecil.' },
  { name: 'white-space', values: ['nowrap', 'normal', 'pre', 'pre-wrap', 'pre-line'], doc: 'Perlakuan spasi dan pemotongan baris teks.' },
  { name: 'text-overflow', values: ['ellipsis', 'clip'], doc: 'Tampilan saat teks melampaui batas (`ellipsis` = `...`).' },
  { name: 'overflow', values: ['hidden', 'auto', 'scroll', 'visible'], doc: 'Perilaku saat konten melebihi ukuran kotak.' },
  { name: 'overflow-x', values: ['hidden', 'auto', 'scroll'], doc: 'Overflow arah horizontal.' },
  { name: 'overflow-y', values: ['hidden', 'auto', 'scroll'], doc: 'Overflow arah vertikal.' },
  { name: 'box-shadow', values: ['0 1px 3px rgba(0, 0, 0, 0.12)', '0 4px 14px rgba(0, 0, 0, 0.2)', '0 10px 30px rgba(0, 0, 0, 0.35)', 'none'], doc: 'Bayangan kotak elemen.' },
  { name: 'opacity', values: ['1', '0.85', '0.6', '0.4', '0'], doc: 'Tingkat transparansi elemen (`0` - `1`).' },
  { name: 'cursor', values: ['pointer', 'default', 'grab', 'not-allowed', 'text', 'crosshair'], doc: 'Bentuk kursor mouse saat diarahkan ke elemen.' },
  { name: 'transition', values: ['all 0.2s ease', 'background-color 0.15s ease, border-color 0.15s ease', 'transform 0.2s ease', 'none'], doc: 'Animasi transisi halus antar perubahan properti CSS.' },
  { name: 'transform', values: ['translateY(-1px)', 'translate(-50%, -50%)', 'scale(0.98)', 'rotate(180deg)', 'none'], doc: 'Transformasi 2D/3D posisi, skala, atau rotasi.' },
  { name: 'pointer-events', values: ['auto', 'none'], doc: 'Mengatur apakah elemen merespons klik mouse.' },
  { name: 'user-select', values: ['none', 'text', 'all', 'auto'], doc: 'Mengatur apakah pengguna dapat memblok teks.' },
  { name: 'object-fit', values: ['cover', 'contain', 'fill', 'scale-down'], doc: 'Penyesuaian ukuran `<img>` atau `<video>` di dalam wadah.' },
  { name: 'vertical-align', values: ['middle', 'top', 'bottom', 'baseline'], doc: 'Perataan vertikal elemen inline atau sel `<td>`.' },
  { name: 'list-style', values: ['none', 'disc', 'decimal'], doc: 'Gaya penanda daftar `<ul>` / `<ol>`.' },
  { name: 'visibility', values: ['visible', 'hidden', 'collapse'], doc: 'Visibilitas elemen tanpa mengubah ruang tata letak.' },
  { name: 'backdrop-filter', values: ['blur(8px)', 'blur(12px)', 'none'], doc: 'Efek blur kaca (*glassmorphism*) pada latar belakang.' }
];

const CSS_PROP_MAP = new Map<string, CssPropertySpec>(
  CSS_PROPERTIES.map((p) => [p.name, p])
);

const POPULAR_UTILITY_CLASSES: Array<{ name: string; detail: string }> = [
  { name: 'container', detail: 'Bootstrap Container Responsif' },
  { name: 'container-fluid', detail: 'Bootstrap Container Lebar Penuh 100%' },
  { name: 'row', detail: 'Bootstrap Grid Row' },
  { name: 'col', detail: 'Bootstrap Grid Auto Column' },
  { name: 'col-md-12', detail: 'Bootstrap Column 12/12' },
  { name: 'col-md-6', detail: 'Bootstrap Column 6/12 (50%)' },
  { name: 'col-md-4', detail: 'Bootstrap Column 4/12 (33%)' },
  { name: 'col-md-3', detail: 'Bootstrap Column 3/12 (25%)' },
  { name: 'd-flex', detail: 'Display Flex' },
  { name: 'd-inline-flex', detail: 'Display Inline-Flex' },
  { name: 'd-none', detail: 'Display None (Sembunyikan)' },
  { name: 'd-block', detail: 'Display Block' },
  { name: 'justify-content-between', detail: 'Flex Justify Space-Between' },
  { name: 'justify-content-center', detail: 'Flex Justify Center' },
  { name: 'justify-content-end', detail: 'Flex Justify End' },
  { name: 'align-items-center', detail: 'Flex Align Items Center' },
  { name: 'flex-wrap', detail: 'Flex Wrap' },
  { name: 'gap-1', detail: 'Gap 0.25rem' },
  { name: 'gap-2', detail: 'Gap 0.5rem' },
  { name: 'gap-3', detail: 'Gap 1rem' },
  { name: 'btn', detail: 'Bootstrap Base Button' },
  { name: 'btn-primary', detail: 'Tombol Utama Biru' },
  { name: 'btn-secondary', detail: 'Tombol Sekunder Abu-abu' },
  { name: 'btn-success', detail: 'Tombol Sukses Hijau' },
  { name: 'btn-danger', detail: 'Tombol Hapus / Bahaya Merah' },
  { name: 'btn-warning', detail: 'Tombol Peringatan Kuning' },
  { name: 'btn-info', detail: 'Tombol Info Biru Muda' },
  { name: 'btn-outline-primary', detail: 'Tombol Garis Biru' },
  { name: 'btn-sm', detail: 'Ukuran Tombol Kecil' },
  { name: 'form-control', detail: 'Input Teks / Textarea Bootstrap' },
  { name: 'form-select', detail: 'Dropdown <select> Bootstrap' },
  { name: 'form-check', detail: 'Wadah Checkbox / Radio' },
  { name: 'form-check-input', detail: 'Input Checkbox / Radio' },
  { name: 'form-label', detail: 'Label Input Form' },
  { name: 'input-group', detail: 'Grup Input + Addon Tombol' },
  { name: 'table', detail: 'Tabel Bootstrap' },
  { name: 'table-bordered', detail: 'Tabel Bergaris Penuh' },
  { name: 'table-striped', detail: 'Tabel Belang Selang-seling' },
  { name: 'table-hover', detail: 'Tabel Sorot Baris Saat Hover' },
  { name: 'table-sm', detail: 'Tabel Padat Ringkas' },
  { name: 'table-responsive', detail: 'Pembungkus Tabel Scroll Horizontal' },
  { name: 'card', detail: 'Kartu Kontainer' },
  { name: 'card-header', detail: 'Kepala Kartu' },
  { name: 'card-body', detail: 'Isi Kartu' },
  { name: 'card-footer', detail: 'Kaki Kartu' },
  { name: 'modal', detail: 'Jendela Dialog Modal' },
  { name: 'modal-dialog', detail: 'Dialog Modal' },
  { name: 'modal-content', detail: 'Konten Modal' },
  { name: 'modal-header', detail: 'Header Modal' },
  { name: 'modal-body', detail: 'Body Modal' },
  { name: 'modal-footer', detail: 'Footer Modal' },
  { name: 'alert', detail: 'Kotak Pesan Peringatan' },
  { name: 'alert-success', detail: 'Alert Hijau Sukses' },
  { name: 'alert-danger', detail: 'Alert Merah Error' },
  { name: 'alert-warning', detail: 'Alert Kuning Peringatan' },
  { name: 'badge', detail: 'Lencana Status Kecil' },
  { name: 'bg-primary', detail: 'Latar Biru Utama' },
  { name: 'bg-success', detail: 'Latar Hijau Sukses' },
  { name: 'bg-danger', detail: 'Latar Merah' },
  { name: 'bg-warning', detail: 'Latar Kuning' },
  { name: 'text-center', detail: 'Rata Tengah Teks' },
  { name: 'text-end', detail: 'Rata Kanan Teks' },
  { name: 'text-muted', detail: 'Warna Teks Redup' },
  { name: 'text-danger', detail: 'Warna Teks Merah' },
  { name: 'text-success', detail: 'Warna Teks Hijau' },
  { name: 'fw-bold', detail: 'Huruf Tebal (Bold)' },
  { name: 'w-100', detail: 'Lebar Penuh 100%' },
  { name: 'mt-2', detail: 'Margin Atas 0.5rem' },
  { name: 'mt-3', detail: 'Margin Atas 1rem' },
  { name: 'mb-2', detail: 'Margin Bawah 0.5rem' },
  { name: 'mb-3', detail: 'Margin Bawah 1rem' },
  { name: 'p-2', detail: 'Padding 0.5rem' },
  { name: 'p-3', detail: 'Padding 1rem' },
  { name: 'shadow-sm', detail: 'Bayangan Halus' },
  { name: 'rounded', detail: 'Sudut Membulat' }
];

function extractLocalScriptVariables(textBeforeCursor: string): string[] {
  const lastScriptIdx = textBeforeCursor.toLowerCase().lastIndexOf('<script');
  const slice = lastScriptIdx >= 0 ? textBeforeCursor.slice(lastScriptIdx) : textBeforeCursor;
  const vars = new Set<string>();

  for (const m of slice.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    vars.add(m[1]);
  }
  for (const fm of slice.matchAll(/\bfunction(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/g)) {
    for (const p of fm[1].split(',')) {
      const clean = p.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(clean)) vars.add(clean);
    }
  }
  return Array.from(vars);
}

function buildDomSelectorCompletions(
  catalog: WebSymbolCatalog,
  selectorKind: 'id' | 'class' | 'css',
  typedPrefix: string,
  position: monaco.Position
): monaco.languages.CompletionItem[] {
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: Math.max(1, position.column - typedPrefix.length),
    endColumn: position.column
  };
  const items: monaco.languages.CompletionItem[] = [];

  if (selectorKind === 'id' || selectorKind === 'css') {
    for (const hid of catalog.htmlIds) {
      const insertVal = selectorKind === 'css' ? `#${hid.id}` : hid.id;
      items.push({
        label: {
          label: insertVal,
          description: hid.tagName ? `<${hid.tagName}>` : hid.relativePath
        },
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: `★ [HTML #id] ${hid.relativePath ?? ''}${hid.line ? `:${hid.line}` : ''}`,
        documentation: `Elemen \`<${hid.tagName ?? 'div'} id="${hid.id}">\` di \`${hid.relativePath ?? 'file aktif'}\`.`,
        insertText: insertVal,
        filterText: `${hid.id} #${hid.id}`,
        sortText: `00_id_${hid.id}`,
        range
      });
    }
  }

  if (selectorKind === 'class' || selectorKind === 'css') {
    for (const cc of catalog.cssClasses) {
      const insertVal = selectorKind === 'css' ? `.${cc.name}` : cc.name;
      items.push({
        label: {
          label: insertVal,
          description: cc.relativePath ?? 'CSS'
        },
        kind: monaco.languages.CompletionItemKind.Class,
        detail: `★ [CSS Class] ${cc.declarationsPreview ?? cc.relativePath ?? ''}`,
        documentation: cc.declarationsPreview
          ? { value: `\`\`\`css\n.${cc.name} {\n  ${cc.declarationsPreview.replace(/;\s*/g, ';\n  ').trim()}\n}\n\`\`\`\nSumber: \`${cc.relativePath ?? 'style'}\`` }
          : undefined,
        insertText: insertVal,
        filterText: `${cc.name} .${cc.name}`,
        sortText: `01_cls_${cc.name}`,
        range
      });
    }
  }

  return items;
}

function buildHtmlClassCompletions(
  catalog: WebSymbolCatalog,
  typedPrefix: string,
  position: monaco.Position
): monaco.languages.CompletionItem[] {
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: Math.max(1, position.column - typedPrefix.length),
    endColumn: position.column
  };
  const seen = new Set<string>();
  const items: monaco.languages.CompletionItem[] = [];

  for (const cc of catalog.cssClasses) {
    seen.add(cc.name);
    items.push({
      label: {
        label: cc.name,
        description: cc.fromStylesheet ? cc.relativePath ?? 'CSS Proyek' : 'HTML Proyek'
      },
      kind: cc.colorHex
        ? monaco.languages.CompletionItemKind.Color
        : monaco.languages.CompletionItemKind.Class,
      detail: cc.declarationsPreview
        ? `★ [CSS Proyek] ${cc.declarationsPreview}`
        : `[Class Proyek] ${cc.relativePath ?? ''}`,
      documentation: cc.declarationsPreview
        ? {
            value: `\`\`\`css\n.${cc.name} {\n  ${cc.declarationsPreview.replace(/;\s*/g, ';\n  ').trim()}\n}\n\`\`\`\nSumber: \`${cc.relativePath ?? 'stylesheet'}\` (baris ${cc.line})`
          }
        : cc.colorHex,
      insertText: cc.name,
      sortText: cc.fromStylesheet ? `00_0_${cc.name}` : `00_1_${cc.name}`,
      range
    });
  }

  for (const util of POPULAR_UTILITY_CLASSES) {
    if (seen.has(util.name)) continue;
    items.push({
      label: { label: util.name, description: 'Utility / Bootstrap' },
      kind: monaco.languages.CompletionItemKind.Constant,
      detail: `[CSS Utility] ${util.detail}`,
      insertText: util.name,
      sortText: `01_${util.name}`,
      range
    });
  }

  return items;
}

function buildCssCompletions(
  catalog: WebSymbolCatalog,
  cssSubKind: 'selector' | 'property' | 'value',
  activeCssProperty: string | undefined,
  typedPrefix: string,
  linePrefix: string,
  isInlineAttr: boolean,
  position: monaco.Position
): monaco.languages.CompletionItem[] {
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: Math.max(1, position.column - typedPrefix.length),
    endColumn: position.column
  };
  const items: monaco.languages.CompletionItem[] = [];

  // Check if user is typing `var(--...)`
  const varCallMatch = linePrefix.match(/\bvar\(\s*(--[A-Za-z0-9_-]*|[A-Za-z0-9_-]*)$/);
  if (varCallMatch) {
    const varRange: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: Math.max(1, position.column - varCallMatch[1].length),
      endColumn: position.column
    };
    return catalog.cssVariables.map((cv) => ({
      label: { label: cv.name, description: cv.value },
      kind: cv.colorHex
        ? monaco.languages.CompletionItemKind.Color
        : monaco.languages.CompletionItemKind.Variable,
      detail: `★ [CSS Variable] ${cv.value} (${cv.relativePath ?? ''})`,
      documentation: cv.colorHex ?? `Variabel CSS \`${cv.name}: ${cv.value}\``,
      insertText: cv.name,
      sortText: `00_${cv.name}`,
      range: varRange
    }));
  }

  if (cssSubKind === 'selector' && !isInlineAttr) {
    // Suggest project classes (`.nama`), HTML IDs (`#id`), and CSS `@media` / `:hover`
    for (const hid of catalog.htmlIds) {
      const sel = `#${hid.id}`;
      items.push({
        label: { label: sel, description: `<${hid.tagName ?? 'el'}>` },
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: `[Selector ID HTML] ${hid.relativePath ?? ''}`,
        insertText: `${sel} {\n\t$0\n}`,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        filterText: `${sel} ${hid.id}`,
        sortText: `00_id_${hid.id}`,
        range
      });
    }
    for (const cc of catalog.cssClasses) {
      const sel = `.${cc.name}`;
      items.push({
        label: { label: sel, description: cc.relativePath ?? 'class' },
        kind: monaco.languages.CompletionItemKind.Class,
        detail: `[Selector Class] ${cc.declarationsPreview ?? ''}`,
        insertText: `${sel} {\n\t$0\n}`,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        filterText: `${sel} ${cc.name}`,
        sortText: `00_cls_${cc.name}`,
        range
      });
    }
    items.push(
      {
        label: '@media (max-width: 768px)',
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: '[CSS Responsive] Media Query Layar Mobile/Tablet',
        insertText: '@media (max-width: ${1:768px}) {\n\t$0\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '01_media',
        range
      },
      {
        label: '@keyframes',
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: '[CSS Animation] Definisi Animasi Keyframes',
        insertText: '@keyframes ${1:fadeIn} {\n\tfrom { opacity: 0; }\n\tto { opacity: 1; }\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '01_keyframes',
        range
      }
    );
    return items;
  }

  if (cssSubKind === 'value') {
    const spec = activeCssProperty ? CSS_PROP_MAP.get(activeCssProperty) : undefined;
    for (const val of spec?.values ?? ['inherit', 'initial', 'unset', 'none', 'auto']) {
      items.push({
        label: val,
        kind: monaco.languages.CompletionItemKind.Value,
        detail: activeCssProperty ? `[Nilai ${activeCssProperty}]` : '[Nilai CSS]',
        insertText: val,
        sortText: `00_val_${val}`,
        range
      });
    }
    for (const cv of catalog.cssVariables) {
      items.push({
        label: { label: `var(${cv.name})`, description: cv.value },
        kind: cv.colorHex
          ? monaco.languages.CompletionItemKind.Color
          : monaco.languages.CompletionItemKind.Variable,
        detail: `★ [CSS Variable] ${cv.value}`,
        documentation: cv.colorHex ?? `${cv.name}: ${cv.value}`,
        insertText: `var(${cv.name})`,
        filterText: `var ${cv.name}`,
        sortText: `01_var_${cv.name}`,
        range
      });
    }
    return items;
  }

  // `cssSubKind === 'property'`
  for (const prop of CSS_PROPERTIES) {
    const firstHint = prop.values?.[0] ?? '';
    items.push({
      label: { label: prop.name, description: firstHint ? `mis. ${firstHint}` : undefined },
      kind: monaco.languages.CompletionItemKind.Property,
      detail: `[CSS Property] ${prop.doc}`,
      documentation: prop.values
        ? { value: `${prop.doc}\n\nNilai populer: \`${prop.values.join('` | `')}\`` }
        : prop.doc,
      insertText: isInlineAttr ? `${prop.name}: $1;` : `${prop.name}: $1;`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      command: { id: 'editor.action.triggerSuggest', title: 'Pilih Nilai CSS' },
      sortText: `00_prop_${prop.name}`,
      range
    });
  }

  return items;
}

function buildEmbeddedJsCompletions(
  catalog: WebSymbolCatalog,
  textBeforeCursor: string,
  linePrefix: string,
  position: monaco.Position,
  isEmbeddedInPhpOrHtml: boolean
): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = [];

  // 1. Check dot-member access: `document.|`, `$.|`, `$('...').|`, `Swal.|`, `el.|`
  const jqSelectorDot = linePrefix.match(/(?:\$|jQuery)\s*\([^)]*\)\s*\.\s*([A-Za-z_$0-9]*)$/);
  if (jqSelectorDot) {
    const typed = jqSelectorDot[1];
    const range: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column - typed.length,
      endColumn: position.column
    };
    return JQUERY_INSTANCE_MEMBERS.map((m) => ({
      label: { label: m.name, description: 'jQuery' },
      kind:
        m.kind === 'method'
          ? monaco.languages.CompletionItemKind.Method
          : monaco.languages.CompletionItemKind.Property,
      detail: `[jQuery] ${m.signature ?? m.name}`,
      documentation: m.doc,
      insertText: m.insertText ?? m.name,
      insertTextRules: m.isSnippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      sortText: `00_jq_${m.name}`,
      range
    }));
  }

  const objDotMatch = linePrefix.match(
    /(?:window\.)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_$0-9]*)$/
  );
  if (objDotMatch) {
    const receiver = objDotMatch[1];
    const typed = objDotMatch[2];
    const range: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column - typed.length,
      endColumn: position.column
    };

    const curated = JS_OBJECT_MEMBERS[receiver];
    if (curated) {
      return curated.map((m) => ({
        label: { label: m.name, description: receiver },
        kind:
          m.kind === 'method'
            ? monaco.languages.CompletionItemKind.Method
            : monaco.languages.CompletionItemKind.Property,
        detail: `[${receiver}] ${m.signature ?? m.name}`,
        documentation: m.doc,
        insertText: m.insertText ?? m.name,
        insertTextRules: m.isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        sortText: `00_obj_${m.name}`,
        range
      }));
    }

    // Check if `receiver` matches a user-defined JS Class static/instance or fallback DOM/Array/Promise members (when inside PHP/HTML `<script>`)
    const userCls = catalog.jsClasses.find((c) => c.name === receiver);
    if (userCls) {
      return userCls.methods.map((m) => ({
        label: { label: m.name, description: userCls.name },
        kind: monaco.languages.CompletionItemKind.Method,
        detail: `[JS Class ${userCls.name}] (${m.params.join(', ')})`,
        insertText: `${m.name}(${m.params.map((p, idx) => `\${${idx + 1}:${p}}`).join(', ')})`,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: `00_ucls_${m.name}`,
        range
      }));
    }

    if (isEmbeddedInPhpOrHtml) {
      return [...GENERIC_DOM_AND_JS_MEMBERS, ...JQUERY_INSTANCE_MEMBERS].map((m, idx) => ({
        label: m.name,
        kind:
          m.kind === 'method'
            ? monaco.languages.CompletionItemKind.Method
            : monaco.languages.CompletionItemKind.Property,
        detail: m.signature ?? 'DOM / JS Member',
        documentation: m.doc,
        insertText: m.insertText ?? m.name,
        insertTextRules: m.isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        sortText: `01_${String(idx).padStart(3, '0')}_${m.name}`,
        range
      }));
    }

    // In standalone `.js`/`.ts`, let `ts.worker` handle general dot access cleanly
    return [];
  }

  // 2. Top-level JS completions
  const wordMatch = linePrefix.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
  const typedWord = wordMatch?.[1] ?? '';
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: position.column - typedWord.length,
    endColumn: position.column
  };

  // 2a. User-defined Project JS Functions & Classes (useful in BOTH `<script>` AND standalone `.js`!)
  for (const fn of catalog.jsFunctions) {
    const paramSnippet = fn.params
      .map((p, idx) => `\${${idx + 1}:${p.replace(/^\.\.\./, '')}}`)
      .join(', ');
    items.push({
      label: {
        label: fn.name,
        description: fn.relativePath ?? 'JS Proyek'
      },
      kind: monaco.languages.CompletionItemKind.Function,
      detail: `★ [JS Proyek] ${fn.isAsync ? 'async ' : ''}${fn.name}(${fn.params.join(', ')})`,
      documentation: fn.doc
        ? { value: `${fn.doc}\n\nSumber: \`${fn.relativePath ?? 'script'}\` (baris ${fn.line})` }
        : `Fungsi JavaScript proyek di \`${fn.relativePath ?? 'script'}\` (baris ${fn.line}).`,
      insertText: `${fn.name}(${paramSnippet})`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `00_0fn_${fn.name}`,
      range
    });
  }

  for (const cls of catalog.jsClasses) {
    items.push({
      label: { label: cls.name, description: cls.relativePath ?? 'JS Class' },
      kind: monaco.languages.CompletionItemKind.Class,
      detail: `★ [JS Class Proyek] ${cls.name} (${cls.methods.length} method)`,
      documentation: cls.doc,
      insertText: cls.name,
      sortText: `00_1cls_${cls.name}`,
      range
    });
  }

  // 2b. Curated JS/jQuery/SweetAlert2 Snippets
  for (const sn of JS_TOP_SNIPPETS) {
    items.push({
      label: sn.label,
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: sn.detail,
      documentation: sn.doc,
      insertText: sn.body,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `01_snip_${sn.label}`,
      range
    });
  }

  // 2c. Inside `<script>` / `onclick="..."` in PHP/HTML (where `ts.worker` is not active), also provide JS globals + local script variables!
  if (isEmbeddedInPhpOrHtml) {
    for (const lv of extractLocalScriptVariables(textBeforeCursor)) {
      items.push({
        label: lv,
        kind: monaco.languages.CompletionItemKind.Variable,
        detail: '[Variabel <script> Lokal]',
        insertText: lv,
        sortText: `00_2var_${lv}`,
        range
      });
    }

    for (const g of JS_GLOBALS) {
      items.push({
        label: g.name,
        kind: monaco.languages.CompletionItemKind.Variable,
        detail: `[JS / Web API] ${g.detail}`,
        insertText: g.insertText ?? g.name,
        insertTextRules: g.isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        sortText: `02_glob_${g.name}`,
        range
      });
    }
  }

  return items;
}

function parseHexToMonacoColor(hexRaw: string): monaco.languages.IColor | null {
  const clean = hexRaw.replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return { red: r, green: g, blue: b, alpha: 1 };
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
    return { red: r, green: g, blue: b, alpha: a };
  }
  return null;
}

function toHex2(channel01: number): string {
  return Math.round(Math.max(0, Math.min(1, channel01)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * Resolves `Ctrl+Klik` / `F12` navigation targets for:
 * 1. `<script src="js/app.js">` & `<link href="css/style.css">` & ES `import ... from './helper.js'`
 * 2. JavaScript `function` / `class` / `const fn = () =>` definitions across current file, open SFTP tabs, and workspace `.js`/`.ts` files
 * 3. CSS `.nama-class` and `--nama-variabel` definitions across `<style>` and `.css`/`.scss` files!
 */
export function resolveWebNavigationTarget(
  lineContent: string,
  column: number,
  wordAtCursor: string | null,
  fullSource: string,
  title = 'current'
): PhpNavigationTarget | null {
  // 1. `<script src="...">`, `<link href="...">`, or ES `import ... from '...'`
  for (const am of lineContent.matchAll(
    /(?:\b(?:src|href)\s*=\s*|\bfrom\s+)['"]([^'"?#]+\.(?:js|mjs|cjs|jsx|ts|tsx|css|scss|less))(?:\?[^'"]*)?['"]/gi
  )) {
    const startCol = (am.index ?? 0) + 1;
    const endCol = startCol + am[0].length;
    if (column >= startCol && column <= endCol + 1) {
      const rawPath = am[1].trim();
      if (!/^https?:\/\//i.test(rawPath) && !rawPath.startsWith('//')) {
        return { kind: 'include-rel', rawTarget: rawPath.replace(/^\//, '') };
      }
    }
  }

  const catalog = mergeWebSymbolCatalogs([
    extractWebSymbolsFromSource(fullSource, title),
    getCombinedWebCatalog()
  ]);

  // 2. Check if cursor is inside `class="..."` or `var(--...)` -> jump to CSS definition!
  const beforeCol = lineContent.slice(0, Math.max(0, column));
  const afterCol = lineContent.slice(Math.max(0, column));
  const dashedBefore = beforeCol.match(/(--[A-Za-z0-9_-]*|[A-Za-z0-9_-]*)$/)?.[1] ?? '';
  const dashedAfter = afterCol.match(/^([A-Za-z0-9_-]*)/)?.[1] ?? '';
  const fullDashedToken = `${dashedBefore}${dashedAfter}`;

  if (fullDashedToken.startsWith('--')) {
    const cssVar = catalog.cssVariables.find((v) => v.name === fullDashedToken);
    if (cssVar) {
      if (!cssVar.filePath || cssVar.relativePath === title) {
        return { kind: 'same-file', line: cssVar.line, label: cssVar.name };
      }
      return {
        kind: 'symbol',
        symbolName: cssVar.name,
        filePath: cssVar.filePath,
        relativePath: cssVar.relativePath,
        line: cssVar.line
      };
    }
  }

  if (/\bclass(?:Name)?\s*=\s*['"][^'"]*$/i.test(beforeCol) && fullDashedToken) {
    const cssCls = catalog.cssClasses.find(
      (c) => c.fromStylesheet && c.name === fullDashedToken
    );
    if (cssCls) {
      if (!cssCls.filePath || cssCls.relativePath === title) {
        return { kind: 'same-file', line: cssCls.line, label: `.${cssCls.name}` };
      }
      return {
        kind: 'symbol',
        symbolName: `.${cssCls.name}`,
        filePath: cssCls.filePath,
        relativePath: cssCls.relativePath,
        line: cssCls.line
      };
    }
  }

  // 3. JavaScript function or class navigation
  const token = wordAtCursor?.trim() || fullDashedToken;
  if (!token) return null;

  const jsFn: JsFunctionSymbol | undefined = catalog.jsFunctions.find((f) => f.name === token);
  if (jsFn) {
    if (!jsFn.filePath || jsFn.relativePath === title) {
      return { kind: 'same-file', line: jsFn.line, label: `function ${jsFn.name}()` };
    }
    return {
      kind: 'symbol',
      symbolName: `${jsFn.name}()`,
      filePath: jsFn.filePath,
      relativePath: jsFn.relativePath,
      line: jsFn.line
    };
  }

  const jsCls: JsClassSymbol | undefined = catalog.jsClasses.find((c) => c.name === token);
  if (jsCls) {
    if (!jsCls.filePath || jsCls.relativePath === title) {
      return { kind: 'same-file', line: jsCls.line, label: `class ${jsCls.name}` };
    }
    return {
      kind: 'symbol',
      symbolName: jsCls.name,
      filePath: jsCls.filePath,
      relativePath: jsCls.relativePath,
      line: jsCls.line
    };
  }

  return null;
}

/**
 * Registers full JavaScript, DOM, jQuery, & CSS/SCSS IntelliSense across:
 * - Mixed `.php` / `.blade.php` / `.html` (`<script>`, `<style>`, `style="..."`, `class="..."`, `onclick="..."`)
 * - Standalone `.js` / `.jsx` / `.ts` / `.tsx` & `.css` / `.scss` / `.less`
 */
export function registerWebIntelliSense(): void {
  if (registered) return;
  registered = true;

  const targetLangs = ['php', 'html', 'javascript', 'typescript', 'css', 'scss', 'less'];

  for (const lang of targetLangs) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', '#', ':', '"', "'", '/'],
      provideCompletionItems(model, position, context) {
        const isExplicitInvoke =
          context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
        const startLine = Math.max(1, position.lineNumber - 160);
        const textBefore = model.getValueInRange({
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const linePrefix = model
          .getLineContent(position.lineNumber)
          .slice(0, position.column - 1);

        const sub = detectWebSubContext(textBefore, linePrefix, lang);
        if (sub.region === 'php' || sub.region === 'html-markup') {
          return { suggestions: [] };
        }

        const catalog = getCombinedWebCatalog(model);

        if (sub.region === 'asset-path') {
          const typed = sub.typedPrefix ?? '';
          const range: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: Math.max(1, position.column - typed.length),
            endColumn: position.column
          };
          const list = sub.assetKind === 'js' ? catalog.jsFiles : catalog.cssFiles;
          return {
            suggestions: list.map((rel) => ({
              label: rel,
              kind: monaco.languages.CompletionItemKind.File,
              detail: `[File ${sub.assetKind?.toUpperCase()} Proyek]`,
              insertText: rel,
              sortText: `00_${rel}`,
              range
            }))
          };
        }

        if (sub.region === 'html-class') {
          return {
            suggestions: buildHtmlClassCompletions(catalog, sub.typedPrefix ?? '', position)
          };
        }

        if (sub.region === 'html-id') {
          return {
            suggestions: buildDomSelectorCompletions(
              catalog,
              'id',
              sub.typedPrefix ?? '',
              position
            )
          };
        }

        if (sub.region === 'dom-selector') {
          return {
            suggestions: buildDomSelectorCompletions(
              catalog,
              sub.selectorKind ?? 'css',
              sub.typedPrefix ?? '',
              position
            )
          };
        }

        if (sub.region === 'css-block' || sub.region === 'css-inline') {
          if (
            !isExplicitInvoke &&
            context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter &&
            (context.triggerCharacter === '"' ||
              context.triggerCharacter === "'" ||
              context.triggerCharacter === '/')
          ) {
            return { suggestions: [] };
          }
          // For standalone `.css`/`.scss`/`.less`, Monaco's native `css.worker` already provides standard properties;
          // we still enrich with project `--css-vars`, project `.classes` / `#ids` selectors!
          if (lang === 'css' || lang === 'scss' || lang === 'less') {
            if (sub.cssSubKind === 'selector') {
              return {
                suggestions: buildCssCompletions(
                  catalog,
                  'selector',
                  undefined,
                  sub.typedPrefix ?? '',
                  linePrefix,
                  false,
                  position
                )
              };
            }
            if (/\bvar\(\s*[A-Za-z0-9_-]*$/.test(linePrefix) || sub.cssSubKind === 'value') {
              return {
                suggestions: catalog.cssVariables.map((cv) => ({
                  label: {
                    label: /\bvar\(/.test(linePrefix) ? cv.name : `var(${cv.name})`,
                    description: cv.value
                  },
                  kind: cv.colorHex
                    ? monaco.languages.CompletionItemKind.Color
                    : monaco.languages.CompletionItemKind.Variable,
                  detail: `★ [CSS Variable Proyek] ${cv.value}`,
                  documentation: cv.colorHex ?? `${cv.name}: ${cv.value}`,
                  insertText: /\bvar\(/.test(linePrefix) ? cv.name : `var(${cv.name})`,
                  sortText: `00_${cv.name}`,
                  range: {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: Math.max(1, position.column - (sub.typedPrefix?.length ?? 0)),
                    endColumn: position.column
                  }
                }))
              };
            }
            return { suggestions: [] };
          }

          // Inside `<style>` or `style="..."` in `.php` / `.html`: provide FULL CSS IntelliSense!
          return {
            suggestions: buildCssCompletions(
              catalog,
              sub.cssSubKind ?? 'property',
              sub.activeCssProperty,
              sub.typedPrefix ?? '',
              linePrefix,
              sub.region === 'css-inline',
              position
            )
          };
        }

        if (sub.region === 'js' || sub.region === 'js-inline') {
          const isMemberDot = /\.\s*[A-Za-z_$0-9]*$/.test(linePrefix);
          const jsWord = model.getWordUntilPosition(position);
          if (!isExplicitInvoke && !isMemberDot && jsWord.word.length < 2) {
            return { suggestions: [] };
          }
          const isEmbedded = lang === 'php' || lang === 'html';
          return {
            suggestions: buildEmbeddedJsCompletions(
              catalog,
              textBefore,
              linePrefix,
              position,
              isEmbedded
            )
          };
        }

        return { suggestions: [] };
      }
    });
  }

  // Hover Documentation for CSS Classes, `--css-variables`, and Project JS Functions inside PHP / HTML / JS / CSS
  for (const hLang of ['php', 'html', 'javascript', 'typescript', 'css', 'scss']) {
    monaco.languages.registerHoverProvider(hLang, {
      provideHover(model, position) {
        const line = model.getLineContent(position.lineNumber);
        const before = line.slice(0, position.column - 1);
        const after = line.slice(position.column - 1);
        const leftPart = before.match(/(--[A-Za-z0-9_-]*|[A-Za-z0-9_$-]*)$/)?.[1] ?? '';
        const rightPart = after.match(/^([A-Za-z0-9_$-]*)/)?.[1] ?? '';
        const token = `${leftPart}${rightPart}`;
        if (!token) return null;

        const catalog = getCombinedWebCatalog(model);

        if (token.startsWith('--')) {
          const cv: CssVariableSymbol | undefined = catalog.cssVariables.find(
            (v) => v.name === token
          );
          if (cv) {
            return {
              contents: [
                { value: `**CSS Variable** \`${cv.name}\`` },
                { value: `\`\`\`css\n${cv.name}: ${cv.value};\n\`\`\`\nSumber: \`${cv.relativePath ?? 'stylesheet'}\` (baris ${cv.line})` }
              ]
            };
          }
        }

        // Hover over CSS class inside `class="..."`
        if (/\bclass(?:Name)?\s*=\s*['"][^'"]*$/i.test(before)) {
          const cc: CssClassSymbol | undefined = catalog.cssClasses.find(
            (c) => c.name === token && c.declarationsPreview
          );
          if (cc && cc.declarationsPreview) {
            return {
              contents: [
                { value: `**CSS Class** \`.${cc.name}\` (\`${cc.relativePath ?? 'style'}\`:${cc.line})` },
                {
                  value: `\`\`\`css\n.${cc.name} {\n  ${cc.declarationsPreview.replace(/;\s*/g, ';\n  ').trim()}\n}\n\`\`\``
                }
              ]
            };
          }
        }

        // Hover over Project JS Function inside `<script>` or `.js`
        const startLine = Math.max(1, position.lineNumber - 80);
        const textBefore = model.getValueInRange({
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const sub = detectWebSubContext(textBefore, before, hLang);
        if (sub.region === 'js' || sub.region === 'js-inline') {
          const fn = catalog.jsFunctions.find((f) => f.name === token);
          if (fn) {
            return {
              contents: [
                {
                  value: `\`\`\`javascript\n${fn.isAsync ? 'async ' : ''}function ${fn.name}(${fn.params.join(', ')})\n\`\`\``
                },
                {
                  value: `${fn.doc ? `${fn.doc}\n\n` : ''}Didefinisikan di \`${fn.relativePath ?? 'script'}\` (baris ${fn.line})`
                }
              ]
            };
          }
        }

        return null;
      }
    });
  }

  // Native Interactive Color Swatches & Color Picker inside `<style>` and `style="..."` of `.php` files!
  monaco.languages.registerColorProvider('php', {
    provideDocumentColors(model) {
      const code = model.getValue();
      const lineStarts = [0];
      for (let i = 0; i < code.length; i++) {
        if (code[i] === '\n') lineStarts.push(i + 1);
      }
      const offsetToPos = (off: number): { lineNumber: number; column: number } => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (lineStarts[mid] <= off) lo = mid + 1;
          else hi = mid - 1;
        }
        return { lineNumber: hi + 1, column: off - lineStarts[hi] + 1 };
      };

      const colors: monaco.languages.IColorInformation[] = [];
      const collectHexInSpan = (segment: string, baseOffset: number): void => {
        for (const hm of segment.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
          const parsed = parseHexToMonacoColor(hm[0]);
          if (!parsed) continue;
          const s = offsetToPos(baseOffset + (hm.index ?? 0));
          const e = offsetToPos(baseOffset + (hm.index ?? 0) + hm[0].length);
          colors.push({
            color: parsed,
            range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column)
          });
        }
      };

      for (const sm of code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
        const bodyOffset = (sm.index ?? 0) + sm[0].indexOf('>') + 1;
        collectHexInSpan(sm[1], bodyOffset);
      }
      for (const im of code.matchAll(/\bstyle\s*=\s*(['"])([^'"]*)\1/gi)) {
        const bodyOffset = (im.index ?? 0) + im[0].indexOf(im[2]);
        collectHexInSpan(im[2], bodyOffset);
      }

      return colors;
    },
    provideColorPresentations(_model, colorInfo) {
      const { red, green, blue, alpha } = colorInfo.color;
      const hex =
        alpha < 0.999
          ? `#${toHex2(red)}${toHex2(green)}${toHex2(blue)}${toHex2(alpha)}`
          : `#${toHex2(red)}${toHex2(green)}${toHex2(blue)}`;
      const rgb =
        alpha < 0.999
          ? `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${Number(alpha.toFixed(2))})`
          : `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
      return [{ label: hex }, { label: rgb }];
    }
  });

  scheduleAmbientExtraLibSync();
}
