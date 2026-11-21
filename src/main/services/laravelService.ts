import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import type {
  LaravelBladeDirectiveMeta,
  LaravelCatalog,
  LaravelConfigEntry,
  LaravelRouteEntry,
  LaravelValidationRuleMeta,
  LaravelViewEntry,
  PhpClassMemberMeta,
  PhpClassMeta,
  PhpFunctionMeta,
  PhpParamMeta
} from '@shared/types';

function p(
  name: string,
  type?: string,
  optional = false,
  defaultValue?: string
): PhpParamMeta {
  return { name, type, optional, defaultValue };
}

function m(
  name: string,
  params: PhpParamMeta[] = [],
  type?: string,
  doc?: string,
  isStatic = false
): PhpClassMemberMeta {
  return {
    name,
    kind: 'method',
    isStatic,
    params,
    type,
    doc
  };
}

function sm(
  name: string,
  params: PhpParamMeta[] = [],
  type?: string,
  doc?: string
): PhpClassMemberMeta {
  return m(name, params, type, doc, true);
}

function prop(name: string, type?: string, doc?: string, isStatic = false): PhpClassMemberMeta {
  return {
    name,
    kind: 'property',
    isStatic,
    type,
    doc
  };
}

function fn(
  name: string,
  params: PhpParamMeta[] = [],
  returnType?: string,
  doc?: string
): PhpFunctionMeta {
  return {
    name,
    params,
    returnType,
    doc,
    extension: 'laravel',
    origin: 'laravel'
  };
}

const QUERY_BUILDER_METHODS: PhpClassMemberMeta[] = [
  m('select', [p('...$columns', 'string|array', true)], 'EloquentBuilder', 'Pilih kolom tertentu pada query SQL.'),
  m('selectRaw', [p('$expression', 'string'), p('$bindings', 'array', true, '[]')], 'EloquentBuilder', 'Tambahkan ekspresi SELECT mentah dengan parameter binding.'),
  m('addSelect', [p('$column', 'string|array')], 'EloquentBuilder', 'Tambahkan kolom tambahan pada klausa SELECT.'),
  m('distinct', [], 'EloquentBuilder', 'Paksa query hanya mengembalikan baris unik (DISTINCT).'),
  m('from', [p('$table', 'string'), p('$as', 'string', true)], 'EloquentBuilder', 'Tentukan tabel sumber query.'),
  m('join', [p('$table', 'string'), p('$first', 'string'), p('$operator', 'string', true), p('$second', 'string', true)], 'EloquentBuilder', 'Tambahkan klausa INNER JOIN ke query.'),
  m('leftJoin', [p('$table', 'string'), p('$first', 'string'), p('$operator', 'string', true), p('$second', 'string', true)], 'EloquentBuilder', 'Tambahkan klausa LEFT JOIN ke query.'),
  m('rightJoin', [p('$table', 'string'), p('$first', 'string'), p('$operator', 'string', true), p('$second', 'string', true)], 'EloquentBuilder', 'Tambahkan klausa RIGHT JOIN ke query.'),
  m('crossJoin', [p('$table', 'string')], 'EloquentBuilder', 'Tambahkan klausa CROSS JOIN.'),
  m('where', [p('$column', 'string|array|Closure'), p('$operator', 'mixed', true), p('$value', 'mixed', true)], 'EloquentBuilder', 'Tambahkan kondisi WHERE dasar ke query.'),
  m('orWhere', [p('$column', 'string|array|Closure'), p('$operator', 'mixed', true), p('$value', 'mixed', true)], 'EloquentBuilder', 'Tambahkan kondisi OR WHERE ke query.'),
  m('whereNot', [p('$column', 'string|Closure'), p('$operator', 'mixed', true), p('$value', 'mixed', true)], 'EloquentBuilder', 'Tambahkan kondisi WHERE NOT ke query.'),
  m('whereIn', [p('$column', 'string'), p('$values', 'iterable')], 'EloquentBuilder', 'Filter kolom yang nilainya berada di dalam array/koleksi.'),
  m('whereNotIn', [p('$column', 'string'), p('$values', 'iterable')], 'EloquentBuilder', 'Filter kolom yang nilainya tidak berada di dalam array.'),
  m('whereNull', [p('$columns', 'string|array')], 'EloquentBuilder', 'Filter baris di mana kolom bernilai NULL.'),
  m('whereNotNull', [p('$columns', 'string|array')], 'EloquentBuilder', 'Filter baris di mana kolom TIDAK bernilai NULL.'),
  m('whereBetween', [p('$column', 'string'), p('$values', 'array')], 'EloquentBuilder', 'Filter kolom di antara dua nilai [min, max].'),
  m('whereNotBetween', [p('$column', 'string'), p('$values', 'array')], 'EloquentBuilder', 'Filter kolom di luar rentang dua nilai.'),
  m('whereDate', [p('$column', 'string'), p('$operator', 'string'), p('$value', 'string', true)], 'EloquentBuilder', 'Bandingkan tanggal (YYYY-MM-DD) dari kolom timestamp/datetime.'),
  m('whereMonth', [p('$column', 'string'), p('$operator', 'string'), p('$value', 'int|string', true)], 'EloquentBuilder', 'Bandingkan bulan dari kolom tanggal.'),
  m('whereDay', [p('$column', 'string'), p('$operator', 'string'), p('$value', 'int|string', true)], 'EloquentBuilder', 'Bandingkan hari dari kolom tanggal.'),
  m('whereYear', [p('$column', 'string'), p('$operator', 'string'), p('$value', 'int|string', true)], 'EloquentBuilder', 'Bandingkan tahun dari kolom tanggal.'),
  m('whereColumn', [p('$first', 'string'), p('$operator', 'string', true), p('$second', 'string', true)], 'EloquentBuilder', 'Bandingkan nilai dua kolom pada tabel.'),
  m('whereJsonContains', [p('$column', 'string'), p('$value', 'mixed')], 'EloquentBuilder', 'Filter kolom JSON yang mengandung nilai tertentu.'),
  m('whereRaw', [p('$sql', 'string'), p('$bindings', 'array', true, '[]')], 'EloquentBuilder', 'Tambahkan klausa WHERE SQL mentah menggunakan parameter binding aman.'),
  m('whereExists', [p('$callback', 'Closure')], 'EloquentBuilder', 'Filter berdasarkan subquery WHERE EXISTS.'),
  m('whereHas', [p('$relation', 'string'), p('$callback', 'Closure', true)], 'EloquentBuilder', 'Filter model berdasarkan keberadaan dan kondisi relasi Eloquent.'),
  m('orWhereHas', [p('$relation', 'string'), p('$callback', 'Closure', true)], 'EloquentBuilder', 'Tambahkan kondisi OR berdasarkan relasi Eloquent.'),
  m('whereDoesntHave', [p('$relation', 'string'), p('$callback', 'Closure', true)], 'EloquentBuilder', 'Filter model yang tidak memiliki relasi tertentu.'),
  m('with', [p('$relations', 'string|array')], 'EloquentBuilder', 'Eager load relasi Eloquent untuk mencegah masalah N+1 query.'),
  m('without', [p('$relations', 'string|array')], 'EloquentBuilder', 'Kecualikan relasi tertentu dari eager loading bawaan.'),
  m('withCount', [p('$relations', 'string|array')], 'EloquentBuilder', 'Tambahkan kolom `{relation}_count` hasil subselect COUNT.'),
  m('withSum', [p('$relation', 'string'), p('$column', 'string')], 'EloquentBuilder', 'Tambahkan agregat SUM pada relasi Eloquent.'),
  m('withAvg', [p('$relation', 'string'), p('$column', 'string')], 'EloquentBuilder', 'Tambahkan agregat AVG pada relasi Eloquent.'),
  m('orderBy', [p('$column', 'string'), p('$direction', 'string', true, "'asc'")], 'EloquentBuilder', 'Urutkan hasil query berdasarkan kolom (asc/desc).'),
  m('orderByDesc', [p('$column', 'string')], 'EloquentBuilder', 'Urutkan hasil query secara menurun (DESC).'),
  m('orderByRaw', [p('$sql', 'string'), p('$bindings', 'array', true, '[]')], 'EloquentBuilder', 'Urutkan hasil dengan ekspresi ORDER BY mentah.'),
  m('latest', [p('$column', 'string', true, "'created_at'")], 'EloquentBuilder', 'Urutkan dari data terbaru berdasarkan kolom timestamp.'),
  m('oldest', [p('$column', 'string', true, "'created_at'")], 'EloquentBuilder', 'Urutkan dari data terlama berdasarkan kolom timestamp.'),
  m('inRandomOrder', [], 'EloquentBuilder', 'Urutkan baris secara acak.'),
  m('groupBy', [p('...$groups', 'string|array')], 'EloquentBuilder', 'Kelompokkan hasil query (GROUP BY).'),
  m('having', [p('$column', 'string'), p('$operator', 'string', true), p('$value', 'mixed', true)], 'EloquentBuilder', 'Tambahkan klausa HAVING setelah GROUP BY.'),
  m('limit', [p('$value', 'int')], 'EloquentBuilder', 'Batasi jumlah baris yang diambil (LIMIT).'),
  m('take', [p('$value', 'int')], 'EloquentBuilder', 'Alias untuk membatasi jumlah baris yang diambil.'),
  m('offset', [p('$value', 'int')], 'EloquentBuilder', 'Lewati sejumlah baris sebelum mengambil hasil (OFFSET).'),
  m('skip', [p('$value', 'int')], 'EloquentBuilder', 'Alias untuk offset().'),
  m('when', [p('$value', 'mixed'), p('$callback', 'callable'), p('$default', 'callable', true)], 'EloquentBuilder', 'Jalankan modifikasi query kondisional jika `$value` bernilai truthy.'),
  m('unless', [p('$value', 'mixed'), p('$callback', 'callable')], 'EloquentBuilder', 'Jalankan modifikasi query kondisional jika `$value` bernilai falsy.'),
  m('lockForUpdate', [], 'EloquentBuilder', 'Kunci baris yang dipilih dari pembaruan transaksi lain (SELECT ... FOR UPDATE).'),
  m('withTrashed', [], 'EloquentBuilder', 'Sertakan model yang telah dihapus sementara (SoftDeletes).'),
  m('onlyTrashed', [], 'EloquentBuilder', 'Hanya ambil model yang telah dihapus sementara (SoftDeletes).'),
  m('first', [p('$columns', 'array|string', true, "['*']")], 'Model', 'Eksekusi query dan kembalikan satu baris/model pertama atau null.'),
  m('firstOrFail', [p('$columns', 'array|string', true, "['*']")], 'Model', 'Kembalikan model pertama atau lempar `ModelNotFoundException` (404).'),
  m('firstWhere', [p('$column', 'string'), p('$operator', 'mixed', true), p('$value', 'mixed', true)], 'Model', 'Ambil baris pertama yang cocok dengan kondisi WHERE.'),
  m('sole', [p('$columns', 'array|string', true, "['*']")], 'Model', 'Ambil satu-satunya rekaman yang cocok atau lempar exception jika >1.'),
  m('find', [p('$id', 'int|string|array'), p('$columns', 'array', true, "['*']")], 'Model', 'Cari model berdasarkan primary key.'),
  m('findOrFail', [p('$id', 'int|string|array'), p('$columns', 'array', true, "['*']")], 'Model', 'Cari model berdasarkan primary key atau lempar 404 jika tidak ada.'),
  m('value', [p('$column', 'string')], 'mixed', 'Ambil nilai satu kolom langsung dari baris pertama.'),
  m('pluck', [p('$column', 'string'), p('$key', 'string', true)], 'Collection', 'Ambil koleksi nilai dari satu kolom tertentu.'),
  m('get', [p('$columns', 'array|string', true, "['*']")], 'Collection', 'Eksekusi query SELECT dan kembalikan `Illuminate\\Support\\Collection`.'),
  m('paginate', [p('$perPage', 'int', true, '15'), p('$columns', 'array', true, "['*']"), p('$pageName', 'string', true, "'page'"), p('$page', 'int', true)], 'LengthAwarePaginator', 'Paginasi hasil query lengkap dengan total halaman dan link navigasi.'),
  m('simplePaginate', [p('$perPage', 'int', true, '15')], 'Paginator', 'Paginasi ringan (Next/Prev saja) tanpa menghitung total baris.'),
  m('cursorPaginate', [p('$perPage', 'int', true, '15')], 'CursorPaginator', 'Paginasi berbasis cursor berkinerja tinggi untuk dataset besar.'),
  m('chunk', [p('$count', 'int'), p('$callback', 'callable')], 'bool', 'Proses hasil query per bagian (batch) agar hemat memori.'),
  m('chunkById', [p('$count', 'int'), p('$callback', 'callable'), p('$column', 'string', true)], 'bool', 'Proses hasil query bertahap secara aman berdasarkan primary key.'),
  m('lazy', [p('$chunkSize', 'int', true, '1000')], 'LazyCollection', 'Alirkan hasil query secara malas menggunakan Generator PHP.'),
  m('count', [p('$columns', 'string', true, "'*'")], 'int', 'Hitung jumlah baris hasil query (COUNT).'),
  m('max', [p('$column', 'string')], 'mixed', 'Ambil nilai maksimum dari kolom.'),
  m('min', [p('$column', 'string')], 'mixed', 'Ambil nilai minimum dari kolom.'),
  m('avg', [p('$column', 'string')], 'float|int|null', 'Hitung nilai rata-rata (AVG) dari kolom.'),
  m('sum', [p('$column', 'string')], 'float|int', 'Hitung total penjumlahan (SUM) dari kolom.'),
  m('exists', [], 'bool', 'Periksa apakah terdapat minimal satu baris yang cocok.'),
  m('doesntExist', [], 'bool', 'Periksa apakah tidak ada baris yang cocok.'),
  m('insert', [p('$values', 'array')], 'bool', 'Sisipkan satu atau banyak baris baru ke tabel database.'),
  m('insertGetId', [p('$values', 'array'), p('$sequence', 'string', true)], 'int|string', 'Sisipkan baris baru dan kembalikan ID auto-increment.'),
  m('upsert', [p('$values', 'array'), p('$uniqueBy', 'array|string'), p('$update', 'array', true)], 'int', 'Sisipkan baris baru atau perbarui baris yang sudah ada secara atomik.'),
  m('update', [p('$values', 'array')], 'int', 'Perbarui rekaman yang cocok di database.'),
  m('updateOrInsert', [p('$attributes', 'array'), p('$values', 'array', true, '[]')], 'bool', 'Perbarui baris yang cocok atau sisipkan baris baru jika tidak ditemukan.'),
  m('increment', [p('$column', 'string'), p('$amount', 'int|float', true, '1'), p('$extra', 'array', true, '[]')], 'int', 'Tambah nilai numerik kolom secara atomik.'),
  m('decrement', [p('$column', 'string'), p('$amount', 'int|float', true, '1'), p('$extra', 'array', true, '[]')], 'int', 'Kurangi nilai numerik kolom secara atomik.'),
  m('delete', [p('$id', 'mixed', true)], 'int', 'Hapus baris dari tabel database.'),
  m('forceDelete', [], 'int|bool', 'Hapus permanen baris dari database (melewati SoftDeletes).'),
  m('restore', [], 'int|bool', 'Pulihkan baris yang sebelumnya dihapus menggunakan SoftDeletes.'),
  m('create', [p('$attributes', 'array', true, '[]')], 'Model', 'Buat instance model baru dan langsung simpan ke database.'),
  m('firstOrCreate', [p('$attributes', 'array'), p('$values', 'array', true, '[]')], 'Model', 'Ambil rekaman pertama yang cocok atau buat rekaman baru di database.'),
  m('firstOrNew', [p('$attributes', 'array'), p('$values', 'array', true, '[]')], 'Model', 'Ambil rekaman pertama yang cocok atau instansiasi di memori tanpa menyimpan.'),
  m('updateOrCreate', [p('$attributes', 'array'), p('$values', 'array', true, '[]')], 'Model', 'Perbarui model yang ada atau buat baru apabila belum ditemukan.'),
  m('toSql', [], 'string', 'Dapatkan string SQL mentah dari query (tanpa binding).'),
  m('toRawSql', [], 'string', 'Dapatkan string SQL lengkap dengan nilai binding yang disubstitusi.'),
  m('dd', [], 'never', 'Dump SQL beserta binding dan hentikan eksekusi.'),
  m('dump', [], 'EloquentBuilder', 'Dump SQL beserta binding lalu lanjutkan eksekusi.')
];

const MODEL_STATIC_QUERY_METHODS: PhpClassMemberMeta[] = [
  sm('query', [], 'EloquentBuilder', 'Mulai membuat query Eloquent baru pada model ini.'),
  sm('all', [p('$columns', 'array|string', true, "['*']")], 'Collection', 'Ambil seluruh rekaman model dari database.'),
  ...QUERY_BUILDER_METHODS.filter((item) =>
    [
      'select',
      'where',
      'whereIn',
      'whereNotIn',
      'whereNull',
      'whereNotNull',
      'whereBetween',
      'whereDate',
      'whereHas',
      'whereDoesntHave',
      'with',
      'withCount',
      'orderBy',
      'orderByDesc',
      'latest',
      'oldest',
      'find',
      'findOrFail',
      'firstWhere',
      'pluck',
      'paginate',
      'simplePaginate',
      'cursorPaginate',
      'count',
      'exists',
      'create',
      'firstOrCreate',
      'firstOrNew',
      'updateOrCreate',
      'upsert',
      'withTrashed',
      'onlyTrashed'
    ].includes(item.name)
  ).map((item) => ({ ...item, isStatic: true })),
  sm('destroy', [p('$ids', 'int|string|array|Collection')], 'int', 'Hapus model berdasarkan satu atau daftar primary key.')
];

const MODEL_INSTANCE_MEMBERS: PhpClassMemberMeta[] = [
  prop('id', 'int|string', 'Primary key model Eloquent.'),
  prop('created_at', 'Carbon', 'Waktu pembuatan rekaman (otomatis oleh Eloquent timestamps).'),
  prop('updated_at', 'Carbon', 'Waktu pembaruan terakhir rekaman.'),
  prop('deleted_at', 'Carbon|null', 'Waktu penghapusan sementara (jika menggunakan SoftDeletes).'),
  prop('fillable', 'array', 'Daftar atribut yang diizinkan untuk mass assignment.'),
  prop('guarded', 'array', 'Daftar atribut yang dilindungi dari mass assignment.'),
  prop('casts', 'array', 'Konversi tipe atribut otomatis (datetime, boolean, array, enum, hashed).'),
  prop('hidden', 'array', 'Atribut yang disembunyikan saat serialisasi JSON/array.'),
  prop('appends', 'array', 'Accessor tambahan yang disertakan pada serialisasi JSON.'),
  prop('table', 'string', 'Nama tabel database yang terkait dengan model.'),
  prop('primaryKey', 'string', 'Nama kolom primary key tabel (default: `id`).'),
  prop('timestamps', 'bool', 'Apakah Eloquent mengelola kolom `created_at` & `updated_at`.'),
  m('save', [p('$options', 'array', true, '[]')], 'bool', 'Simpan perubahan model ke database.'),
  m('saveOrFail', [p('$options', 'array', true, '[]')], 'bool', 'Simpan model di dalam transaksi atau lempar exception jika gagal.'),
  m('update', [p('$attributes', 'array', true, '[]'), p('$options', 'array', true, '[]')], 'bool', 'Perbarui atribut model dan simpan ke database.'),
  m('fill', [p('$attributes', 'array')], 'self', 'Isi atribut model menggunakan aturan mass-assignment `$fillable`.'),
  m('forceFill', [p('$attributes', 'array')], 'self', 'Isi atribut model melewati proteksi mass-assignment.'),
  m('delete', [], 'bool|null', 'Hapus rekaman model ini dari database (atau soft delete).'),
  m('forceDelete', [], 'bool|null', 'Hapus permanen rekaman model meskipun memakai SoftDeletes.'),
  m('restore', [], 'bool', 'Pulihkan model yang di-soft-delete.'),
  m('trashed', [], 'bool', 'Periksa apakah model saat ini dalam status soft-deleted.'),
  m('fresh', [p('$with', 'array|string', true, '[]')], 'self|null', 'Muat ulang instance model baru langsung dari database.'),
  m('refresh', [], 'self', 'Segarkan atribut & relasi instance model saat ini dari database.'),
  m('replicate', [p('$except', 'array', true)], 'self', 'Kloning model ke instance baru yang belum disimpan.'),
  m('load', [p('$relations', 'string|array')], 'self', 'Lazy-eager load relasi pada instance model yang sudah diambil.'),
  m('loadMissing', [p('$relations', 'string|array')], 'self', 'Muat relasi hanya apabila relasi tersebut belum dimuat.'),
  m('loadCount', [p('$relations', 'string|array')], 'self', 'Muat jumlah item relasi (`{relation}_count`) pada model.'),
  m('isDirty', [p('$attributes', 'string|array', true)], 'bool', 'Periksa apakah atribut model berubah sejak terakhir dimuat.'),
  m('isClean', [p('$attributes', 'string|array', true)], 'bool', 'Periksa apakah atribut model belum berubah sejak dimuat.'),
  m('wasChanged', [p('$attributes', 'string|array', true)], 'bool', 'Periksa apakah atribut berubah saat operasi `save()` terakhir.'),
  m('getOriginal', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil nilai asli atribut sebelum dimodifikasi.'),
  m('only', [p('$attributes', 'array|string')], 'array', 'Ambil subset atribut tertentu dari model sebagai array.'),
  m('toArray', [], 'array', 'Konversi atribut dan relasi model menjadi array PHP.'),
  m('toJson', [p('$options', 'int', true, '0')], 'string', 'Serialisasi model menjadi string JSON.'),
  m('hasOne', [p('$related', 'string'), p('$foreignKey', 'string', true), p('$localKey', 'string', true)], 'EloquentBuilder', 'Definisikan relasi one-to-one (1:1).'),
  m('hasMany', [p('$related', 'string'), p('$foreignKey', 'string', true), p('$localKey', 'string', true)], 'EloquentBuilder', 'Definisikan relasi one-to-many (1:N).'),
  m('belongsTo', [p('$related', 'string'), p('$foreignKey', 'string', true), p('$ownerKey', 'string', true)], 'EloquentBuilder', 'Definisikan relasi inverse one-to-one / many-to-one.'),
  m('belongsToMany', [p('$related', 'string'), p('$table', 'string', true), p('$foreignPivotKey', 'string', true), p('$relatedPivotKey', 'string', true)], 'EloquentBuilder', 'Definisikan relasi many-to-many (N:M) melalui tabel pivot.'),
  m('hasManyThrough', [p('$related', 'string'), p('$through', 'string')], 'EloquentBuilder', 'Definisikan relasi has-many-through jarak jauh.'),
  m('hasOneThrough', [p('$related', 'string'), p('$through', 'string')], 'EloquentBuilder', 'Definisikan relasi has-one-through.'),
  m('morphTo', [p('$name', 'string', true)], 'EloquentBuilder', 'Definisikan relasi polimorfik pemilik (`morphTo`).'),
  m('morphMany', [p('$related', 'string'), p('$name', 'string')], 'EloquentBuilder', 'Definisikan relasi one-to-many polimorfik (`morphMany`).'),
  m('morphOne', [p('$related', 'string'), p('$name', 'string')], 'EloquentBuilder', 'Definisikan relasi one-to-one polimorfik (`morphOne`).')
];

const REQUEST_MEMBERS: PhpClassMemberMeta[] = [
  m('all', [p('$keys', 'array|mixed', true)], 'array', 'Ambil seluruh data input dan file dari request.'),
  m('input', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil item input dari request body maupun query string (mendukung dot notation).'),
  m('query', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil parameter dari query string URL.'),
  m('post', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil parameter dari body POST.'),
  m('string', [p('$key', 'string'), p('$default', 'mixed', true)], 'Str', 'Ambil input sebagai objek fluent `Stringable`.'),
  m('integer', [p('$key', 'string'), p('$default', 'int', true, '0')], 'int', 'Ambil nilai input yang dikonversi menjadi integer.'),
  m('float', [p('$key', 'string'), p('$default', 'float', true, '0.0')], 'float', 'Ambil nilai input sebagai float.'),
  m('boolean', [p('$key', 'string', true), p('$default', 'bool', true, 'false')], 'bool', 'Konversi input ("1", "true", "on", "yes") menjadi boolean.'),
  m('date', [p('$key', 'string'), p('$format', 'string', true), p('$tz', 'string', true)], 'Carbon|null', 'Parse nilai input tanggal menjadi instance `Carbon`.'),
  m('enum', [p('$key', 'string'), p('$enumClass', 'string')], 'object|null', 'Konversi input menjadi PHP Backed Enum.'),
  m('collect', [p('$key', 'array|string', true)], 'Collection', 'Ambil subset input sebagai `Collection` Laravel.'),
  m('only', [p('$keys', 'array|mixed')], 'array', 'Ambil hanya daftar kunci input yang ditentukan.'),
  m('except', [p('$keys', 'array|mixed')], 'array', 'Ambil semua input kecuali kunci yang dikecualikan.'),
  m('has', [p('$key', 'string|array')], 'bool', 'Periksa apakah kunci input tersedia pada request.'),
  m('hasAny', [p('$keys', 'string|array')], 'bool', 'Periksa apakah salah satu dari kunci input tersedia.'),
  m('filled', [p('$key', 'string|array')], 'bool', 'Periksa apakah kunci input ada dan tidak kosong.'),
  m('isNotFilled', [p('$key', 'string|array')], 'bool', 'Periksa apakah input kosong atau tidak dikirim.'),
  m('missing', [p('$key', 'string|array')], 'bool', 'Periksa apakah kunci tertentu absen dari request.'),
  m('merge', [p('$input', 'array')], 'Request', 'Gabungkan nilai baru ke dalam data input request.'),
  m('mergeIfMissing', [p('$input', 'array')], 'Request', 'Gabungkan input hanya jika kunci tersebut belum ada.'),
  m('validate', [p('$rules', 'array'), p('$messages', 'array', true, '[]'), p('$attributes', 'array', true, '[]')], 'array', 'Validasi input request dan kembalikan array data tervalidasi (otomatis redirect/422 jika gagal).'),
  m('validated', [p('$key', 'string|int', true), p('$default', 'mixed', true)], 'mixed', 'Ambil data yang telah lolos validasi FormRequest.'),
  m('safe', [p('$keys', 'array', true)], 'ValidatedInput', 'Ambil objek `ValidatedInput` (`->only()`, `->except()`, `->merge()`).'),
  m('file', [p('$key', 'string', true), p('$default', 'mixed', true)], 'UploadedFile', 'Ambil file unggahan sebagai `Illuminate\\Http\\UploadedFile`.'),
  m('hasFile', [p('$key', 'string')], 'bool', 'Periksa apakah file yang valid berhasil diunggah pada request.'),
  m('user', [p('$guard', 'string', true)], 'User', 'Ambil pengguna yang sedang terautentikasi pada request ini.'),
  m('ip', [], 'string|null', 'Ambil alamat IP klien.'),
  m('bearerToken', [], 'string|null', 'Ambil Bearer token dari header `Authorization`.'),
  m('header', [p('$key', 'string', true), p('$default', 'mixed', true)], 'string|array|null', 'Ambil nilai HTTP header dari request.'),
  m('hasHeader', [p('$key', 'string')], 'bool', 'Periksa keberadaan HTTP header tertentu.'),
  m('cookie', [p('$key', 'string', true), p('$default', 'mixed', true)], 'string|array|null', 'Ambil cookie dari request.'),
  m('session', [], 'Session', 'Akses sesi pengguna yang terkait dengan request.'),
  m('old', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil old input yang di-flash pada sesi sebelumnya.'),
  m('method', [], 'string', 'Dapatkan HTTP verb request (GET, POST, PUT, DELETE).'),
  m('isMethod', [p('$method', 'string')], 'bool', 'Periksa apakah HTTP verb sesuai.'),
  m('path', [], 'string', 'Dapatkan path URI saat ini.'),
  m('url', [], 'string', 'Dapatkan URL lengkap tanpa query string.'),
  m('fullUrl', [], 'string', 'Dapatkan URL lengkap beserta query string.'),
  m('route', [p('$param', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil parameter route atau objek Route saat ini.'),
  m('routeIs', [p('...$patterns', 'string')], 'bool', 'Periksa apakah request cocok dengan pola nama route (mendukung wildcard `*`).'),
  m('is', [p('...$patterns', 'string')], 'bool', 'Periksa apakah path URI cocok dengan pola.'),
  m('expectsJson', [], 'bool', 'Periksa apakah klien mengharapkan respons JSON.'),
  m('wantsJson', [], 'bool', 'Periksa apakah header `Accept` meminta JSON.'),
  m('ajax', [], 'bool', 'Periksa apakah request berasal dari XMLHttpRequest.')
];

export const CORE_LARAVEL_CLASSES: PhpClassMeta[] = [
  {
    name: 'Route',
    origin: 'laravel',
    doc: 'Facade Routing Laravel (`Illuminate\\Support\\Facades\\Route`) untuk mendaftarkan endpoint web & API.',
    members: [
      sm('get', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route HTTP GET baru.'),
      sm('post', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route HTTP POST baru.'),
      sm('put', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route HTTP PUT baru.'),
      sm('patch', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route HTTP PATCH baru.'),
      sm('delete', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route HTTP DELETE baru.'),
      sm('options', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route HTTP OPTIONS.'),
      sm('any', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route yang merespons semua HTTP verb.'),
      sm('match', [p('$methods', 'array'), p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route untuk daftar HTTP verb tertentu.'),
      sm('resource', [p('$name', 'string'), p('$controller', 'string'), p('$options', 'array', true, '[]')], 'RouteRegistrar', 'Daftarkan 7 route CRUD RESTful (`index`, `create`, `store`, `show`, `edit`, `update`, `destroy`).'),
      sm('apiResource', [p('$name', 'string'), p('$controller', 'string'), p('$options', 'array', true, '[]')], 'RouteRegistrar', 'Daftarkan 5 route API resource (tanpa `create` & `edit`).'),
      sm('singleton', [p('$name', 'string'), p('$controller', 'string')], 'RouteRegistrar', 'Daftarkan singleton resource route.'),
      sm('view', [p('$uri', 'string'), p('$view', 'string'), p('$data', 'array', true, '[]')], 'RouteRegistrar', 'Daftarkan route yang langsung merender Blade view.'),
      sm('redirect', [p('$uri', 'string'), p('$destination', 'string'), p('$status', 'int', true, '302')], 'RouteRegistrar', 'Buat route pengalihan URL (redirect).'),
      sm('permanentRedirect', [p('$uri', 'string'), p('$destination', 'string')], 'RouteRegistrar', 'Buat route redirect permanen HTTP 301.'),
      sm('middleware', [p('$middleware', 'array|string')], 'RouteRegistrar', 'Tetapkan middleware pada route atau grup route.'),
      sm('withoutMiddleware', [p('$middleware', 'array|string')], 'RouteRegistrar', 'Kecualikan middleware tertentu dari route/grup.'),
      sm('prefix', [p('$prefix', 'string')], 'RouteRegistrar', 'Tambahkan awalan URI pada grup route.'),
      sm('name', [p('$value', 'string')], 'RouteRegistrar', 'Tambahkan awalan nama route (contoh: `admin.`) pada grup.'),
      sm('controller', [p('$controller', 'string')], 'RouteRegistrar', 'Tetapkan class controller bersama untuk sebuah grup route.'),
      sm('domain', [p('$value', 'string')], 'RouteRegistrar', 'Batasi grup route pada subdomain tertentu.'),
      sm('group', [p('$attributesOrRoutes', 'array|Closure|string'), p('$routes', 'Closure|string', true)], 'void', 'Kelompokkan beberapa route dengan atribut bersama.'),
      sm('fallback', [p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route fallback ketika tidak ada route lain yang cocok.'),
      sm('currentRouteName', [], 'string|null', 'Dapatkan nama route yang sedang dieksekusi.'),
      sm('is', [p('...$patterns', 'string')], 'bool', 'Periksa apakah nama route aktif cocok dengan pola.'),
      sm('has', [p('$name', 'string|array')], 'bool', 'Periksa apakah nama route terdaftar di aplikasi.')
    ]
  },
  {
    name: 'RouteRegistrar',
    origin: 'laravel',
    doc: 'Objek fluent pendaftaran & konfigurasi Route Laravel.',
    members: [
      m('name', [p('$name', 'string')], 'RouteRegistrar', 'Beri nama unik pada route (misal `users.index`).'),
      m('middleware', [p('$middleware', 'array|string')], 'RouteRegistrar', 'Pasang middleware ke route/grup ini.'),
      m('withoutMiddleware', [p('$middleware', 'array|string')], 'RouteRegistrar', 'Lepas middleware tertentu dari route ini.'),
      m('prefix', [p('$prefix', 'string')], 'RouteRegistrar', 'Tambahkan prefix URI.'),
      m('controller', [p('$controller', 'string')], 'RouteRegistrar', 'Tentukan class Controller untuk grup.'),
      m('domain', [p('$domain', 'string')], 'RouteRegistrar', 'Tentukan domain/subdomain grup.'),
      m('where', [p('$name', 'string|array'), p('$expression', 'string', true)], 'RouteRegistrar', 'Batasi parameter URI dengan ekspresi reguler.'),
      m('whereNumber', [p('$parameters', 'string|array')], 'RouteRegistrar', 'Batasi parameter route agar hanya menerima angka.'),
      m('whereAlpha', [p('$parameters', 'string|array')], 'RouteRegistrar', 'Batasi parameter route agar hanya menerima huruf.'),
      m('whereAlphaNumeric', [p('$parameters', 'string|array')], 'RouteRegistrar', 'Batasi parameter route hanya alfanumerik.'),
      m('whereUuid', [p('$parameters', 'string|array')], 'RouteRegistrar', 'Batasi parameter route agar berformat UUID.'),
      m('whereUlid', [p('$parameters', 'string|array')], 'RouteRegistrar', 'Batasi parameter route agar berformat ULID.'),
      m('whereIn', [p('$parameters', 'string|array'), p('$values', 'array')], 'RouteRegistrar', 'Batasi parameter route pada daftar nilai tertentu.'),
      m('can', [p('$ability', 'string'), p('$models', 'string|array', true)], 'RouteRegistrar', 'Pasang otorisasi Gate/Policy pada route.'),
      m('withTrashed', [p('$withTrashed', 'bool', true, 'true')], 'RouteRegistrar', 'Izinkan implicit model binding memuat data soft-deleted.'),
      m('scopeBindings', [], 'RouteRegistrar', 'Aktifkan scoped implicit model binding untuk parameter anak.'),
      m('group', [p('$callback', 'Closure|string')], 'void', 'Definisikan isi grup route.'),
      m('get', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route GET di dalam grup.'),
      m('post', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route POST di dalam grup.'),
      m('put', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route PUT di dalam grup.'),
      m('patch', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route PATCH di dalam grup.'),
      m('delete', [p('$uri', 'string'), p('$action', 'array|string|callable')], 'RouteRegistrar', 'Daftarkan route DELETE di dalam grup.'),
      m('resource', [p('$name', 'string'), p('$controller', 'string')], 'RouteRegistrar', 'Daftarkan resource route di dalam grup.'),
      m('apiResource', [p('$name', 'string'), p('$controller', 'string')], 'RouteRegistrar', 'Daftarkan API resource route di dalam grup.')
    ]
  },
  {
    name: 'DB',
    origin: 'laravel',
    doc: 'Facade Database Laravel (`Illuminate\\Support\\Facades\\DB`) untuk Query Builder & transaksi SQL.',
    members: [
      sm('table', [p('$table', 'string'), p('$as', 'string', true)], 'QueryBuilder', 'Mulai fluent Query Builder terhadap tabel database.'),
      sm('connection', [p('$name', 'string', true)], 'DB', 'Gunakan koneksi database tertentu dari `config/database.php`.'),
      sm('select', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'array', 'Jalankan query SELECT dengan parameter binding aman.'),
      sm('selectOne', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'object|null', 'Jalankan query SELECT dan kembalikan satu baris pertama.'),
      sm('scalar', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'mixed', 'Ambil satu nilai skalar tunggal dari hasil query.'),
      sm('insert', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'bool', 'Jalankan pernyataan INSERT SQL.'),
      sm('update', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'int', 'Jalankan pernyataan UPDATE dan kembalikan jumlah baris terdampak.'),
      sm('delete', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'int', 'Jalankan pernyataan DELETE dan kembalikan jumlah baris terhapus.'),
      sm('statement', [p('$query', 'string'), p('$bindings', 'array', true, '[]')], 'bool', 'Jalankan pernyataan SQL umum.'),
      sm('transaction', [p('$callback', 'Closure'), p('$attempts', 'int', true, '1')], 'mixed', 'Jalankan Closure di dalam transaksi database otomatis (commit/rollback).'),
      sm('beginTransaction', [], 'void', 'Mulai transaksi database secara manual.'),
      sm('commit', [], 'void', 'Commit transaksi database aktif.'),
      sm('rollBack', [], 'void', 'Batalkan (rollback) transaksi database aktif.'),
      sm('raw', [p('$value', 'mixed')], 'Expression', 'Buat ekspresi SQL mentah (pastikan bebas dari input user tak terfilter!).'),
      sm('listen', [p('$callback', 'Closure')], 'void', 'Daftarkan listener setiap kali query dieksekusi.')
    ]
  },
  {
    name: 'QueryBuilder',
    origin: 'laravel',
    doc: 'Fluent Database Query Builder Laravel (`Illuminate\\Database\\Query\\Builder`).',
    members: QUERY_BUILDER_METHODS
  },
  {
    name: 'EloquentBuilder',
    origin: 'laravel',
    doc: 'Fluent Eloquent ORM Query Builder (`Illuminate\\Database\\Eloquent\\Builder`).',
    members: QUERY_BUILDER_METHODS
  },
  {
    name: 'Builder',
    origin: 'laravel',
    doc: 'Alias Query / Eloquent Builder Laravel.',
    members: QUERY_BUILDER_METHODS
  },
  {
    name: 'Model',
    origin: 'laravel',
    doc: 'Base Class Eloquent ORM (`Illuminate\\Database\\Eloquent\\Model`).',
    members: [...MODEL_STATIC_QUERY_METHODS, ...MODEL_INSTANCE_MEMBERS]
  },
  {
    name: 'Authenticatable',
    origin: 'laravel',
    doc: 'Base Class User Eloquent (`Illuminate\\Foundation\\Auth\\User`).',
    members: [
      ...MODEL_STATIC_QUERY_METHODS,
      ...MODEL_INSTANCE_MEMBERS,
      m('can', [p('$abilities', 'iterable|string'), p('$arguments', 'array|mixed', true, '[]')], 'bool', 'Periksa apakah pengguna memiliki izin/otorisasi tertentu.'),
      m('cannot', [p('$abilities', 'iterable|string'), p('$arguments', 'array|mixed', true, '[]')], 'bool', 'Periksa apakah pengguna TIDAK memiliki izin tertentu.'),
      m('notify', [p('$instance', 'object')], 'void', 'Kirim notifikasi Laravel kepada pengguna ini.'),
      m('createToken', [p('$name', 'string'), p('$abilities', 'array', true, "['*']")], 'NewAccessToken', 'Buat API token Sanctum untuk pengguna ini.')
    ]
  },
  {
    name: 'Request',
    origin: 'laravel',
    doc: 'HTTP Request Laravel (`Illuminate\\Http\\Request`).',
    members: REQUEST_MEMBERS
  },
  {
    name: 'FormRequest',
    origin: 'laravel',
    doc: 'Form Request Validation Class (`Illuminate\\Foundation\\Http\\FormRequest`).',
    members: [
      ...REQUEST_MEMBERS,
      m('authorize', [], 'bool', 'Tentukan apakah pengguna diizinkan melakukan request ini.'),
      m('rules', [], 'array', 'Definisikan aturan validasi yang berlaku pada request.'),
      m('messages', [], 'array', 'Kustomisasi pesan kesalahan validasi.'),
      m('attributes', [], 'array', 'Kustomisasi nama atribut untuk pesan validasi.'),
      m('prepareForValidation', [], 'void', 'Siapkan atau normalisasi data sebelum validasi dijalankan.'),
      m('passedValidation', [], 'void', 'Tangani logika setelah validasi berhasil.')
    ]
  },
  {
    name: 'UploadedFile',
    origin: 'laravel',
    doc: 'File unggahan HTTP Laravel (`Illuminate\\Http\\UploadedFile`).',
    members: [
      m('store', [p('$path', 'string', true, "''"), p('$options', 'array|string', true, '[]')], 'string|false', 'Simpan file unggahan dengan nama hash unik ke disk Storage.'),
      m('storeAs', [p('$path', 'string'), p('$name', 'string'), p('$options', 'array|string', true, '[]')], 'string|false', 'Simpan file unggahan menggunakan nama file spesifik.'),
      m('storePublicly', [p('$path', 'string', true, "''"), p('$options', 'array|string', true, '[]')], 'string|false', 'Simpan file dengan visibilitas publik.'),
      m('getClientOriginalName', [], 'string', 'Ambil nama asli file dari perangkat pengguna.'),
      m('getClientOriginalExtension', [], 'string', 'Ambil ekstensi asli file dari klien.'),
      m('extension', [], 'string', 'Tebak ekstensi file berdasarkan konten MIME sebenarnya.'),
      m('getMimeType', [], 'string|null', 'Ambil tipe MIME file yang terdeteksi server.'),
      m('getSize', [], 'int|false', 'Ambil ukuran file dalam satuan byte.'),
      m('hashName', [p('$path', 'string', true)], 'string', 'Hasilkan nama file acak yang aman.'),
      m('isValid', [], 'bool', 'Periksa apakah file berhasil diunggah tanpa error.')
    ]
  },
  {
    name: 'Response',
    origin: 'laravel',
    doc: 'HTTP Response Factory & Facade (`Illuminate\\Support\\Facades\\Response`).',
    members: [
      sm('json', [p('$data', 'mixed', true, '[]'), p('$status', 'int', true, '200'), p('$headers', 'array', true, '[]')], 'Response', 'Buat respons JSON terstruktur.'),
      sm('view', [p('$view', 'string'), p('$data', 'array', true, '[]'), p('$status', 'int', true, '200')], 'Response', 'Buat respons dari template Blade.'),
      sm('make', [p('$content', 'string', true, "''"), p('$status', 'int', true, '200'), p('$headers', 'array', true, '[]')], 'Response', 'Buat instance HTTP response baru.'),
      sm('noContent', [p('$status', 'int', true, '204'), p('$headers', 'array', true, '[]')], 'Response', 'Buat respons HTTP 204 tanpa konten.'),
      sm('download', [p('$file', 'string'), p('$name', 'string', true), p('$headers', 'array', true, '[]')], 'BinaryFileResponse', 'Unduh file ke browser pengguna.'),
      sm('file', [p('$file', 'string'), p('$headers', 'array', true, '[]')], 'BinaryFileResponse', 'Tampilkan file (mis. PDF/gambar) langsung di browser.'),
      sm('streamDownload', [p('$callback', 'callable'), p('$name', 'string', true)], 'StreamedResponse', 'Alirkan unduhan langsung dari memori tanpa menyimpan ke disk.'),
      m('json', [p('$data', 'mixed', true, '[]'), p('$status', 'int', true, '200'), p('$headers', 'array', true, '[]')], 'Response', 'Kembalikan respons JSON (`response()->json(...)`).'),
      m('download', [p('$file', 'string'), p('$name', 'string', true)], 'Response', 'Kembalikan unduhan file (`response()->download(...)`).'),
      m('file', [p('$file', 'string'), p('$headers', 'array', true, '[]')], 'Response', 'Tampilkan file inline di browser.'),
      m('noContent', [p('$status', 'int', true, '204')], 'Response', 'Kembalikan status 204 No Content.'),
      m('header', [p('$key', 'string'), p('$values', 'string|array'), p('$replace', 'bool', true, 'true')], 'Response', 'Tambahkan header pada HTTP response.'),
      m('withHeaders', [p('$headers', 'array')], 'Response', 'Tambahkan sekumpulan header ke HTTP response.'),
      m('cookie', [p('$name', 'string'), p('$value', 'string'), p('$minutes', 'int', true, '0')], 'Response', 'Sertakan cookie pada HTTP response.')
    ]
  },
  {
    name: 'RedirectResponse',
    origin: 'laravel',
    doc: 'Fluent Redirect Response Laravel (`redirect()` / `back()` / `to_route()`).',
    members: [
      m('route', [p('$route', 'string'), p('$parameters', 'mixed', true, '[]'), p('$status', 'int', true, '302')], 'RedirectResponse', 'Alihkan pengguna ke named route.'),
      m('to', [p('$path', 'string'), p('$status', 'int', true, '302')], 'RedirectResponse', 'Alihkan pengguna ke URL/path internal.'),
      m('away', [p('$path', 'string'), p('$status', 'int', true, '302')], 'RedirectResponse', 'Alihkan pengguna ke URL eksternal.'),
      m('back', [p('$status', 'int', true, '302')], 'RedirectResponse', 'Kembali ke lokasi halaman sebelumnya.'),
      m('intended', [p('$default', 'string', true, "'/'")], 'RedirectResponse', 'Alihkan ke halaman yang sebelumnya dituju sebelum dicegat middleware auth.'),
      m('with', [p('$key', 'string|array'), p('$value', 'mixed', true)], 'RedirectResponse', 'Flash pesan/data sementara ke session untuk ditampilkan di halaman berikutnya.'),
      m('withInput', [p('$input', 'array', true)], 'RedirectResponse', 'Flash input form saat ini ke session agar `old()` terisi.'),
      m('withErrors', [p('$provider', 'array|string|Validator'), p('$key', 'string', true, "'default'")], 'RedirectResponse', 'Flash pesan error ke variabel `$errors` di Blade.')
    ]
  },
  {
    name: 'Redirect',
    origin: 'laravel',
    doc: 'Facade Redirect Laravel (`Illuminate\\Support\\Facades\\Redirect`).',
    members: [
      sm('route', [p('$route', 'string'), p('$parameters', 'mixed', true, '[]')], 'RedirectResponse', 'Redirect ke named route.'),
      sm('to', [p('$path', 'string'), p('$status', 'int', true, '302')], 'RedirectResponse', 'Redirect ke path tertentu.'),
      sm('back', [p('$status', 'int', true, '302')], 'RedirectResponse', 'Redirect ke halaman sebelumnya.'),
      sm('intended', [p('$default', 'string', true, "'/'")], 'RedirectResponse', 'Redirect ke URL tujuan sebelum autentikasi.'),
      sm('away', [p('$path', 'string')], 'RedirectResponse', 'Redirect ke domain eksternal.')
    ]
  },
  {
    name: 'Schema',
    origin: 'laravel',
    doc: 'Facade Schema Migration Laravel (`Illuminate\\Support\\Facades\\Schema`).',
    members: [
      sm('create', [p('$table', 'string'), p('$callback', 'Closure')], 'void', 'Buat tabel baru di database menggunakan `Blueprint $table`.'),
      sm('table', [p('$table', 'string'), p('$callback', 'Closure')], 'void', 'Ubah struktur tabel yang sudah ada menggunakan `Blueprint $table`.'),
      sm('rename', [p('$from', 'string'), p('$to', 'string')], 'void', 'Ganti nama tabel database.'),
      sm('drop', [p('$table', 'string')], 'void', 'Hapus tabel dari database.'),
      sm('dropIfExists', [p('$table', 'string')], 'void', 'Hapus tabel apabila tabel tersebut ada.'),
      sm('hasTable', [p('$table', 'string')], 'bool', 'Periksa apakah tabel ada di database.'),
      sm('hasColumn', [p('$table', 'string'), p('$column', 'string')], 'bool', 'Periksa apakah kolom ada pada tabel.'),
      sm('hasColumns', [p('$table', 'string'), p('$columns', 'array')], 'bool', 'Periksa apakah seluruh kolom yang disebutkan ada pada tabel.'),
      sm('disableForeignKeyConstraints', [], 'bool', 'Nonaktifkan sementara pengecekan foreign key.'),
      sm('enableForeignKeyConstraints', [], 'bool', 'Aktifkan kembali pengecekan foreign key.')
    ]
  },
  {
    name: 'Blueprint',
    origin: 'laravel',
    doc: 'Definisi kolom & indeks tabel Migration Laravel (`Illuminate\\Database\\Schema\\Blueprint`).',
    members: [
      m('id', [p('$column', 'string', true, "'id'")], 'Blueprint', 'Kolom auto-increment BIGINT UNSIGNED primary key.'),
      m('uuid', [p('$column', 'string', true, "'uuid'")], 'Blueprint', 'Kolom UUID.'),
      m('ulid', [p('$column', 'string', true, "'ulid'")], 'Blueprint', 'Kolom ULID (26 karakter terurut waktu).'),
      m('foreignId', [p('$column', 'string')], 'Blueprint', 'Kolom UNSIGNED BIGINT untuk foreign key (lanjutkan `->constrained()`).'),
      m('foreignUuid', [p('$column', 'string')], 'Blueprint', 'Kolom UUID untuk foreign key.'),
      m('foreignIdFor', [p('$model', 'string'), p('$column', 'string', true)], 'Blueprint', 'Buat kolom foreign key otomatis sesuai tipe primary key Model.'),
      m('string', [p('$column', 'string'), p('$length', 'int', true, '255')], 'Blueprint', 'Kolom VARCHAR dengan panjang tertentu.'),
      m('char', [p('$column', 'string'), p('$length', 'int', true, '255')], 'Blueprint', 'Kolom CHAR tetap.'),
      m('text', [p('$column', 'string')], 'Blueprint', 'Kolom TEXT.'),
      m('mediumText', [p('$column', 'string')], 'Blueprint', 'Kolom MEDIUMTEXT.'),
      m('longText', [p('$column', 'string')], 'Blueprint', 'Kolom LONGTEXT.'),
      m('integer', [p('$column', 'string')], 'Blueprint', 'Kolom INTEGER.'),
      m('tinyInteger', [p('$column', 'string')], 'Blueprint', 'Kolom TINYINT.'),
      m('smallInteger', [p('$column', 'string')], 'Blueprint', 'Kolom SMALLINT.'),
      m('bigInteger', [p('$column', 'string')], 'Blueprint', 'Kolom BIGINT.'),
      m('unsignedBigInteger', [p('$column', 'string')], 'Blueprint', 'Kolom BIGINT UNSIGNED.'),
      m('boolean', [p('$column', 'string')], 'Blueprint', 'Kolom BOOLEAN / TINYINT(1).'),
      m('decimal', [p('$column', 'string'), p('$total', 'int', true, '8'), p('$places', 'int', true, '2')], 'Blueprint', 'Kolom DECIMAL presisi tetap (cocok untuk nominal uang/harga).'),
      m('float', [p('$column', 'string'), p('$precision', 'int', true, '53')], 'Blueprint', 'Kolom FLOAT.'),
      m('double', [p('$column', 'string')], 'Blueprint', 'Kolom DOUBLE.'),
      m('date', [p('$column', 'string')], 'Blueprint', 'Kolom DATE (YYYY-MM-DD).'),
      m('dateTime', [p('$column', 'string'), p('$precision', 'int', true, '0')], 'Blueprint', 'Kolom DATETIME.'),
      m('time', [p('$column', 'string')], 'Blueprint', 'Kolom TIME.'),
      m('timestamp', [p('$column', 'string')], 'Blueprint', 'Kolom TIMESTAMP.'),
      m('timestamps', [p('$precision', 'int', true, '0')], 'void', 'Tambahkan kolom nullable `created_at` dan `updated_at`.'),
      m('softDeletes', [p('$column', 'string', true, "'deleted_at'")], 'Blueprint', 'Tambahkan kolom nullable `deleted_at` untuk SoftDeletes.'),
      m('json', [p('$column', 'string')], 'Blueprint', 'Kolom JSON.'),
      m('enum', [p('$column', 'string'), p('$allowed', 'array')], 'Blueprint', 'Kolom ENUM dengan daftar nilai yang diizinkan.'),
      m('binary', [p('$column', 'string')], 'Blueprint', 'Kolom BLOB / biner.'),
      m('morphs', [p('$name', 'string')], 'void', 'Tambahkan `{name}_id` dan `{name}_type` beserta indeks polimorfik.'),
      m('rememberToken', [], 'Blueprint', 'Tambahkan kolom `remember_token` VARCHAR(100) nullable.'),
      m('nullable', [p('$value', 'bool', true, 'true')], 'Blueprint', 'Izinkan nilai NULL disimpan pada kolom ini.'),
      m('default', [p('$value', 'mixed')], 'Blueprint', 'Tetapkan nilai bawaan (DEFAULT) untuk kolom ini.'),
      m('unsigned', [], 'Blueprint', 'Jadikan kolom numerik bertipe UNSIGNED.'),
      m('unique', [p('$columns', 'string|array', true), p('$name', 'string', true)], 'Blueprint', 'Tambahkan indeks UNIQUE pada kolom.'),
      m('index', [p('$columns', 'string|array', true), p('$name', 'string', true)], 'Blueprint', 'Tambahkan indeks pencarian database.'),
      m('primary', [p('$columns', 'string|array')], 'Blueprint', 'Tetapkan primary key.'),
      m('fullText', [p('$columns', 'string|array')], 'Blueprint', 'Tambahkan indeks pencarian FULLTEXT.'),
      m('constrained', [p('$table', 'string', true), p('$column', 'string', true, "'id'")], 'Blueprint', 'Buat foreign key constraint otomatis berdasarkan konvensi nama kolom.'),
      m('cascadeOnDelete', [], 'Blueprint', 'ON DELETE CASCADE pada foreign key.'),
      m('cascadeOnUpdate', [], 'Blueprint', 'ON UPDATE CASCADE pada foreign key.'),
      m('nullOnDelete', [], 'Blueprint', 'ON DELETE SET NULL pada foreign key.'),
      m('restrictOnDelete', [], 'Blueprint', 'ON DELETE RESTRICT pada foreign key.'),
      m('after', [p('$column', 'string')], 'Blueprint', 'Tempatkan kolom baru tepat setelah kolom tertentu (MySQL/MariaDB).'),
      m('first', [], 'Blueprint', 'Tempatkan kolom di urutan paling awal tabel.'),
      m('comment', [p('$comment', 'string')], 'Blueprint', 'Tambahkan komentar deskripsi kolom pada skema database.'),
      m('change', [], 'void', 'Terapkan modifikasi tipe/atribut pada kolom yang sudah ada.'),
      m('renameColumn', [p('$from', 'string'), p('$to', 'string')], 'Blueprint', 'Ubah nama kolom.'),
      m('dropColumn', [p('$columns', 'string|array')], 'Blueprint', 'Hapus satu atau beberapa kolom dari tabel.'),
      m('dropConstrainedForeignId', [p('$column', 'string')], 'Blueprint', 'Hapus foreign key constraint sekaligus kolomnya.')
    ]
  },
  {
    name: 'Auth',
    origin: 'laravel',
    doc: 'Facade Autentikasi Laravel (`Illuminate\\Support\\Facades\\Auth`).',
    members: [
      sm('check', [], 'bool', 'Periksa apakah pengguna saat ini sudah login.'),
      sm('guest', [], 'bool', 'Periksa apakah pengunjung saat ini belum login (tamu).'),
      sm('user', [], 'Authenticatable|null', 'Ambil model pengguna yang sedang login.'),
      sm('id', [], 'int|string|null', 'Ambil ID pengguna yang sedang login.'),
      sm('attempt', [p('$credentials', 'array'), p('$remember', 'bool', true, 'false')], 'bool', 'Verifikasi kredensial dan mulai sesi login pengguna.'),
      sm('login', [p('$user', 'Authenticatable'), p('$remember', 'bool', true, 'false')], 'void', 'Loginkan instance model User secara langsung.'),
      sm('loginUsingId', [p('$id', 'mixed'), p('$remember', 'bool', true, 'false')], 'Authenticatable|false', 'Loginkan pengguna berdasarkan primary key ID.'),
      sm('logout', [], 'void', 'Keluarkan pengguna dari sesi autentikasi aktif.'),
      sm('logoutOtherDevices', [p('$password', 'string')], 'Authenticatable|null', 'Invalidasi sesi pengguna pada perangkat lain.'),
      sm('guard', [p('$name', 'string', true)], 'Auth', 'Akses guard autentikasi tertentu (mis. `web`, `api`, `admin`).'),
      m('check', [], 'bool', 'Periksa status login pada guard aktif.'),
      m('user', [], 'Authenticatable|null', 'Ambil model pengguna pada guard aktif.'),
      m('id', [], 'int|string|null', 'Ambil ID pengguna pada guard aktif.'),
      m('logout', [], 'void', 'Logout dari guard aktif.')
    ]
  },
  {
    name: 'Gate',
    origin: 'laravel',
    doc: 'Facade Otorisasi Gate & Policy Laravel (`Illuminate\\Support\\Facades\\Gate`).',
    members: [
      sm('allows', [p('$ability', 'string'), p('$arguments', 'array|mixed', true, '[]')], 'bool', 'Periksa apakah aksi diizinkan untuk pengguna saat ini.'),
      sm('denies', [p('$ability', 'string'), p('$arguments', 'array|mixed', true, '[]')], 'bool', 'Periksa apakah aksi ditolak untuk pengguna saat ini.'),
      sm('authorize', [p('$ability', 'string'), p('$arguments', 'array|mixed', true, '[]')], 'mixed', 'Otorisasi aksi atau lempar `AuthorizationException` (HTTP 403).'),
      sm('define', [p('$ability', 'string'), p('$callback', 'callable|string')], 'Gate', 'Daftarkan aturan Gate baru.'),
      sm('policy', [p('$class', 'string'), p('$policy', 'string')], 'Gate', 'Hubungkan class Model dengan class Policy.'),
      sm('forUser', [p('$user', 'Authenticatable')], 'Gate', 'Evaluasi Gate untuk pengguna tertentu.')
    ]
  },
  {
    name: 'Validator',
    origin: 'laravel',
    doc: 'Facade Validasi Input Laravel (`Illuminate\\Support\\Facades\\Validator`).',
    members: [
      sm('make', [p('$data', 'array'), p('$rules', 'array'), p('$messages', 'array', true, '[]'), p('$attributes', 'array', true, '[]')], 'Validator', 'Buat instance Validator secara manual.'),
      sm('validate', [p('$data', 'array'), p('$rules', 'array'), p('$messages', 'array', true, '[]')], 'array', 'Validasi array data dan kembalikan data tervalidasi.'),
      m('fails', [], 'bool', 'Periksa apakah validasi gagal.'),
      m('passes', [], 'bool', 'Periksa apakah data lolos semua aturan validasi.'),
      m('validated', [], 'array', 'Ambil data yang telah tervalidasi.'),
      m('errors', [], 'MessageBag', 'Ambil kumpulan pesan kesalahan validasi.'),
      m('after', [p('$callback', 'callable|array')], 'Validator', 'Tambahkan hook validasi lanjutan setelah aturan dasar selesai.')
    ]
  },
  {
    name: 'Rule',
    origin: 'laravel',
    doc: 'Fluent Validation Rule Builder (`Illuminate\\Validation\\Rule`).',
    members: [
      sm('unique', [p('$table', 'string'), p('$column', 'string', true, "'NULL'")], 'Rule', 'Aturan unik database (mendukung `->ignore($user->id)` & `->where(...)`).'),
      sm('exists', [p('$table', 'string'), p('$column', 'string', true, "'NULL'")], 'Rule', 'Pastikan nilai ada di tabel database.'),
      sm('in', [p('$values', 'array|Arrayable')], 'Rule', 'Nilai wajib termasuk dalam daftar yang diberikan.'),
      sm('notIn', [p('$values', 'array|Arrayable')], 'Rule', 'Nilai tidak boleh termasuk dalam daftar yang diberikan.'),
      sm('enum', [p('$type', 'string')], 'Rule', 'Validasi nilai terhadap PHP Backed Enum.'),
      sm('requiredIf', [p('$callback', 'bool|callable')], 'Rule', 'Wajib diisi apabila kondisi terpenuhi.'),
      sm('excludeIf', [p('$callback', 'bool|callable')], 'Rule', 'Kecualikan field apabila kondisi terpenuhi.'),
      m('ignore', [p('$id', 'mixed'), p('$idColumn', 'string', true)], 'Rule', 'Abaikan ID rekaman tertentu saat mengecek keunikan (berguna pada form Edit).'),
      m('where', [p('$column', 'string|Closure'), p('$value', 'mixed', true)], 'Rule', 'Tambahkan filter tambahan pada query `unique` / `exists`.'),
      m('withoutTrashed', [], 'Rule', 'Abaikan baris yang sudah di-soft-delete saat mengecek `unique`/`exists`.')
    ]
  },
  {
    name: 'Cache',
    origin: 'laravel',
    doc: 'Facade Cache Laravel (`Illuminate\\Support\\Facades\\Cache`).',
    members: [
      sm('get', [p('$key', 'string'), p('$default', 'mixed', true)], 'mixed', 'Ambil item dari cache.'),
      sm('put', [p('$key', 'string'), p('$value', 'mixed'), p('$ttl', 'int|DateTimeInterface', true)], 'bool', 'Simpan item ke dalam cache dengan masa berlaku (detik/Carbon).'),
      sm('add', [p('$key', 'string'), p('$value', 'mixed'), p('$ttl', 'int|DateTimeInterface', true)], 'bool', 'Simpan item hanya jika key belum ada di cache.'),
      sm('forever', [p('$key', 'string'), p('$value', 'mixed')], 'bool', 'Simpan item di cache secara permanen.'),
      sm('remember', [p('$key', 'string'), p('$ttl', 'int|DateTimeInterface'), p('$callback', 'Closure')], 'mixed', 'Ambil item dari cache, atau jalankan Closure dan simpan hasilnya.'),
      sm('rememberForever', [p('$key', 'string'), p('$callback', 'Closure')], 'mixed', 'Ambil item dari cache atau hitung & simpan selamanya.'),
      sm('flexible', [p('$key', 'string'), p('$ttl', 'array'), p('$callback', 'callable')], 'mixed', 'Stale-while-revalidate cache (Laravel 11.23+).'),
      sm('pull', [p('$key', 'string'), p('$default', 'mixed', true)], 'mixed', 'Ambil item sekaligus menghapusnya dari cache.'),
      sm('has', [p('$key', 'string')], 'bool', 'Periksa apakah key tersedia di cache.'),
      sm('forget', [p('$key', 'string')], 'bool', 'Hapus item dari cache.'),
      sm('flush', [], 'bool', 'Bersihkan seluruh isi cache.'),
      sm('store', [p('$name', 'string', true)], 'Cache', 'Gunakan driver cache tertentu (redis, file, database, array).'),
      sm('lock', [p('$name', 'string'), p('$seconds', 'int', true, '0')], 'Lock', 'Buat atomic lock untuk mencegah race condition.')
    ]
  },
  {
    name: 'Storage',
    origin: 'laravel',
    doc: 'Facade Filesystem / Cloud Storage Laravel (`Illuminate\\Support\\Facades\\Storage`).',
    members: [
      sm('disk', [p('$name', 'string', true)], 'Storage', 'Pilih disk penyimpanan (`local`, `public`, `s3`).'),
      sm('get', [p('$path', 'string')], 'string|null', 'Baca isi file dari storage.'),
      sm('put', [p('$path', 'string'), p('$contents', 'string|resource'), p('$options', 'mixed', true)], 'bool', 'Tulis konten file ke storage.'),
      sm('putFile', [p('$path', 'string'), p('$file', 'UploadedFile|string')], 'string|false', 'Simpan file dengan nama hash otomatis ke direktori.'),
      sm('putFileAs', [p('$path', 'string'), p('$file', 'UploadedFile|string'), p('$name', 'string')], 'string|false', 'Simpan file dengan nama spesifik.'),
      sm('exists', [p('$path', 'string')], 'bool', 'Periksa apakah file ada di disk.'),
      sm('missing', [p('$path', 'string')], 'bool', 'Periksa apakah file tidak ada di disk.'),
      sm('download', [p('$path', 'string'), p('$name', 'string', true)], 'StreamedResponse', 'Buat respons unduhan file dari storage.'),
      sm('url', [p('$path', 'string')], 'string', 'Dapatkan URL publik untuk file.'),
      sm('temporaryUrl', [p('$path', 'string'), p('$expiration', 'DateTimeInterface')], 'string', 'Buat signed URL sementara (S3/local).'),
      sm('delete', [p('$paths', 'string|array')], 'bool', 'Hapus satu atau beberapa file.'),
      sm('copy', [p('$from', 'string'), p('$to', 'string')], 'bool', 'Salin file ke lokasi baru.'),
      sm('move', [p('$from', 'string'), p('$to', 'string')], 'bool', 'Pindahkan file ke lokasi baru.'),
      sm('files', [p('$directory', 'string', true)], 'array', 'Daftar seluruh file pada direktori.'),
      sm('makeDirectory', [p('$path', 'string')], 'bool', 'Buat direktori baru.'),
      sm('deleteDirectory', [p('$directory', 'string')], 'bool', 'Hapus direktori beserta isinya.'),
      m('put', [p('$path', 'string'), p('$contents', 'string|resource')], 'bool', 'Tulis file pada disk terpilih.'),
      m('get', [p('$path', 'string')], 'string|null', 'Baca file pada disk terpilih.'),
      m('exists', [p('$path', 'string')], 'bool', 'Cek keberadaan file pada disk terpilih.'),
      m('delete', [p('$paths', 'string|array')], 'bool', 'Hapus file pada disk terpilih.'),
      m('url', [p('$path', 'string')], 'string', 'Dapatkan URL publik dari disk terpilih.'),
      m('download', [p('$path', 'string'), p('$name', 'string', true)], 'StreamedResponse', 'Unduh file dari disk terpilih.')
    ]
  },
  {
    name: 'Http',
    origin: 'laravel',
    doc: 'Facade HTTP Client Laravel berbasis Guzzle (`Illuminate\\Support\\Facades\\Http`).',
    members: [
      sm('withToken', [p('$token', 'string'), p('$type', 'string', true, "'Bearer'")], 'Http', 'Sertakan Authorization Bearer token pada request.'),
      sm('withHeaders', [p('$headers', 'array')], 'Http', 'Tambahkan HTTP headers kustom.'),
      sm('withBasicAuth', [p('$username', 'string'), p('$password', 'string')], 'Http', 'Gunakan HTTP Basic Authentication.'),
      sm('acceptJson', [], 'Http', 'Set header `Accept: application/json`.'),
      sm('asForm', [], 'Http', 'Kirim body sebagai `application/x-www-form-urlencoded`.'),
      sm('asMultipart', [], 'Http', 'Kirim body sebagai `multipart/form-data`.'),
      sm('timeout', [p('$seconds', 'int')], 'Http', 'Batas waktu maksimum menunggu respons dalam detik.'),
      sm('retry', [p('$times', 'int'), p('$sleepMilliseconds', 'int', true, '0')], 'Http', 'Ulangi otomatis request apabila terjadi kegagalan sementara.'),
      sm('withoutVerifying', [], 'Http', 'Nonaktifkan verifikasi sertifikat SSL (hanya untuk dev lokal).'),
      sm('get', [p('$url', 'string'), p('$query', 'array|string', true)], 'HttpResponse', 'Kirim HTTP GET request.'),
      sm('post', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Kirim HTTP POST request.'),
      sm('put', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Kirim HTTP PUT request.'),
      sm('patch', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Kirim HTTP PATCH request.'),
      sm('delete', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Kirim HTTP DELETE request.'),
      sm('fake', [p('$callback', 'callable|array', true)], 'void', 'Mock respons HTTP untuk pengujian otomatis.'),
      m('withHeaders', [p('$headers', 'array')], 'Http', 'Tambahkan header pada pending request.'),
      m('timeout', [p('$seconds', 'int')], 'Http', 'Tetapkan batas timeout.'),
      m('retry', [p('$times', 'int'), p('$sleepMilliseconds', 'int', true, '0')], 'Http', 'Tetapkan kebijakan retry.'),
      m('attach', [p('$name', 'string'), p('$contents', 'string|resource'), p('$filename', 'string', true)], 'Http', 'Lampirkan file multipart.'),
      m('get', [p('$url', 'string'), p('$query', 'array|string', true)], 'HttpResponse', 'Eksekusi GET request.'),
      m('post', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Eksekusi POST request.'),
      m('put', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Eksekusi PUT request.'),
      m('patch', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Eksekusi PATCH request.'),
      m('delete', [p('$url', 'string'), p('$data', 'array', true, '[]')], 'HttpResponse', 'Eksekusi DELETE request.')
    ]
  },
  {
    name: 'HttpResponse',
    origin: 'laravel',
    doc: 'Respons HTTP Client Laravel (`Illuminate\\Http\\Client\\Response`).',
    members: [
      m('json', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Decode body JSON respons menjadi array atau ambil key dot-notation.'),
      m('body', [], 'string', 'Ambil string mentah body respons.'),
      m('collect', [p('$key', 'string', true)], 'Collection', 'Ambil data JSON respons sebagai `Collection` Laravel.'),
      m('status', [], 'int', 'Ambil kode status HTTP (200, 404, 500, dst.).'),
      m('successful', [], 'bool', 'Bernilai `true` jika kode status >= 200 dan < 300.'),
      m('ok', [], 'bool', 'Bernilai `true` jika kode status 200 OK.'),
      m('failed', [], 'bool', 'Bernilai `true` jika respons error 4xx atau 5xx.'),
      m('clientError', [], 'bool', 'Bernilai `true` jika status 4xx.'),
      m('serverError', [], 'bool', 'Bernilai `true` jika status 5xx.'),
      m('header', [p('$header', 'string')], 'string', 'Ambil nilai header dari respons.'),
      m('throw', [], 'HttpResponse', 'Lempar `RequestException` apabila terjadi error 4xx/5xx.')
    ]
  },
  {
    name: 'Collection',
    origin: 'laravel',
    doc: 'Fluent Array Wrapper Laravel (`Illuminate\\Support\\Collection`).',
    members: [
      sm('make', [p('$items', 'mixed', true, '[]')], 'Collection', 'Buat instance Collection baru.'),
      m('all', [], 'array', 'Kembalikan seluruh item dasar sebagai array PHP.'),
      m('map', [p('$callback', 'callable')], 'Collection', 'Transformasikan setiap elemen dan kembalikan Collection baru.'),
      m('filter', [p('$callback', 'callable', true)], 'Collection', 'Saring elemen menggunakan callback (atau buang nilai falsy).'),
      m('reject', [p('$callback', 'callable')], 'Collection', 'Kecualikan elemen yang memenuhi kondisi callback.'),
      m('each', [p('$callback', 'callable')], 'Collection', 'Iterasi setiap elemen pada Collection.'),
      m('reduce', [p('$callback', 'callable'), p('$initial', 'mixed', true)], 'mixed', 'Reduksi Collection menjadi satu nilai tunggal.'),
      m('pluck', [p('$value', 'string|array'), p('$key', 'string', true)], 'Collection', 'Ambil daftar nilai dari key/properti tertentu.'),
      m('keyBy', [p('$keyBy', 'callable|string')], 'Collection', 'Jadikan nilai atribut tertentu sebagai kunci array Collection.'),
      m('groupBy', [p('$groupBy', 'callable|string|array')], 'Collection', 'Kelompokkan item berdasarkan kunci/properti.'),
      m('sortBy', [p('$callback', 'callable|string|array')], 'Collection', 'Urutkan elemen secara menaik.'),
      m('sortByDesc', [p('$callback', 'callable|string')], 'Collection', 'Urutkan elemen secara menurun.'),
      m('unique', [p('$key', 'callable|string', true)], 'Collection', 'Ambil hanya item unik.'),
      m('values', [], 'Collection', 'Reset kunci array menjadi indeks berurutan 0..N.'),
      m('keys', [], 'Collection', 'Ambil seluruh kunci Collection.'),
      m('first', [p('$callback', 'callable', true), p('$default', 'mixed', true)], 'mixed', 'Ambil elemen pertama pada Collection.'),
      m('last', [p('$callback', 'callable', true), p('$default', 'mixed', true)], 'mixed', 'Ambil elemen terakhir pada Collection.'),
      m('contains', [p('$key', 'mixed'), p('$operator', 'mixed', true), p('$value', 'mixed', true)], 'bool', 'Periksa apakah item tertentu ada di dalam Collection.'),
      m('where', [p('$key', 'string'), p('$operator', 'mixed', true), p('$value', 'mixed', true)], 'Collection', 'Filter item Collection berdasarkan pasangan key/value.'),
      m('whereIn', [p('$key', 'string'), p('$values', 'mixed')], 'Collection', 'Filter item yang nilai atributnya ada di dalam array.'),
      m('whereNotNull', [p('$key', 'string', true)], 'Collection', 'Filter item yang atributnya tidak null.'),
      m('chunk', [p('$size', 'int')], 'Collection', 'Pecah Collection menjadi beberapa potongan lebih kecil.'),
      m('collapse', [], 'Collection', 'Ratakan array multidimensi satu tingkat menjadi satu Collection.'),
      m('flatten', [p('$depth', 'int', true)], 'Collection', 'Ratakan array bersarang menjadi satu dimensi.'),
      m('merge', [p('$items', 'mixed')], 'Collection', 'Gabungkan item ke dalam Collection.'),
      m('take', [p('$limit', 'int')], 'Collection', 'Ambil sejumlah item pertama (atau terakhir jika negatif).'),
      m('sum', [p('$callback', 'callable|string', true)], 'int|float', 'Hitung jumlah total elemen atau atribut.'),
      m('avg', [p('$callback', 'callable|string', true)], 'int|float|null', 'Hitung rata-rata elemen atau atribut.'),
      m('count', [], 'int', 'Hitung jumlah total elemen di dalam Collection.'),
      m('isEmpty', [], 'bool', 'Bernilai `true` jika Collection kosong.'),
      m('isNotEmpty', [], 'bool', 'Bernilai `true` jika Collection memiliki minimal 1 item.'),
      m('implode', [p('$value', 'string'), p('$glue', 'string', true)], 'string', 'Gabungkan elemen menjadi string.'),
      m('toArray', [], 'array', 'Konversi rekursif seluruh elemen menjadi array murni.'),
      m('toJson', [p('$options', 'int', true, '0')], 'string', 'Konversi Collection menjadi string JSON.')
    ]
  },
  {
    name: 'Str',
    origin: 'laravel',
    doc: 'Helper Manipulasi String & UUID Laravel (`Illuminate\\Support\\Str`).',
    members: [
      sm('of', [p('$string', 'string')], 'Str', 'Buat objek fluent `Stringable`.'),
      sm('slug', [p('$title', 'string'), p('$separator', 'string', true, "'-'")], 'string', 'Buat URL-friendly slug dari teks.'),
      sm('uuid', [], 'string', 'Hasilkan UUID v4 unik.'),
      sm('ulid', [], 'string', 'Hasilkan ULID yang terurut secara leksikografis.'),
      sm('random', [p('$length', 'int', true, '16')], 'string', 'Hasilkan string acak kriptografis aman.'),
      sm('password', [p('$length', 'int', true, '32')], 'string', 'Hasilkan password acak aman.'),
      sm('camel', [p('$value', 'string')], 'string', 'Ubah string menjadi `camelCase`.'),
      sm('snake', [p('$value', 'string'), p('$delimiter', 'string', true, "'_'")], 'string', 'Ubah string menjadi `snake_case`.'),
      sm('kebab', [p('$value', 'string')], 'string', 'Ubah string menjadi `kebab-case`.'),
      sm('studly', [p('$value', 'string')], 'string', 'Ubah string menjadi `StudlyCase` / PascalCase.'),
      sm('title', [p('$value', 'string')], 'string', 'Ubah string menjadi `Title Case`.'),
      sm('headline', [p('$value', 'string')], 'string', 'Ubah identifier menjadi judul rapi yang mudah dibaca.'),
      sm('lower', [p('$value', 'string')], 'string', 'Ubah ke huruf kecil UTF-8.'),
      sm('upper', [p('$value', 'string')], 'string', 'Ubah ke huruf besar UTF-8.'),
      sm('limit', [p('$value', 'string'), p('$limit', 'int', true, '100'), p('$end', 'string', true, "'...'")], 'string', 'Potong panjang karakter string.'),
      sm('words', [p('$value', 'string'), p('$words', 'int', true, '100')], 'string', 'Batasi jumlah kata pada string.'),
      sm('contains', [p('$haystack', 'string'), p('$needles', 'string|iterable'), p('$ignoreCase', 'bool', true, 'false')], 'bool', 'Periksa apakah string mengandung substring tertentu.'),
      sm('startsWith', [p('$haystack', 'string'), p('$needles', 'string|iterable')], 'bool', 'Periksa awalan string.'),
      sm('endsWith', [p('$haystack', 'string'), p('$needles', 'string|iterable')], 'bool', 'Periksa akhiran string.'),
      sm('after', [p('$subject', 'string'), p('$search', 'string')], 'string', 'Ambil bagian teks setelah kemunculan pertama substring.'),
      sm('before', [p('$subject', 'string'), p('$search', 'string')], 'string', 'Ambil bagian teks sebelum substring.'),
      sm('between', [p('$subject', 'string'), p('$from', 'string'), p('$to', 'string')], 'string', 'Ambil potongan teks di antara dua pembatas.'),
      sm('mask', [p('$string', 'string'), p('$character', 'string'), p('$index', 'int'), p('$length', 'int', true)], 'string', 'Samarkan sebagian karakter sensitif (mis. nomor telepon/email).'),
      sm('replace', [p('$search', 'string|iterable'), p('$replace', 'string|iterable'), p('$subject', 'string|iterable')], 'string', 'Ganti kemunculan teks.'),
      sm('plural', [p('$value', 'string'), p('$count', 'int', true, '2')], 'string', 'Bentuk jamak bahasa Inggris.'),
      sm('singular', [p('$value', 'string')], 'string', 'Bentuk tunggal bahasa Inggris.'),
      sm('isUuid', [p('$value', 'mixed')], 'bool', 'Periksa apakah nilai merupakan UUID valid.'),
      m('trim', [], 'Str', 'Hapus spasi di awal & akhir fluent string.'),
      m('slug', [p('$separator', 'string', true, "'-'")], 'Str', 'Ubah fluent string menjadi slug.'),
      m('camel', [], 'Str', 'Ubah fluent string menjadi camelCase.'),
      m('snake', [], 'Str', 'Ubah fluent string menjadi snake_case.'),
      m('replace', [p('$search', 'string'), p('$replace', 'string')], 'Str', 'Ganti teks pada fluent string.'),
      m('limit', [p('$limit', 'int', true, '100')], 'Str', 'Batasi panjang karakter fluent string.'),
      m('toString', [], 'string', 'Kembalikan string PHP murni.')
    ]
  },
  {
    name: 'Arr',
    origin: 'laravel',
    doc: 'Helper Manipulasi Array Dot-Notation Laravel (`Illuminate\\Support\\Arr`).',
    members: [
      sm('get', [p('$array', 'ArrayAccess|array'), p('$key', 'string|int|null'), p('$default', 'mixed', true)], 'mixed', 'Ambil item dari array bersarang menggunakan dot notation.'),
      sm('set', [p('&$array', 'array'), p('$key', 'string|int|null'), p('$value', 'mixed')], 'array', 'Set nilai pada array bersarang menggunakan dot notation.'),
      sm('has', [p('$array', 'ArrayAccess|array'), p('$keys', 'string|array')], 'bool', 'Periksa keberadaan satu/beberapa kunci menggunakan dot notation.'),
      sm('forget', [p('&$array', 'array'), p('$keys', 'string|array')], 'void', 'Hapus elemen array bersarang berdasarkan dot notation.'),
      sm('only', [p('$array', 'array'), p('$keys', 'array|string')], 'array', 'Ambil hanya subset kunci tertentu dari array.'),
      sm('except', [p('$array', 'array'), p('$keys', 'array|string')], 'array', 'Kecualikan kunci tertentu dari array.'),
      sm('first', [p('$array', 'iterable'), p('$callback', 'callable', true), p('$default', 'mixed', true)], 'mixed', 'Ambil elemen pertama array yang lolos uji callback.'),
      sm('last', [p('$array', 'array'), p('$callback', 'callable', true), p('$default', 'mixed', true)], 'mixed', 'Ambil elemen terakhir array.'),
      sm('flatten', [p('$array', 'iterable'), p('$depth', 'int', true)], 'array', 'Ratakan array multidimensi menjadi 1 dimensi.'),
      sm('pluck', [p('$array', 'iterable'), p('$value', 'string|array'), p('$key', 'string|array', true)], 'array', 'Ambil daftar nilai atribut dari array.'),
      sm('where', [p('$array', 'array'), p('$callback', 'callable')], 'array', 'Filter array menggunakan callback.'),
      sm('wrap', [p('$value', 'mixed')], 'array', 'Bungkus nilai menjadi array apabila bukan array.'),
      sm('dot', [p('$array', 'iterable'), p('$prepend', 'string', true, "''")], 'array', 'Ratakan array multidimensi menjadi kunci dot notation.'),
      sm('toCssClasses', [p('$array', 'array')], 'string', 'Kompilasi kondisional daftar class CSS.')
    ]
  },
  {
    name: 'Carbon',
    origin: 'laravel',
    doc: 'Pustaka Tanggal & Waktu Laravel (`Illuminate\\Support\\Carbon` / `Carbon\\Carbon`).',
    members: [
      sm('now', [p('$tz', 'string|DateTimeZone', true)], 'Carbon', 'Ambil waktu saat ini.'),
      sm('today', [p('$tz', 'string|DateTimeZone', true)], 'Carbon', 'Ambil tanggal hari ini pukul 00:00:00.'),
      sm('tomorrow', [p('$tz', 'string|DateTimeZone', true)], 'Carbon', 'Ambil tanggal besok.'),
      sm('yesterday', [p('$tz', 'string|DateTimeZone', true)], 'Carbon', 'Ambil tanggal kemarin.'),
      sm('parse', [p('$time', 'string|DateTimeInterface'), p('$tz', 'string|DateTimeZone', true)], 'Carbon', 'Parse string tanggal/waktu menjadi instance Carbon.'),
      sm('createFromFormat', [p('$format', 'string'), p('$time', 'string'), p('$tz', 'string', true)], 'Carbon', 'Buat instance Carbon dari pola format spesifik.'),
      m('format', [p('$format', 'string')], 'string', 'Format tanggal mengikuti pola PHP DateTime (mis. `Y-m-d H:i:s`).'),
      m('translatedFormat', [p('$format', 'string')], 'string', 'Format tanggal terlokalisasi sesuai bahasa aplikasi (mis. `d F Y`).'),
      m('isoFormat', [p('$format', 'string')], 'string', 'Format tanggal menggunakan token ISO/Moment.'),
      m('toDateString', [], 'string', 'Format sebagai `YYYY-MM-DD`.'),
      m('toDateTimeString', [], 'string', 'Format sebagai `YYYY-MM-DD HH:MM:SS`.'),
      m('toIso8601String', [], 'string', 'Format sebagai string standar ISO-8601.'),
      m('diffForHumans', [p('$other', 'Carbon', true)], 'string', 'Selisih waktu ramah manusia (mis. "5 menit yang lalu").'),
      m('diffInDays', [p('$date', 'Carbon', true)], 'float', 'Hitung selisih hari.'),
      m('addDays', [p('$value', 'int', true, '1')], 'Carbon', 'Tambah sejumlah hari.'),
      m('subDays', [p('$value', 'int', true, '1')], 'Carbon', 'Kurangi sejumlah hari.'),
      m('addMonths', [p('$value', 'int', true, '1')], 'Carbon', 'Tambah sejumlah bulan.'),
      m('subMonths', [p('$value', 'int', true, '1')], 'Carbon', 'Kurangi sejumlah bulan.'),
      m('addHours', [p('$value', 'int', true, '1')], 'Carbon', 'Tambah sejumlah jam.'),
      m('startOfDay', [], 'Carbon', 'Set waktu ke 00:00:00.'),
      m('endOfDay', [], 'Carbon', 'Set waktu ke 23:59:59.'),
      m('startOfMonth', [], 'Carbon', 'Set ke awal bulan.'),
      m('endOfMonth', [], 'Carbon', 'Set ke akhir bulan.'),
      m('isToday', [], 'bool', 'Periksa apakah tanggal adalah hari ini.'),
      m('isPast', [], 'bool', 'Periksa apakah waktu sudah lewat.'),
      m('isFuture', [], 'bool', 'Periksa apakah waktu berada di masa depan.'),
      m('between', [p('$date1', 'Carbon'), p('$date2', 'Carbon')], 'bool', 'Periksa apakah berada di antara dua tanggal.'),
      m('copy', [], 'Carbon', 'Buat salinan objek Carbon tanpa memutasi objek asli.')
    ]
  },
  {
    name: 'Log',
    origin: 'laravel',
    doc: 'Facade Pencatatan Log Aplikasi (`Illuminate\\Support\\Facades\\Log`).',
    members: [
      sm('info', [p('$message', 'string'), p('$context', 'array', true, '[]')], 'void', 'Catat pesan log tingkat INFO.'),
      sm('warning', [p('$message', 'string'), p('$context', 'array', true, '[]')], 'void', 'Catat pesan log tingkat WARNING.'),
      sm('error', [p('$message', 'string'), p('$context', 'array', true, '[]')], 'void', 'Catat pesan log tingkat ERROR.'),
      sm('debug', [p('$message', 'string'), p('$context', 'array', true, '[]')], 'void', 'Catat informasi debugging.'),
      sm('critical', [p('$message', 'string'), p('$context', 'array', true, '[]')], 'void', 'Catat kegagalan tingkat CRITICAL.'),
      sm('channel', [p('$channel', 'string', true)], 'Log', 'Tulis log ke channel spesifik di `config/logging.php`.')
    ]
  },
  {
    name: 'Hash',
    origin: 'laravel',
    doc: 'Facade Hashing Password Bcrypt/Argon2 (`Illuminate\\Support\\Facades\\Hash`).',
    members: [
      sm('make', [p('$value', 'string'), p('$options', 'array', true, '[]')], 'string', 'Hash password secara aman menggunakan Bcrypt/Argon2.'),
      sm('check', [p('$value', 'string'), p('$hashedValue', 'string')], 'bool', 'Verifikasi kecocokan teks biasa dengan hash password.'),
      sm('needsRehash', [p('$hashedValue', 'string')], 'bool', 'Periksa apakah hash perlu diperbarui ke faktor kerja terbaru.')
    ]
  },
  {
    name: 'Crypt',
    origin: 'laravel',
    doc: 'Facade Enkripsi AES-256-CBC Laravel (`Illuminate\\Support\\Facades\\Crypt`).',
    members: [
      sm('encryptString', [p('$value', 'string')], 'string', 'Enkripsi string menggunakan `APP_KEY` aplikasi.'),
      sm('decryptString', [p('$payload', 'string')], 'string', 'Dekripsi string yang dienkripsi oleh Crypt.'),
      sm('encrypt', [p('$value', 'mixed')], 'string', 'Enkripsi nilai/objek dengan serialisasi.'),
      sm('decrypt', [p('$payload', 'string')], 'mixed', 'Dekripsi nilai terenkripsi.')
    ]
  },
  {
    name: 'Session',
    origin: 'laravel',
    doc: 'Facade & Manager Sesi Pengguna (`Illuminate\\Support\\Facades\\Session`).',
    members: [
      sm('get', [p('$key', 'string'), p('$default', 'mixed', true)], 'mixed', 'Ambil item dari sesi.'),
      sm('put', [p('$key', 'string|array'), p('$value', 'mixed', true)], 'void', 'Simpan key/value ke dalam sesi.'),
      sm('push', [p('$key', 'string'), p('$value', 'mixed')], 'void', 'Tambahkan nilai ke array di dalam sesi.'),
      sm('has', [p('$key', 'string|array')], 'bool', 'Periksa apakah item ada dan tidak bernilai null.'),
      sm('exists', [p('$key', 'string|array')], 'bool', 'Periksa apakah key ada di sesi sekalipun bernilai null.'),
      sm('flash', [p('$key', 'string'), p('$value', 'mixed', true, 'true')], 'void', 'Simpan data flash untuk satu request berikutnya.'),
      sm('forget', [p('$keys', 'string|array')], 'void', 'Hapus satu atau beberapa item dari sesi.'),
      sm('flush', [], 'void', 'Hapus seluruh data sesi.'),
      sm('regenerate', [p('$destroy', 'bool', true, 'false')], 'bool', 'Regenerasi ID sesi untuk mencegah serangan session fixation.'),
      m('get', [p('$key', 'string'), p('$default', 'mixed', true)], 'mixed', 'Ambil data dari sesi.'),
      m('put', [p('$key', 'string|array'), p('$value', 'mixed', true)], 'void', 'Simpan data ke sesi.'),
      m('flash', [p('$key', 'string'), p('$value', 'mixed', true, 'true')], 'void', 'Flash data ke sesi.'),
      m('forget', [p('$keys', 'string|array')], 'void', 'Hapus item dari sesi.'),
      m('regenerate', [p('$destroy', 'bool', true, 'false')], 'bool', 'Regenerasi ID sesi.'),
      m('invalidate', [], 'bool', 'Kosongkan sesi sekaligus regenerasi ID sesi.')
    ]
  },
  {
    name: 'Mail',
    origin: 'laravel',
    doc: 'Facade Pengiriman Email (`Illuminate\\Support\\Facades\\Mail`).',
    members: [
      sm('to', [p('$users', 'mixed')], 'Mail', 'Tentukan penerima utama email.'),
      sm('cc', [p('$users', 'mixed')], 'Mail', 'Tambahkan penerima tembusan CC.'),
      sm('bcc', [p('$users', 'mixed')], 'Mail', 'Tambahkan penerima BCC.'),
      sm('raw', [p('$text', 'string'), p('$callback', 'callable')], 'void', 'Kirim email teks biasa secara cepat.'),
      m('send', [p('$mailable', 'Mailable')], 'void', 'Kirim objek Mailable secara langsung.'),
      m('queue', [p('$mailable', 'Mailable')], 'mixed', 'Masukkan pengiriman Mailable ke antrean latar belakang.'),
      m('later', [p('$delay', 'DateTimeInterface|int'), p('$mailable', 'Mailable')], 'mixed', 'Jadwalkan pengiriman email tertunda.')
    ]
  },
  {
    name: 'Artisan',
    origin: 'laravel',
    doc: 'Facade Eksekusi Perintah CLI Artisan (`Illuminate\\Support\\Facades\\Artisan`).',
    members: [
      sm('call', [p('$command', 'string'), p('$parameters', 'array', true, '[]')], 'int', 'Jalankan perintah Artisan secara terprogram.'),
      sm('queue', [p('$command', 'string'), p('$parameters', 'array', true, '[]')], 'PendingDispatch', 'Antrekan eksekusi perintah Artisan di background worker.'),
      sm('output', [], 'string', 'Ambil teks output dari eksekusi Artisan terakhir.')
    ]
  },
  {
    name: 'Config',
    origin: 'laravel',
    doc: 'Facade Konfigurasi Aplikasi (`Illuminate\\Support\\Facades\\Config`).',
    members: [
      sm('get', [p('$key', 'string|array'), p('$default', 'mixed', true)], 'mixed', 'Baca nilai konfigurasi dengan notasi titik (mis. `app.timezone`).'),
      sm('set', [p('$key', 'string|array'), p('$value', 'mixed', true)], 'void', 'Ubah nilai konfigurasi saat runtime.'),
      sm('has', [p('$key', 'string')], 'bool', 'Periksa apakah key konfigurasi tersedia.')
    ]
  },
  {
    name: 'View',
    origin: 'laravel',
    doc: 'Facade Template View Laravel (`Illuminate\\Support\\Facades\\View`).',
    members: [
      sm('make', [p('$view', 'string'), p('$data', 'array', true, '[]')], 'View', 'Render template Blade berdasarkan dot-notation.'),
      sm('exists', [p('$view', 'string')], 'bool', 'Periksa apakah file view Blade tersedia.'),
      sm('share', [p('$key', 'array|string'), p('$value', 'mixed', true)], 'mixed', 'Bagikan variabel global ke seluruh template Blade.'),
      sm('composer', [p('$views', 'array|string'), p('$callback', 'Closure|string')], 'array', 'Daftarkan View Composer untuk menyuplai data otomatis.'),
      m('with', [p('$key', 'string|array'), p('$value', 'mixed', true)], 'View', 'Kirim variabel data ke dalam template Blade.'),
      m('render', [], 'string', 'Render isi view menjadi string HTML.')
    ]
  },
  {
    name: 'URL',
    origin: 'laravel',
    doc: 'Facade Pembuat URL & Signed Route (`Illuminate\\Support\\Facades\\URL`).',
    members: [
      sm('to', [p('$path', 'string'), p('$extra', 'mixed', true, '[]')], 'string', 'Hasilkan URL absolut ke path tertentu.'),
      sm('route', [p('$name', 'string'), p('$parameters', 'mixed', true, '[]')], 'string', 'Hasilkan URL ke named route.'),
      sm('signedRoute', [p('$name', 'string'), p('$parameters', 'mixed', true, '[]'), p('$expiration', 'DateTimeInterface|int', true)], 'string', 'Hasilkan URL route bertanda tangan kriptografis anti-manipulasi.'),
      sm('temporarySignedRoute', [p('$name', 'string'), p('$expiration', 'DateTimeInterface|int'), p('$parameters', 'mixed', true, '[]')], 'string', 'Hasilkan signed URL berbatas waktu.'),
      sm('current', [], 'string', 'Dapatkan URL halaman saat ini.'),
      sm('previous', [p('$fallback', 'mixed', true, 'false')], 'string', 'Dapatkan URL halaman sebelumnya.')
    ]
  }
];

export const CORE_LARAVEL_FUNCTIONS: PhpFunctionMeta[] = [
  fn('route', [p('$name', 'string'), p('$parameters', 'mixed', true, '[]'), p('$absolute', 'bool', true, 'true')], 'string', 'Hasilkan URL untuk named route Laravel.'),
  fn('to_route', [p('$route', 'string'), p('$parameters', 'mixed', true, '[]'), p('$status', 'int', true, '302')], 'RedirectResponse', 'Buat HTTP redirect langsung menuju named route.'),
  fn('view', [p('$view', 'string', true), p('$data', 'array', true, '[]'), p('$mergeData', 'array', true, '[]')], 'View', 'Render template Blade dari direktori `resources/views`.'),
  fn('redirect', [p('$to', 'string', true), p('$status', 'int', true, '302')], 'RedirectResponse', 'Kembalikan instance `RedirectResponse` atau alihkan ke path.'),
  fn('back', [p('$status', 'int', true, '302'), p('$headers', 'array', true, '[]')], 'RedirectResponse', 'Buat redirect kembali ke halaman sebelumnya.'),
  fn('response', [p('$content', 'mixed', true, "''"), p('$status', 'int', true, '200'), p('$headers', 'array', true, '[]')], 'Response', 'Buat HTTP response atau akses factory `response()->json(...)`.'),
  fn('request', [p('$key', 'array|string', true), p('$default', 'mixed', true)], 'Request', 'Ambil instance `Request` aktif atau baca nilai input tertentu.'),
  fn('auth', [p('$guard', 'string', true)], 'Auth', 'Ambil instance autentikasi Laravel (`auth()->user()`, `auth()->id()`).'),
  fn('config', [p('$key', 'array|string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil atau atur nilai konfigurasi aplikasi (`config("app.name")`).'),
  fn('env', [p('$key', 'string'), p('$default', 'mixed', true)], 'mixed', 'Baca variabel environment (gunakan hanya di dalam file `config/*.php`).'),
  fn('session', [p('$key', 'array|string', true), p('$default', 'mixed', true)], 'Session', 'Ambil/simpan nilai ke session atau akses instance Session.'),
  fn('cookie', [p('$name', 'string', true), p('$value', 'string', true), p('$minutes', 'int', true, '0')], 'CookieJar', 'Buat cookie HTTP baru.'),
  fn('cache', [p('$arguments', 'mixed', true)], 'Cache', 'Ambil/simpan data dari cache Laravel.'),
  fn('collect', [p('$value', 'mixed', true, '[]')], 'Collection', 'Bungkus array/item menjadi instance fluent `Collection`.'),
  fn('str', [p('$string', 'string', true)], 'Str', 'Buat objek fluent `Stringable` atau akses helper `Str`.'),
  fn('now', [p('$tz', 'DateTimeZone|string', true)], 'Carbon', 'Buat objek `Carbon` berisi tanggal & waktu saat ini.'),
  fn('today', [p('$tz', 'DateTimeZone|string', true)], 'Carbon', 'Buat objek `Carbon` untuk awal hari ini.'),
  fn('old', [p('$key', 'string', true), p('$default', 'mixed', true)], 'mixed', 'Ambil input lama yang di-flash ke sesi setelah kegagalan validasi.'),
  fn('csrf_token', [], 'string', 'Ambil nilai CSRF token sesi aktif.'),
  fn('csrf_field', [], 'HtmlString', 'Hasilkan elemen HTML `<input type="hidden" name="_token">`.'),
  fn('method_field', [p('$method', 'string')], 'HtmlString', 'Hasilkan hidden input `_method` untuk spoofing PUT/PATCH/DELETE.'),
  fn('validator', [p('$data', 'array', true), p('$rules', 'array', true, '[]'), p('$messages', 'array', true, '[]')], 'Validator', 'Buat instance Validator baru.'),
  fn('abort', [p('$code', 'int|Response'), p('$message', 'string', true, "''"), p('$headers', 'array', true, '[]')], 'never', 'Lempar HTTP Exception (mis. 403, 404, 500).'),
  fn('abort_if', [p('$boolean', 'bool'), p('$code', 'int'), p('$message', 'string', true, "''")], 'void', 'Lempar HTTP Exception apabila kondisi bernilai `true`.'),
  fn('abort_unless', [p('$boolean', 'bool'), p('$code', 'int'), p('$message', 'string', true, "''")], 'void', 'Lempar HTTP Exception kecuali kondisi bernilai `true`.'),
  fn('throw_if', [p('$condition', 'mixed'), p('$exception', 'Throwable|string'), p('...$parameters', 'mixed', true)], 'mixed', 'Lempar exception apabila kondisi terpenuhi.'),
  fn('throw_unless', [p('$condition', 'mixed'), p('$exception', 'Throwable|string'), p('...$parameters', 'mixed', true)], 'mixed', 'Lempar exception kecuali kondisi terpenuhi.'),
  fn('dd', [p('...$vars', 'mixed')], 'never', 'Dump isi variabel secara terformat dan hentikan eksekusi skrip.'),
  fn('dump', [p('...$vars', 'mixed')], 'mixed', 'Tampilkan isi variabel tanpa menghentikan eksekusi skrip.'),
  fn('logger', [p('$message', 'string', true), p('$context', 'array', true, '[]')], 'Log', 'Tulis pesan debug ke log aplikasi.'),
  fn('info', [p('$message', 'string'), p('$context', 'array', true, '[]')], 'void', 'Tulis pesan informasi ke log Laravel.'),
  fn('report', [p('$exception', 'Throwable|string')], 'void', 'Laporkan exception ke exception handler tanpa merender halaman error.'),
  fn('rescue', [p('$callback', 'callable'), p('$rescue', 'mixed', true), p('$report', 'bool', true, 'true')], 'mixed', 'Tangkap exception dari Closure dan kembalikan nilai cadangan dengan aman.'),
  fn('retry', [p('$times', 'int|array'), p('$callback', 'callable'), p('$sleepMilliseconds', 'int', true, '0')], 'mixed', 'Coba ulang eksekusi callback yang berpotensi gagal beberapa kali.'),
  fn('tap', [p('$value', 'mixed'), p('$callback', 'callable', true)], 'mixed', 'Panggil Closure dengan nilai tersebut lalu kembalikan nilai aslinya.'),
  fn('value', [p('$value', 'mixed'), p('...$args', 'mixed', true)], 'mixed', 'Kembalikan nilai default, atau eksekusi jika berupa Closure.'),
  fn('blank', [p('$value', 'mixed')], 'bool', 'Periksa apakah nilai kosong (`null`, string spasi, array/Collection kosong).'),
  fn('filled', [p('$value', 'mixed')], 'bool', 'Kebalikan `blank()` — bernilai `true` jika berisi data.'),
  fn('optional', [p('$value', 'mixed', true), p('$callback', 'callable', true)], 'mixed', 'Akses properti/method objek dengan aman tanpa error jika objek bernilai `null`.'),
  fn('data_get', [p('$target', 'mixed'), p('$key', 'string|array|int|null'), p('$default', 'mixed', true)], 'mixed', 'Ambil nilai dari array atau objek bersarang memakai dot notation / wildcard `*`.'),
  fn('data_set', [p('&$target', 'mixed'), p('$key', 'string|array'), p('$value', 'mixed'), p('$overwrite', 'bool', true, 'true')], 'mixed', 'Tetapkan nilai pada array/objek bersarang dengan dot notation.'),
  fn('class_basename', [p('$class', 'string|object')], 'string', 'Ambil nama class tanpa namespace.'),
  fn('e', [p('$value', 'string|null'), p('$doubleEncode', 'bool', true, 'true')], 'string', 'Escape karakter spesial HTML (`htmlspecialchars` UTF-8 aman).'),
  fn('__', [p('$key', 'string', true), p('$replace', 'array', true, '[]'), p('$locale', 'string', true)], 'string|array|null', 'Terjemahkan pesan atau kunci lokalisasi multi-bahasa.'),
  fn('trans', [p('$key', 'string', true), p('$replace', 'array', true, '[]'), p('$locale', 'string', true)], 'string|array', 'Terjemahkan kunci bahasa menggunakan Translator Laravel.'),
  fn('trans_choice', [p('$key', 'string'), p('$number', 'Countable|int|array'), p('$replace', 'array', true, '[]')], 'string', 'Terjemahkan pesan dengan bentuk jamak sesuai jumlah.'),
  fn('asset', [p('$path', 'string'), p('$secure', 'bool', true)], 'string', 'Hasilkan URL ke aset statis di folder `public/`.'),
  fn('secure_asset', [p('$path', 'string')], 'string', 'Hasilkan URL HTTPS ke aset statis di folder `public/`.'),
  fn('url', [p('$path', 'string', true), p('$extra', 'mixed', true, '[]'), p('$secure', 'bool', true)], 'string', 'Hasilkan URL lengkap untuk aplikasi.'),
  fn('storage_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju direktori `storage/`.'),
  fn('public_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju direktori `public/`.'),
  fn('base_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju root proyek Laravel.'),
  fn('app_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju direktori `app/`.'),
  fn('config_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju direktori `config/`.'),
  fn('database_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju direktori `database/`.'),
  fn('resource_path', [p('$path', 'string', true, "''")], 'string', 'Dapatkan path absolut menuju direktori `resources/`.'),
  fn('bcrypt', [p('$value', 'string'), p('$options', 'array', true, '[]')], 'string', 'Hash string menggunakan algoritma Bcrypt.'),
  fn('encrypt', [p('$value', 'mixed')], 'string', 'Enkripsi nilai menggunakan encrypter Laravel.'),
  fn('decrypt', [p('$value', 'string')], 'mixed', 'Dekripsi nilai terenkripsi.'),
  fn('event', [p('...$args', 'mixed')], 'array|null', 'Kirim (dispatch) sebuah Event ke seluruh listener terdaftar.'),
  fn('dispatch', [p('$job', 'object|Closure')], 'PendingDispatch', 'Kirim Job ke dalam antrean (Queue) Laravel.'),
  fn('dispatch_sync', [p('$job', 'object'), p('$handler', 'mixed', true)], 'mixed', 'Jalankan Job secara sinkron saat itu juga.')
];

export const CORE_BLADE_DIRECTIVES: LaravelBladeDirectiveMeta[] = [
  {
    name: '@extends',
    insertText: "@extends('${1:layouts.app}')",
    detail: 'Blade Layout Inheritance',
    doc: 'Mewarisi layout induk Blade dari folder `resources/views`.',
    hasArguments: true
  },
  {
    name: '@section',
    insertText: "@section('${1:content}')\n\t$0\n@endsection",
    detail: 'Blade Content Section',
    doc: 'Mendefinisikan blok bagian konten yang akan dimasukkan ke `@yield` pada layout induk.',
    hasArguments: true
  },
  {
    name: '@endsection',
    insertText: '@endsection',
    detail: 'Penutup @section',
    doc: 'Menutup blok `@section`.'
  },
  {
    name: '@yield',
    insertText: "@yield('${1:content}')",
    detail: 'Blade Yield Placeholder',
    doc: 'Menampilkan isi dari `@section` anak pada posisi ini.',
    hasArguments: true
  },
  {
    name: '@include',
    insertText: "@include('${1:partials.header}')",
    detail: 'Blade Partial Include',
    doc: 'Menyertakan sub-view Blade lain beserta seluruh variabel aktif.',
    hasArguments: true
  },
  {
    name: '@includeIf',
    insertText: "@includeIf('${1:partials.notice}', [${2}])",
    detail: 'Safe Conditional Include',
    doc: 'Menyertakan sub-view hanya apabila file view tersebut benar-benar ada.',
    hasArguments: true
  },
  {
    name: '@includeWhen',
    insertText: "@includeWhen(${1:\\$kondisi}, '${2:partials.banner}')",
    detail: 'Boolean Conditional Include',
    doc: 'Menyertakan sub-view apabila ekspresi boolean bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@each',
    insertText: "@each('${1:partials.item}', ${2:\\$items}, '${3:item}', '${4:partials.empty}')",
    detail: 'Blade Loop Partial',
    doc: 'Render sebuah partial view untuk setiap elemen koleksi dalam satu baris.',
    hasArguments: true
  },
  {
    name: '@props',
    insertText: "@props(['${1:title}' => ${2:null}])",
    detail: 'Anonymous Blade Component Props',
    doc: 'Deklarasikan daftar properti komponen Blade anonim di bagian atas file komponen.',
    hasArguments: true
  },
  {
    name: '@aware',
    insertText: "@aware(['${1:color}' => '${2:primary}'])",
    detail: 'Parent Component Data Access',
    doc: 'Akses properti milik komponen induk dari komponen anak.',
    hasArguments: true
  },
  {
    name: '@if',
    insertText: '@if (${1:\\$condition})\n\t$0\n@endif',
    detail: 'Blade Conditional @if',
    doc: 'Percabangan kondisional `@if ... @endif`.',
    hasArguments: true
  },
  {
    name: '@elseif',
    insertText: '@elseif (${1:\\$condition})',
    detail: 'Blade @elseif',
    doc: 'Cabang lanjutan dari blok `@if`.',
    hasArguments: true
  },
  {
    name: '@else',
    insertText: '@else',
    detail: 'Blade @else',
    doc: 'Blok alternatif ketika kondisi `@if` tidak terpenuhi.'
  },
  {
    name: '@endif',
    insertText: '@endif',
    detail: 'Penutup @if',
    doc: 'Menutup blok `@if`.'
  },
  {
    name: '@unless',
    insertText: '@unless (${1:\\$condition})\n\t$0\n@endunless',
    detail: 'Blade Negative Conditional',
    doc: 'Menjalankan blok kecuali ekspresi bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@isset',
    insertText: '@isset(${1:\\$record})\n\t$0\n@endisset',
    detail: 'Blade isset() Check',
    doc: 'Render isi blok jika variabel terdefinisi dan tidak null.',
    hasArguments: true
  },
  {
    name: '@empty',
    insertText: '@empty(${1:\\$items})\n\t$0\n@endempty',
    detail: 'Blade empty() Check',
    doc: 'Render isi blok jika variabel kosong.',
    hasArguments: true
  },
  {
    name: '@foreach',
    insertText: '@foreach (${1:\\$items} as ${2:\\$item})\n\t$0\n@endforeach',
    detail: 'Blade Loop @foreach',
    doc: 'Perulangan koleksi/array lengkap dengan objek `$loop` (`$loop->iteration`, `$loop->first`).',
    hasArguments: true
  },
  {
    name: '@endforeach',
    insertText: '@endforeach',
    detail: 'Penutup @foreach',
    doc: 'Menutup perulangan `@foreach`.'
  },
  {
    name: '@forelse',
    insertText: '@forelse (${1:\\$items} as ${2:\\$item})\n\t$0\n@empty\n\t<p>Belum ada data.</p>\n@endforelse',
    detail: 'Blade Loop with Empty Fallback',
    doc: 'Perulangan koleksi dengan blok cadangan `@empty` otomatis jika data kosong.',
    hasArguments: true
  },
  {
    name: '@for',
    insertText: '@for (\\$i = 0; \\$i < ${1:10}; \\$i++)\n\t$0\n@endfor',
    detail: 'Blade @for Loop',
    doc: 'Perulangan numerik `@for`.',
    hasArguments: true
  },
  {
    name: '@while',
    insertText: '@while (${1:\\$condition})\n\t$0\n@endwhile',
    detail: 'Blade @while Loop',
    doc: 'Perulangan `@while`.',
    hasArguments: true
  },
  {
    name: '@switch',
    insertText: '@switch(${1:\\$status})\n\t@case(${2:1})\n\t\t$0\n\t\t@break\n\t@default\n@endswitch',
    detail: 'Blade @switch Statement',
    doc: 'Pernyataan multi-cabang `@switch`.',
    hasArguments: true
  },
  {
    name: '@auth',
    insertText: '@auth\n\t$0\n@endauth',
    detail: 'Blade Authenticated Check',
    doc: 'Render blok hanya apabila pengguna saat ini telah login.'
  },
  {
    name: '@guest',
    insertText: '@guest\n\t$0\n@endguest',
    detail: 'Blade Guest Check',
    doc: 'Render blok hanya apabila pengunjung belum login.'
  },
  {
    name: '@can',
    insertText: "@can('${1:update}', ${2:\\$model})\n\t$0\n@endcan",
    detail: 'Blade Gate/Policy Authorization',
    doc: 'Render blok hanya apabila pengguna memiliki hak otorisasi Gate/Policy.',
    hasArguments: true
  },
  {
    name: '@cannot',
    insertText: "@cannot('${1:delete}', ${2:\\$model})\n\t$0\n@endcannot",
    detail: 'Blade Negative Authorization',
    doc: 'Render blok jika pengguna TIDAK memiliki hak otorisasi tertentu.',
    hasArguments: true
  },
  {
    name: '@csrf',
    insertText: '@csrf',
    detail: 'CSRF Protection Hidden Field',
    doc: 'Menghasilkan `<input type="hidden" name="_token" value="...">` wajib untuk setiap form POST/PUT/PATCH/DELETE.'
  },
  {
    name: '@method',
    insertText: "@method('${1:PUT}')",
    detail: 'HTTP Method Spoofing',
    doc: 'Menyisipkan hidden field `_method` untuk form HTML ber-verb `PUT`, `PATCH`, atau `DELETE`.',
    hasArguments: true
  },
  {
    name: '@error',
    insertText: "@error('${1:field}')\n\t<div class=\"text-danger\">{{ \\$message }}</div>\n@enderror",
    detail: 'Validation Error Message Block',
    doc: 'Menampilkan variabel `$message` apabila terdapat kesalahan validasi pada atribut tersebut.',
    hasArguments: true
  },
  {
    name: '@class',
    insertText: "@class(['${1:btn}', '${2:active}' => ${3:\\$isActive}])",
    detail: 'Conditional CSS Classes',
    doc: 'Kompilasi string atribut `class="..."` secara kondisional.',
    hasArguments: true
  },
  {
    name: '@style',
    insertText: "@style(['${1:font-weight: bold}' => ${2:\\$isImportant}])",
    detail: 'Conditional Inline Styles',
    doc: 'Kompilasi atribut `style="..."` secara kondisional.',
    hasArguments: true
  },
  {
    name: '@checked',
    insertText: '@checked(${1:old(\'active\', \\$model->active)})',
    detail: 'Conditional checked Attribute',
    doc: 'Cetak atribut `checked` pada checkbox/radio jika kondisi bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@selected',
    insertText: '@selected(${1:old(\'category_id\') == \\$category->id})',
    detail: 'Conditional selected Attribute',
    doc: 'Cetak atribut `selected` pada elemen `<option>` jika kondisi bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@disabled',
    insertText: '@disabled(${1:\\$isDisabled})',
    detail: 'Conditional disabled Attribute',
    doc: 'Cetak atribut `disabled` apabila kondisi bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@readonly',
    insertText: '@readonly(${1:\\$isReadonly})',
    detail: 'Conditional readonly Attribute',
    doc: 'Cetak atribut `readonly` apabila kondisi bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@required',
    insertText: '@required(${1:\\$isRequired})',
    detail: 'Conditional required Attribute',
    doc: 'Cetak atribut HTML `required` apabila kondisi bernilai `true`.',
    hasArguments: true
  },
  {
    name: '@vite',
    insertText: "@vite(['resources/css/app.css', 'resources/js/app.js'])",
    detail: 'Laravel Vite Asset Bundler',
    doc: 'Muat tag `<script>` & `<link>` bundel Vite lengkap dengan Hot Module Replacement.',
    hasArguments: true
  },
  {
    name: '@json',
    insertText: '@json(${1:\\$data})',
    detail: 'Safe JSON Encoding in Blade',
    doc: 'Render variabel PHP menjadi literal JSON yang telah di-escape aman untuk JavaScript.',
    hasArguments: true
  },
  {
    name: '@js',
    insertText: '@js(${1:\\$data})',
    detail: 'Safe JavaScript Expression',
    doc: 'Encode data PHP agar aman disisipkan di dalam atribut HTML / Alpine.js.',
    hasArguments: true
  },
  {
    name: '@php',
    insertText: '@php\n\t$0\n@endphp',
    detail: 'Raw PHP Block in Blade',
    doc: 'Mengeksekusi blok kode PHP murni di dalam template Blade.'
  },
  {
    name: '@push',
    insertText: "@push('${1:scripts}')\n\t$0\n@endpush",
    detail: 'Push Content to Named Stack',
    doc: 'Menambahkan skrip atau stylesheet ke dalam `@stack` pada layout utama.',
    hasArguments: true
  },
  {
    name: '@stack',
    insertText: "@stack('${1:scripts}')",
    detail: 'Render Named Stack',
    doc: 'Merender seluruh konten yang didorong melalui `@push` dan `@prepend`.',
    hasArguments: true
  },
  {
    name: '@once',
    insertText: '@once\n\t$0\n@endonce',
    detail: 'Evaluate Once Per Render Cycle',
    doc: 'Pastikan isi blok hanya dirender satu kali meskipun komponen dipanggil berulang.'
  },
  {
    name: '@verbatim',
    insertText: '@verbatim\n\t$0\n@endverbatim',
    detail: 'Skip Blade Mustache Parsing',
    doc: 'Biarkan kurung kurawal `{{ ... }}` untuk Vue/Alpine tanpa dievaluasi oleh Blade.'
  },
  {
    name: '@dd',
    insertText: '@dd(${1:\\$variable})',
    detail: 'Dump and Die in Blade',
    doc: 'Dump isi variabel dan hentikan proses render view.',
    hasArguments: true
  },
  {
    name: '@dump',
    insertText: '@dump(${1:\\$variable})',
    detail: 'Dump Variable in Blade',
    doc: 'Tampilkan isi variabel di halaman untuk inspeksi cepat.',
    hasArguments: true
  },
  {
    name: '@livewire',
    insertText: "@livewire('${1:component-name}')",
    detail: 'Render Livewire Component',
    doc: 'Merender komponen interaktif Laravel Livewire.',
    hasArguments: true
  }
];

export const CORE_VALIDATION_RULES: LaravelValidationRuleMeta[] = [
  { name: 'required', insertText: 'required', detail: 'Wajib diisi', doc: 'Field harus tersedia di dalam data input dan tidak kosong.' },
  { name: 'nullable', insertText: 'nullable', detail: 'Boleh bernilai null', doc: 'Mengizinkan nilai field berupa `null`.' },
  { name: 'sometimes', insertText: 'sometimes', detail: 'Validasi hanya jika field dikirim', doc: 'Jalankan validasi pada field ini hanya bila kunci ada di array input.' },
  { name: 'bail', insertText: 'bail', detail: 'Hentikan validasi pada error pertama', doc: 'Berhenti mengecek aturan berikutnya pada field ini begitu satu aturan gagal.' },
  { name: 'string', insertText: 'string', detail: 'Tipe teks string', doc: 'Nilai harus berupa tipe `string`.' },
  { name: 'integer', insertText: 'integer', detail: 'Bilangan bulat', doc: 'Nilai harus berupa bilangan bulat integer.' },
  { name: 'numeric', insertText: 'numeric', detail: 'Angka numerik', doc: 'Nilai harus berupa angka (integer maupun desimal).' },
  { name: 'decimal:', insertText: 'decimal:${1:0,2}', detail: 'Angka desimal presisi', doc: 'Nilai numerik dengan jumlah digit desimal tertentu.' },
  { name: 'boolean', insertText: 'boolean', detail: 'Nilai boolean', doc: 'Menerima `true`, `false`, `1`, `0`, `"1"`, `"0"`.' },
  { name: 'array', insertText: 'array', detail: 'Array PHP', doc: 'Nilai harus berupa `array`.' },
  { name: 'json', insertText: 'json', detail: 'String JSON valid', doc: 'Nilai harus berupa string JSON yang valid.' },
  { name: 'email', insertText: 'email', detail: 'Format alamat email', doc: 'Nilai harus berformat alamat email yang sah (bisa `email:rfc,dns`).' },
  { name: 'url', insertText: 'url', detail: 'Format URL HTTP/HTTPS', doc: 'Nilai harus berupa URL yang valid.' },
  { name: 'uuid', insertText: 'uuid', detail: 'Format UUID', doc: 'Nilai harus berupa UUID standar.' },
  { name: 'ulid', insertText: 'ulid', detail: 'Format ULID', doc: 'Nilai harus berupa ULID 26 karakter yang valid.' },
  { name: 'ip', insertText: 'ip', detail: 'Alamat IPv4/IPv6', doc: 'Nilai harus berupa alamat IP yang valid.' },
  { name: 'alpha', insertText: 'alpha', detail: 'Hanya huruf alfabet', doc: 'Seluruh karakter harus berupa huruf.' },
  { name: 'alpha_num', insertText: 'alpha_num', detail: 'Huruf & angka saja', doc: 'Hanya mengizinkan karakter alfanumerik.' },
  { name: 'alpha_dash', insertText: 'alpha_dash', detail: 'Alfanumerik, strip & garis bawah', doc: 'Mengizinkan huruf, angka, `-`, dan `_` (cocok untuk slug/username).' },
  { name: 'confirmed', insertText: 'confirmed', detail: 'Cocok dengan `{field}_confirmation`', doc: 'Wajib memiliki field pendamping `{field}_confirmation` yang nilainya sama persis.' },
  { name: 'same:', insertText: 'same:${1:other_field}', detail: 'Sama dengan field lain', doc: 'Nilai harus sama dengan field yang disebutkan.' },
  { name: 'different:', insertText: 'different:${1:other_field}', detail: 'Berbeda dari field lain', doc: 'Nilai harus berbeda dengan field yang disebutkan.' },
  { name: 'min:', insertText: 'min:${1:3}', detail: 'Batas minimum nilai/panjang/ukuran KB', doc: 'Panjang karakter minimum (string), nilai minimum (numeric), atau ukuran KB (file).' },
  { name: 'max:', insertText: 'max:${1:255}', detail: 'Batas maksimum nilai/panjang/ukuran KB', doc: 'Panjang karakter maksimum (string), nilai maksimum (numeric), atau ukuran KB (file).' },
  { name: 'between:', insertText: 'between:${1:1},${2:100}', detail: 'Rentang nilai min,max', doc: 'Ukuran atau nilai berada di antara batas minimum dan maksimum.' },
  { name: 'size:', insertText: 'size:${1:10}', detail: 'Ukuran tepat', doc: 'Panjang karakter, jumlah elemen array, atau ukuran KB file harus tepat sama.' },
  { name: 'digits:', insertText: 'digits:${1:6}', detail: 'Panjang digit angka eksak', doc: 'Numerik dengan panjang digit tepat (mis. OTP/kode pos).' },
  { name: 'digits_between:', insertText: 'digits_between:${1:10},${2:15}', detail: 'Rentang digit angka', doc: 'Numerik dengan jumlah digit di antara min dan max (mis. nomor HP).' },
  { name: 'date', insertText: 'date', detail: 'Tanggal valid', doc: 'Nilai harus berupa tanggal yang valid menurut `strtotime` / DateTime.' },
  { name: 'date_format:', insertText: 'date_format:${1:Y-m-d}', detail: 'Pola format tanggal spesifik', doc: 'Tanggal harus sesuai persis dengan format yang ditentukan.' },
  { name: 'after:', insertText: 'after:${1:today}', detail: 'Tanggal sesudah batas', doc: 'Tanggal harus setelah tanggal atau field pembanding.' },
  { name: 'after_or_equal:', insertText: 'after_or_equal:${1:today}', detail: 'Tanggal sesudah atau sama', doc: 'Tanggal harus sama atau setelah tanggal pembanding.' },
  { name: 'before:', insertText: 'before:${1:tomorrow}', detail: 'Tanggal sebelum batas', doc: 'Tanggal harus sebelum tanggal pembanding.' },
  { name: 'in:', insertText: 'in:${1:draft,published}', detail: 'Daftar nilai diizinkan', doc: 'Nilai harus merupakan salah satu opsi yang dipisahkan koma.' },
  { name: 'not_in:', insertText: 'not_in:${1:admin,root}', detail: 'Daftar nilai terlarang', doc: 'Nilai tidak boleh termasuk opsi yang disebutkan.' },
  { name: 'regex:', insertText: 'regex:${1:/^[A-Z0-9]+$/}', detail: 'Pola Regular Expression', doc: 'Nilai harus cocok dengan ekspresi reguler PHP.' },
  { name: 'unique:', insertText: 'unique:${1:users},${2:email}', detail: 'Unik pada tabel database', doc: 'Pastikan nilai belum terdaftar pada kolom tabel (`unique:table,column,exceptId`).' },
  { name: 'exists:', insertText: 'exists:${1:categories},${2:id}', detail: 'Tersedia pada tabel database', doc: 'Pastikan foreign key/nilai benar-benar ada pada tabel referensi.' },
  { name: 'file', insertText: 'file', detail: 'File unggahan HTTP', doc: 'Field harus berupa file yang berhasil diunggah.' },
  { name: 'image', insertText: 'image', detail: 'File gambar (jpg, png, bmp, gif, svg, webp)', doc: 'File unggahan harus berupa gambar.' },
  { name: 'mimes:', insertText: 'mimes:${1:pdf,jpg,png}', detail: 'Ekstensi MIME file diizinkan', doc: 'Batasi tipe file berdasarkan ekstensi MIME.' },
  { name: 'required_if:', insertText: 'required_if:${1:other_field},${2:value}', detail: 'Wajib diisi bila field lain bernilai tertentu', doc: 'Field ini wajib diisi ketika `other_field` bernilai `value`.' },
  { name: 'required_with:', insertText: 'required_with:${1:other_field}', detail: 'Wajib diisi bila field pendamping ada', doc: 'Wajib diisi jika salah satu field lain hadir di request.' },
  { name: 'prohibited', insertText: 'prohibited', detail: 'Dilarang dikirim', doc: 'Field harus kosong atau tidak boleh dikirim oleh klien.' },
  { name: 'current_password', insertText: 'current_password', detail: 'Cocok dengan password user login', doc: 'Memastikan nilai cocok dengan password pengguna yang sedang terautentikasi.' }
];

const DEFAULT_CONFIG_KEYS: LaravelConfigEntry[] = [
  { key: 'app.name', doc: 'Nama aplikasi Laravel (`APP_NAME`).' },
  { key: 'app.env', doc: 'Lingkungan eksekusi aplikasi (`local`, `staging`, `production`).' },
  { key: 'app.debug', doc: 'Mode debug aplikasi (`APP_DEBUG`).' },
  { key: 'app.url', doc: 'Base URL aplikasi (`APP_URL`).' },
  { key: 'app.timezone', doc: 'Zona waktu aplikasi (mis. `Asia/Jakarta`).' },
  { key: 'app.locale', doc: 'Bahasa utama aplikasi (mis. `id` atau `en`).' },
  { key: 'auth.defaults.guard', doc: 'Guard autentikasi bawaan.' },
  { key: 'database.default', doc: 'Koneksi database utama (`mysql`, `pgsql`, `sqlite`, `sqlsrv`).' },
  { key: 'filesystems.default', doc: 'Disk penyimpanan utama (`local`, `public`, `s3`).' },
  { key: 'cache.default', doc: 'Driver cache bawaan.' },
  { key: 'queue.default', doc: 'Koneksi antrean job bawaan.' },
  { key: 'mail.default', doc: 'Mailer bawaan untuk pengiriman email.' },
  { key: 'session.driver', doc: 'Driver penyimpanan sesi pengguna.' },
  { key: 'session.lifetime', doc: 'Durasi sesi aktif dalam satuan menit.' }
];

const DEFAULT_ENV_KEYS = [
  'APP_NAME',
  'APP_ENV',
  'APP_KEY',
  'APP_DEBUG',
  'APP_TIMEZONE',
  'APP_URL',
  'APP_LOCALE',
  'LOG_CHANNEL',
  'LOG_LEVEL',
  'DB_CONNECTION',
  'DB_HOST',
  'DB_PORT',
  'DB_DATABASE',
  'DB_USERNAME',
  'DB_PASSWORD',
  'SESSION_DRIVER',
  'SESSION_LIFETIME',
  'BROADCAST_CONNECTION',
  'FILESYSTEM_DISK',
  'QUEUE_CONNECTION',
  'CACHE_STORE',
  'REDIS_HOST',
  'REDIS_PORT',
  'MAIL_MAILER',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_FROM_ADDRESS',
  'MAIL_FROM_NAME',
  'AWS_BUCKET',
  'VITE_APP_NAME'
];

const DEFAULT_MIDDLEWARE = [
  'auth',
  'auth:sanctum',
  'guest',
  'verified',
  'signed',
  'throttle:60,1',
  'can:',
  'password.confirm',
  'web',
  'api'
];

async function walkFilesBySuffix(
  rootDir: string,
  suffix: string,
  maxFiles = 400
): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (found.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) break;
      if (
        entry.name.startsWith('.') ||
        entry.name === 'vendor' ||
        entry.name === 'node_modules' ||
        entry.name === 'storage'
      ) {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) {
        found.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return found;
}

/**
 * Ekstrak HANYA nama kunci (KEY NAME) dari berkas `.env` / `.env.example`.
 * Nilai rahasia setelah tanda `=` TIDAK PERNAH disimpan atau dikembalikan.
 */
export function extractSafeEnvKeyNames(rawEnvContent: string): string[] {
  const keys = new Set<string>();
  const lines = rawEnvContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const rawKey = trimmed.slice(0, eqIndex).replace(/^export\s+/, '').trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawKey)) {
      keys.add(rawKey);
    }
  }
  return Array.from(keys);
}

function parseRoutesFromPhp(source: string, relativePath: string): LaravelRouteEntry[] {
  const out: LaravelRouteEntry[] = [];
  const seen = new Set<string>();
  const lines = source.split(/\r?\n/);

  const pushRoute = (entry: LaravelRouteEntry): void => {
    if (!entry.name || seen.has(entry.name)) return;
    seen.add(entry.name);
    out.push(entry);
  };

  // Track simple Route::name('prefix.')->group(...) blocks
  const groupPrefixStack: Array<{ prefix: string; depth: number }> = [];
  let braceDepth = 0;
  let pendingGroupPrefix: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const grpNameMatch = line.match(/Route::[A-Za-z0-9_>()'",\s[\]]*?name\(\s*['"]([^'"]+\.)['"]\s*\)/);
    if (grpNameMatch && line.includes('group')) {
      pendingGroupPrefix = grpNameMatch[1];
    } else if (grpNameMatch) {
      pendingGroupPrefix = grpNameMatch[1];
    }

    const activePrefix = groupPrefixStack.map((g) => g.prefix).join('');

    // 1. Explicit ->name('...') (could follow Route::get(...) on same or previous 2 lines)
    for (const nm of line.matchAll(/->\s*name\s*\(\s*['"]([A-Za-z0-9_.-]+)['"]\s*\)/g)) {
      const rawName = nm[1];
      if (rawName.endsWith('.')) continue; // Group prefix, not leaf route

      const contextWindow = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
      const verbMatch = contextWindow.match(
        /Route::(get|post|put|patch|delete|any|view|redirect)\s*\(\s*['"]([^'"]+)['"]/i
      );
      const ctrlMatch = contextWindow.match(
        /\[\s*([A-Za-z0-9_\\]+)::class\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/
      );

      const fullName =
        activePrefix && !rawName.startsWith(activePrefix)
          ? `${activePrefix}${rawName}`
          : rawName;

      pushRoute({
        name: fullName,
        method: verbMatch?.[1]?.toUpperCase(),
        uri: verbMatch?.[2],
        action: ctrlMatch ? `${ctrlMatch[1].split('\\').pop()}@${ctrlMatch[2]}` : undefined,
        relativePath,
        line: lineNum
      });
    }

    // 2. Route::resource('posts', PostController::class) / Route::apiResource(...)
    const resMatch = line.match(
      /Route::(resource|apiResource)\s*\(\s*['"]([A-Za-z0-9_./-]+)['"]\s*,\s*([A-Za-z0-9_\\]+)(?:::class|['"])?/
    );
    if (resMatch) {
      const kind = resMatch[1];
      const resourceUri = resMatch[2];
      const ctrlShort = resMatch[3].split('\\').pop() ?? resMatch[3];
      const baseName = resourceUri.replace(/\//g, '.');
      const actions =
        kind === 'apiResource'
          ? [
              { suffix: 'index', method: 'GET', uri: `/${resourceUri}` },
              { suffix: 'store', method: 'POST', uri: `/${resourceUri}` },
              { suffix: 'show', method: 'GET', uri: `/${resourceUri}/{id}` },
              { suffix: 'update', method: 'PUT', uri: `/${resourceUri}/{id}` },
              { suffix: 'destroy', method: 'DELETE', uri: `/${resourceUri}/{id}` }
            ]
          : [
              { suffix: 'index', method: 'GET', uri: `/${resourceUri}` },
              { suffix: 'create', method: 'GET', uri: `/${resourceUri}/create` },
              { suffix: 'store', method: 'POST', uri: `/${resourceUri}` },
              { suffix: 'show', method: 'GET', uri: `/${resourceUri}/{id}` },
              { suffix: 'edit', method: 'GET', uri: `/${resourceUri}/{id}/edit` },
              { suffix: 'update', method: 'PUT', uri: `/${resourceUri}/{id}` },
              { suffix: 'destroy', method: 'DELETE', uri: `/${resourceUri}/{id}` }
            ];

      for (const act of actions) {
        pushRoute({
          name: `${activePrefix}${baseName}.${act.suffix}`,
          method: act.method,
          uri: act.uri,
          action: `${ctrlShort}@${act.suffix}`,
          relativePath,
          line: lineNum
        });
      }
    }

    for (const ch of line) {
      if (ch === '{') {
        braceDepth += 1;
        if (pendingGroupPrefix) {
          groupPrefixStack.push({ prefix: pendingGroupPrefix, depth: braceDepth });
          pendingGroupPrefix = null;
        }
      } else if (ch === '}') {
        while (
          groupPrefixStack.length > 0 &&
          groupPrefixStack[groupPrefixStack.length - 1].depth >= braceDepth
        ) {
          groupPrefixStack.pop();
        }
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }
  }

  return out;
}

function parseConfigKeysFromPhp(
  source: string,
  configGroup: string,
  relativePath: string
): LaravelConfigEntry[] {
  const entries: LaravelConfigEntry[] = [];
  const seen = new Set<string>();
  const lines = source.split(/\r?\n/);

  let bracketDepth = 0;
  let currentTopKey: string | null = null;
  let topKeyDepth = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
      continue;
    }

    const keyMatch = trimmed.match(/^['"]([A-Za-z0-9_-]+)['"]\s*=>/);
    if (keyMatch && bracketDepth >= 1 && bracketDepth <= 2) {
      const k = keyMatch[1];
      if (bracketDepth === 1) {
        currentTopKey = k;
        topKeyDepth = 1;
        const fullKey = `${configGroup}.${k}`;
        if (!seen.has(fullKey)) {
          seen.add(fullKey);
          entries.push({
            key: fullKey,
            relativePath,
            doc: `Konfigurasi \`${fullKey}\` dari \`${relativePath}\`.`
          });
        }
      } else if (bracketDepth === 2 && currentTopKey) {
        const nestedKey = `${configGroup}.${currentTopKey}.${k}`;
        if (!seen.has(nestedKey)) {
          seen.add(nestedKey);
          entries.push({
            key: nestedKey,
            relativePath,
            doc: `Konfigurasi \`${nestedKey}\` dari \`${relativePath}\`.`
          });
        }
      }
    }

    for (const ch of line) {
      if (ch === '[') {
        bracketDepth += 1;
      } else if (ch === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        if (bracketDepth < topKeyDepth) {
          currentTopKey = null;
        }
      }
    }
  }

  return entries;
}

function parseEloquentModelClass(
  source: string,
  filePath: string,
  relativePath: string
): PhpClassMeta | null {
  const clsMatch = source.match(
    /(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+extends\s+([\\A-Za-z0-9_]+))?/
  );
  if (!clsMatch) return null;

  const className = clsMatch[1];
  const extendsRaw = clsMatch[2]?.split('\\').pop() ?? '';
  const inModelsDir = relativePath.replace(/\\/g, '/').includes('Models/');
  const isModelLike =
    inModelsDir ||
    ['Model', 'Authenticatable', 'Pivot', 'MorphPivot'].includes(extendsRaw);

  if (!isModelLike) return null;

  const classLine =
    source.slice(0, clsMatch.index ?? 0).split(/\r?\n/).length;

  const members: PhpClassMemberMeta[] = [
    ...MODEL_STATIC_QUERY_METHODS.map((item) => ({
      ...item,
      type: item.type === 'Model' ? className : item.type
    })),
    ...MODEL_INSTANCE_MEMBERS.map((item) => ({
      ...item,
      type: item.type === 'self' ? className : item.type
    }))
  ];
  const seenKeys = new Set(members.map((item) => `${item.kind}:${item.name}:${item.isStatic ? 'S' : 'I'}`));

  const addMember = (member: PhpClassMemberMeta): void => {
    const k = `${member.kind}:${member.name}:${member.isStatic ? 'S' : 'I'}`;
    if (seenKeys.has(k)) return;
    seenKeys.add(k);
    members.push(member);
  };

  // 1. Extract $fillable columns: protected $fillable = ['name', 'email', ...]
  const fillableMatch = source.match(/\$fillable\s*=\s*\[([\s\S]*?)\]/);
  if (fillableMatch) {
    for (const col of fillableMatch[1].matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)) {
      addMember(
        prop(col[1], 'mixed', `Kolom Eloquent \`$${col[1]}\` pada model \`${className}\` (\`$fillable\`).`)
      );
    }
  }

  // 2. Extract $casts / casts() attributes and infer PHP types
  const castsBlockMatch =
    source.match(/\$casts\s*=\s*\[([\s\S]*?)\]/) ??
    source.match(/function\s+casts\s*\(\s*\)[^{]*\{[\s\S]*?return\s*\[([\s\S]*?)\]/);
  if (castsBlockMatch) {
    for (const cm of castsBlockMatch[1].matchAll(
      /['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*=>\s*['"]?([A-Za-z0-9_:\\]+)/g
    )) {
      const colName = cm[1];
      const rawCast = cm[2].toLowerCase();
      let inferredType = 'mixed';
      if (rawCast.includes('date') || rawCast.includes('timestamp')) inferredType = 'Carbon';
      else if (rawCast.includes('bool')) inferredType = 'bool';
      else if (rawCast.includes('int')) inferredType = 'int';
      else if (rawCast.includes('float') || rawCast.includes('decimal') || rawCast.includes('double')) inferredType = 'float';
      else if (rawCast.includes('collection')) inferredType = 'Collection';
      else if (rawCast.includes('array') || rawCast.includes('json')) inferredType = 'array';

      // Override or add typed property
      const existingIdx = members.findIndex((x) => x.kind === 'property' && x.name === colName);
      const castProp = prop(
        colName,
        inferredType,
        `Atribut ter-cast (\`${cm[2]}\`) pada model \`${className}\`.`
      );
      if (existingIdx >= 0) {
        members[existingIdx] = castProp;
      } else {
        addMember(castProp);
      }
    }
  }

  // 3. Extract methods: local scopes `scopeActive(...)` + relationships + custom methods
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(
      /^\s*(?:public|protected)\s+(?:(static)\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*:\s*([?A-Za-z0-9_|\\]+))?/
    );
    if (!fnMatch) continue;
    const isStatic = Boolean(fnMatch[1]);
    const methodName = fnMatch[2];
    const rawParams = fnMatch[3] ?? '';
    const declaredReturn = fnMatch[4]?.split('\\').pop()?.replace(/^\?/, '');
    const bodyPreview = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');

    if (methodName.startsWith('scope') && methodName.length > 5) {
      const scopeCallName = methodName.charAt(5).toLowerCase() + methodName.slice(6);
      const extraParams = rawParams
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(1) // Skip $query parameter
        .map((s): PhpParamMeta => {
          const [lhs, rhs] = s.split('=').map((x) => x.trim());
          const parts = lhs.split(/\s+/).filter(Boolean);
          const vTok = parts.find((t) => t.startsWith('$')) ?? lhs;
          const tTok = parts.filter((t) => t !== vTok).join(' ');
          return {
            name: vTok,
            type: tTok || undefined,
            optional: s.includes('='),
            defaultValue: rhs
          };
        });

      addMember({
        name: scopeCallName,
        kind: 'method',
        isStatic: true,
        params: extraParams,
        type: 'EloquentBuilder',
        doc: `Local query scope \`${className}::${scopeCallName}()\` (dari \`${methodName}\`).`,
        line: i + 1
      });
      addMember({
        name: scopeCallName,
        kind: 'method',
        isStatic: false,
        params: extraParams,
        type: 'EloquentBuilder',
        doc: `Local query scope \`->${scopeCallName}()\` pada query \`${className}\`.`,
        line: i + 1
      });
      continue;
    }

    const relMatch = bodyPreview.match(
      /\$this\s*->\s*(hasOne|hasMany|belongsTo|belongsToMany|morphOne|morphMany|morphTo|morphToMany|hasManyThrough|hasOneThrough)\s*\(\s*(?:([A-Za-z0-9_\\]+)::class|['"]([A-Za-z0-9_\\]+)['"])?/
    );
    if (relMatch) {
      const relKind = relMatch[1];
      const targetModel = (relMatch[2] ?? relMatch[3] ?? '').split('\\').pop() || 'Model';
      const isPluralRel = ['hasMany', 'belongsToMany', 'morphMany', 'morphToMany', 'hasManyThrough'].includes(relKind);

      addMember({
        name: methodName,
        kind: 'method',
        isStatic: false,
        params: [],
        type: 'EloquentBuilder',
        doc: `Relasi Eloquent \`${relKind}\` menuju \`${targetModel}\`.`,
        line: i + 1
      });
      addMember({
        name: methodName,
        kind: 'property',
        isStatic: false,
        type: isPluralRel ? 'Collection' : targetModel,
        doc: `Properti dinamis relasi Eloquent \`${relKind}\` (\`${isPluralRel ? `Collection<${targetModel}>` : targetModel}\`).`,
        line: i + 1
      });
      continue;
    }

    if (methodName !== 'casts' && methodName !== 'booted' && methodName !== 'boot') {
      addMember({
        name: methodName,
        kind: 'method',
        isStatic,
        params: [],
        type: declaredReturn,
        doc: `Method \`${className}::${methodName}()\` di \`${relativePath}\`.`,
        line: i + 1
      });
    }
  }

  const tableMatch = source.match(/\$table\s*=\s*['"]([^'"]+)['"]/);

  return {
    name: className,
    extendsClass: extendsRaw || 'Model',
    members,
    doc: `Eloquent Model \`${className}\`${tableMatch ? ` (tabel: \`${tableMatch[1]}\`)` : ''} — \`${relativePath}\`.`,
    filePath,
    relativePath,
    line: classLine,
    origin: 'laravel'
  };
}

function parseFormRequestOrControllerClass(
  source: string,
  filePath: string,
  relativePath: string
): PhpClassMeta | null {
  const clsMatch = source.match(
    /(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+extends\s+([\\A-Za-z0-9_]+))?/
  );
  if (!clsMatch) return null;

  const className = clsMatch[1];
  const extendsShort = clsMatch[2]?.split('\\').pop() ?? '';
  const classLine = source.slice(0, clsMatch.index ?? 0).split(/\r?\n/).length;
  const isFormRequest =
    extendsShort === 'FormRequest' ||
    relativePath.replace(/\\/g, '/').includes('Http/Requests/');

  const members: PhpClassMemberMeta[] = isFormRequest ? [...REQUEST_MEMBERS] : [];
  const seen = new Set(members.map((x) => `${x.kind}:${x.name}`));

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const fnMatch = lines[i].match(
      /^\s*(?:public|protected)\s+(?:(static)\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/
    );
    if (!fnMatch) continue;
    const mName = fnMatch[2];
    if (seen.has(`method:${mName}`)) continue;
    seen.add(`method:${mName}`);
    members.push({
      name: mName,
      kind: 'method',
      isStatic: Boolean(fnMatch[1]),
      params: [],
      line: i + 1,
      doc: `Method \`${className}::${mName}()\` (\`${relativePath}\`).`
    });
  }

  return {
    name: className,
    extendsClass: extendsShort || undefined,
    members,
    doc: isFormRequest
      ? `Laravel FormRequest \`${className}\` (\`${relativePath}\`).`
      : `Laravel Controller \`${className}\` (\`${relativePath}\`).`,
    filePath,
    relativePath,
    line: classLine,
    origin: 'laravel'
  };
}

async function resolveLaravelProjectRoot(workspacePath: string): Promise<string | null> {
  const clean = resolve(workspacePath);
  if (!existsSync(clean)) return null;

  const isLaravelDir = async (dir: string): Promise<boolean> => {
    if (existsSync(join(dir, 'artisan'))) return true;
    const composerFile = join(dir, 'composer.json');
    if (existsSync(composerFile)) {
      try {
        const raw = await readFile(composerFile, 'utf-8');
        return raw.includes('"laravel/framework"') || raw.includes('"laravel/lumen-framework"');
      } catch {
        return false;
      }
    }
    return false;
  };

  if (await isLaravelDir(clean)) {
    return clean;
  }

  // Check immediate child folders (useful for monorepos e.g. `project/backend/artisan`)
  try {
    const entries = await readdir(clean, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      const sub = join(clean, entry.name);
      if (await isLaravelDir(sub)) {
        return sub;
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

export class LaravelService {
  async getCatalog(workspacePath?: string | null): Promise<LaravelCatalog> {
    const classes: PhpClassMeta[] = [...CORE_LARAVEL_CLASSES];
    const functions: PhpFunctionMeta[] = [...CORE_LARAVEL_FUNCTIONS];
    const configKeyMap = new Map<string, LaravelConfigEntry>();
    for (const ck of DEFAULT_CONFIG_KEYS) {
      configKeyMap.set(ck.key, ck);
    }
    const envKeySet = new Set<string>(DEFAULT_ENV_KEYS);
    const routes: LaravelRouteEntry[] = [];
    const views: LaravelViewEntry[] = [];
    const translationKeys = new Set<string>();
    const middlewareSet = new Set<string>(DEFAULT_MIDDLEWARE);

    let isLaravelProject = false;
    let laravelVersion: string | null = null;
    let resolvedRoot: string | null = null;
    let modelCount = 0;

    if (workspacePath) {
      resolvedRoot = await resolveLaravelProjectRoot(workspacePath);
    }

    if (resolvedRoot) {
      isLaravelProject = true;

      // 1. Detect Laravel version from composer.lock or composer.json
      try {
        const composerJsonPath = join(resolvedRoot, 'composer.json');
        if (existsSync(composerJsonPath)) {
          const parsed = JSON.parse(await readFile(composerJsonPath, 'utf-8')) as {
            require?: Record<string, string>;
          };
          laravelVersion = parsed.require?.['laravel/framework'] ?? null;
        }
      } catch {
        laravelVersion = null;
      }

      // 2. Scan routes/*.php
      const routeFiles = await walkFilesBySuffix(join(resolvedRoot, 'routes'), '.php', 60);
      for (const rf of routeFiles) {
        try {
          const content = await readFile(rf, 'utf-8');
          const rel = relative(resolvedRoot, rf).replace(/\\/g, '/');
          for (const r of parseRoutesFromPhp(content, rel)) {
            if (!routes.some((existing) => existing.name === r.name)) {
              routes.push(r);
            }
          }
        } catch {
          // Skip unreadable route file
        }
      }

      // 3. Scan resources/views/**/*.blade.php
      const viewsRoot = join(resolvedRoot, 'resources', 'views');
      const bladeFiles = await walkFilesBySuffix(viewsRoot, '.blade.php', 500);
      for (const bf of bladeFiles) {
        const relToViews = relative(viewsRoot, bf).replace(/\\/g, '/');
        const viewName = relToViews
          .replace(/\.blade\.php$/i, '')
          .replace(/\//g, '.');
        views.push({
          name: viewName,
          relativePath: relative(resolvedRoot, bf).replace(/\\/g, '/'),
          filePath: bf
        });
      }

      // 4. Scan config/*.php
      const configFiles = await walkFilesBySuffix(join(resolvedRoot, 'config'), '.php', 80);
      for (const cf of configFiles) {
        try {
          const content = await readFile(cf, 'utf-8');
          const group = basename(cf, '.php');
          const rel = relative(resolvedRoot, cf).replace(/\\/g, '/');
          for (const ck of parseConfigKeysFromPhp(content, group, rel)) {
            configKeyMap.set(ck.key, ck);
          }
        } catch {
          // Skip unreadable config file
        }
      }

      // 5. Scan .env.example & .env KEY NAMES ONLY (NEVER values!)
      for (const envFileName of ['.env.example', '.env']) {
        const envPath = join(resolvedRoot, envFileName);
        if (existsSync(envPath)) {
          try {
            const rawEnv = await readFile(envPath, 'utf-8');
            for (const keyName of extractSafeEnvKeyNames(rawEnv)) {
              envKeySet.add(keyName);
            }
          } catch {
            // Skip unreadable env file
          }
        }
      }

      // 6. Scan Eloquent Models (app/Models/**/*.php)
      const modelFiles = await walkFilesBySuffix(join(resolvedRoot, 'app', 'Models'), '.php', 200);
      for (const mf of modelFiles) {
        try {
          const content = await readFile(mf, 'utf-8');
          const rel = relative(resolvedRoot, mf).replace(/\\/g, '/');
          const modelMeta = parseEloquentModelClass(content, mf, rel);
          if (modelMeta) {
            modelCount += 1;
            const existingIdx = classes.findIndex(
              (c) => c.name.toLowerCase() === modelMeta.name.toLowerCase()
            );
            if (existingIdx >= 0) {
              classes[existingIdx] = modelMeta;
            } else {
              classes.push(modelMeta);
            }
          }
        } catch {
          // Skip unreadable model file
        }
      }

      // 7. Scan FormRequests & Controllers
      const reqAndCtrlFiles = [
        ...(await walkFilesBySuffix(join(resolvedRoot, 'app', 'Http', 'Requests'), '.php', 150)),
        ...(await walkFilesBySuffix(join(resolvedRoot, 'app', 'Http', 'Controllers'), '.php', 200))
      ];
      for (const fPath of reqAndCtrlFiles) {
        try {
          const content = await readFile(fPath, 'utf-8');
          const rel = relative(resolvedRoot, fPath).replace(/\\/g, '/');
          const meta = parseFormRequestOrControllerClass(content, fPath, rel);
          if (meta && !classes.some((c) => c.name.toLowerCase() === meta.name.toLowerCase())) {
            classes.push(meta);
          }
        } catch {
          // Skip
        }
      }

      // 8. Scan Translation files (lang/ or resources/lang/)
      for (const langDir of [join(resolvedRoot, 'lang'), join(resolvedRoot, 'resources', 'lang')]) {
        if (!existsSync(langDir)) continue;
        const phpLangFiles = await walkFilesBySuffix(langDir, '.php', 120);
        for (const lf of phpLangFiles) {
          try {
            const content = await readFile(lf, 'utf-8');
            const group = basename(lf, '.php');
            for (const km of content.matchAll(/^\s*['"]([A-Za-z0-9_.-]+)['"]\s*=>/gm)) {
              translationKeys.add(`${group}.${km[1]}`);
            }
          } catch {
            // Skip
          }
        }
        const jsonLangFiles = await walkFilesBySuffix(langDir, '.json', 30);
        for (const jf of jsonLangFiles) {
          try {
            const parsed = JSON.parse(await readFile(jf, 'utf-8')) as Record<string, unknown>;
            for (const k of Object.keys(parsed)) {
              if (k.length <= 80) translationKeys.add(k);
            }
          } catch {
            // Skip
          }
        }
      }
    }

    const totalMethods = classes.reduce(
      (sum, c) => sum + c.members.filter((item) => item.kind === 'method').length,
      0
    );

    return {
      isLaravelProject,
      laravelVersion,
      workspacePath: resolvedRoot,
      classes,
      functions,
      bladeDirectives: CORE_BLADE_DIRECTIVES,
      validationRules: CORE_VALIDATION_RULES,
      routes,
      views,
      configKeys: Array.from(configKeyMap.values()),
      envKeys: Array.from(envKeySet).sort(),
      translationKeys: Array.from(translationKeys).sort(),
      middlewareAliases: Array.from(middlewareSet),
      stats: {
        classCount: classes.length,
        methodCount: totalMethods,
        helperCount: functions.length,
        directiveCount: CORE_BLADE_DIRECTIVES.length,
        routeCount: routes.length,
        viewCount: views.length,
        modelCount,
        configKeyCount: configKeyMap.size
      }
    };
  }
}
