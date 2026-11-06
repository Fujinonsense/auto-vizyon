// What Claude reads from each photo, the JSON it must return, and the labels the app shows.

export const SYSTEM = [
  "Türkiye'de boyasız göçük onarımı yapan bir dükkân için araç ve belge fotoğraflarından bilgi okuyorsun.",
  'Sadece fotoğrafta açıkça okunan bilgiyi yaz. Okunamayan, kesik ya da emin olmadığın alanı boş bırak ("") ve o alanın anahtarını "belirsiz" listesine ekle.',
  'Tahmin etme, bilgi uydurma. Plaka, şase ve kimlik numaralarında tek bir karakterden bile emin değilsen o alanı belirsiz say.',
  'Bilgiyi belgedeki yazımıyla ver. Tarihleri GG.AA.YYYY biçiminde yaz.',
].join(' ');

function kind(label, prompt, fields) {
  const keys = fields.map((f) => f.key);
  return {
    label,
    prompt,
    fields,
    schema: {
      type: 'object',
      properties: {
        ...Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
        belirsiz: { type: 'array', items: { type: 'string', enum: keys } },
      },
      required: [...keys, 'belirsiz'],
      additionalProperties: false,
    },
  };
}

export const KINDS = {
  arac: kind(
    'Araç',
    'Bu bir aracın fotoğrafı. Türk plakasını (ör. 34 ABC 123), aracın rengini Türkçe (Siyah, Beyaz, Gri, Gümüş, Kırmızı, Mavi, Lacivert, Yeşil, Kahverengi, Bej, Bordo, Turuncu, Sarı), markasını ve modelini yaz. Plaka görünmüyorsa boş bırak. Marka ve modeli ancak logodan ya da yazıdan eminsen yaz.',
    [
      { key: 'plaka', label: 'Plaka' },
      { key: 'renk', label: 'Renk' },
      { key: 'marka', label: 'Marka' },
      { key: 'model', label: 'Model' },
    ],
  ),
  ruhsat: kind(
    'Ruhsat',
    'Bu bir Türk araç tescil belgesi (ruhsat). Belgeden oku: plaka (A), marka (D.1), tipi (D.2), ticari adı (D.3), model yılı (D.4), rengi (R), şase no (E), motor no (P.5), sahibinin adı soyadı ya da ticari ünvanı (C.1.1 ve C.1.2), sahibinin TC kimlik no ya da vergi no, belge seri no ve tescil tarihi (I). "model" alanına ticari adın kısa model adını yaz (ör. ticari adı "A7 SPORTBACK 3.0 TDI" ise "A7").',
    [
      { key: 'plaka', label: 'Plaka' },
      { key: 'marka', label: 'Marka' },
      { key: 'model', label: 'Model' },
      { key: 'ticariAdi', label: 'Ticari adı' },
      { key: 'tipi', label: 'Tipi' },
      { key: 'modelYili', label: 'Model yılı' },
      { key: 'renk', label: 'Renk' },
      { key: 'saseNo', label: 'Şase no' },
      { key: 'motorNo', label: 'Motor no' },
      { key: 'sahibiAdSoyad', label: 'Ruhsat sahibi' },
      { key: 'tcVkn', label: 'TC / Vergi no' },
      { key: 'belgeSeriNo', label: 'Belge seri no' },
      { key: 'tescilTarihi', label: 'Tescil tarihi' },
    ],
  ),
  ehliyet: kind(
    'Ehliyet',
    'Bu bir Türk sürücü belgesi (ehliyet). Oku: adı soyadı (1 ve 2), TC kimlik no (4d), belge no (5), sınıfları (9, ör. "B" ya da "A2, B"), veriliş tarihi (4a) ve doğum tarihi (3).',
    [
      { key: 'adSoyad', label: 'Ad soyad' },
      { key: 'tc', label: 'TC kimlik no' },
      { key: 'ehliyetNo', label: 'Ehliyet no' },
      { key: 'sinif', label: 'Sınıf' },
      { key: 'verilisTarihi', label: 'Veriliş tarihi' },
      { key: 'dogumTarihi', label: 'Doğum tarihi' },
    ],
  ),
  kimlik: kind(
    'Kimlik',
    'Bu bir T.C. kimlik kartı. Oku: adı soyadı, TC kimlik no, doğum tarihi, seri no ve son geçerlilik tarihi.',
    [
      { key: 'adSoyad', label: 'Ad soyad' },
      { key: 'tc', label: 'TC kimlik no' },
      { key: 'dogumTarihi', label: 'Doğum tarihi' },
      { key: 'seriNo', label: 'Seri no' },
      { key: 'gecerlilik', label: 'Son geçerlilik' },
    ],
  ),
  tutanak: kind(
    'Kaza tutanağı',
    [
      'Bu bir Maddi Hasarlı Trafik Kazası Tespit Tutanağı. Sadece A ve B araçlarının "Sürücü Bilgileri" kutularını ve "Araç Bilgileri" kutularındaki iki plakayı oku.',
      'A sürücüsünü a ile, B sürücüsünü b ile başlayan alanlara yaz: aAdSoyad / bAdSoyad adı soyadı, aTc / bTc T.C. kimlik no,',
      'aEhliyet / bEhliyet sürücü belge no ve sınıfı tek değer olarak (ör. "106408-B"), aAlindigiYer / bAlindigiYer belgenin alındığı yer,',
      'aAdres / bAdres adresi, aTel / bTel telefonu, aPlaka / bPlaka o aracın plakası.',
      'Kaza yeri ve zamanı, sigorta bilgileri, kroki, kaza durumu, beyanlar ve imzalar gibi başka hiçbir şeyi okuma.',
      'El yazısı okunmuyorsa ya da emin değilsen o alanı boş bırak ve anahtarını "belirsiz" listesine ekle.',
    ].join(' '),
    ['a', 'b'].flatMap((d) => {
      const who = `${d.toUpperCase()} sürücüsü`;
      return [
        { key: `${d}AdSoyad`, label: `${who} ad soyad` },
        { key: `${d}Tc`, label: `${who} T.C. kimlik no` },
        { key: `${d}Ehliyet`, label: `${who} sürücü belge no ve sınıfı` },
        { key: `${d}AlindigiYer`, label: `${who} belgenin alındığı yer` },
        { key: `${d}Adres`, label: `${who} adres` },
        { key: `${d}Tel`, label: `${who} telefon` },
        { key: `${d}Plaka`, label: `${d.toUpperCase()} aracının plakası` },
      ];
    }),
  ),
};
