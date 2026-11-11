// Sample answers for trying the flow without an API key: set localStorage avMockAI = "1".
import { KINDS } from './schemas.js';

const DATA = {
  arac: { plaka: '34 NMA 887', renk: 'Siyah', marka: 'Audi', model: 'A7', belirsiz: [] },
  ruhsat: {
    plaka: '34 NMA 887', marka: 'AUDI', model: 'A7', ticariAdi: 'A7 SPORTBACK 3.0 TDI QUATTRO', tipi: '4G',
    modelYili: '2019', renk: 'SİYAH', saseNo: 'WAUZZZ4G7JN012345', motorNo: 'CDU 104522',
    sahibiAdSoyad: 'UĞURCAN KAYA', tcVkn: '10000000146', belgeSeriNo: 'FA 482913', tescilTarihi: '14.06.2021', belirsiz: [],
  },
  ehliyet: {
    adSoyad: 'UĞURCAN KAYA', tc: '10000000146', ehliyetNo: '482190', sinif: 'B', verilisTarihi: '03.09.2015',
    dogumTarihi: '21.04.1991', belirsiz: [],
  },
  kimlik: { adSoyad: 'UĞURCAN KAYA', tc: '10000000146', dogumTarihi: '21.04.1991', seriNo: 'A12B34567', gecerlilik: '21.04.2031', belirsiz: [] },
};

function answer(req) {
  const kind = Object.keys(KINDS).find((k) => KINDS[k].schema === req.output_config.format.schema);
  return new Promise((resolve) => setTimeout(() => resolve({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(DATA[kind]) }],
  }), 900));
}

export const mockClient = {
  messages: { create: answer },
  beta: { messages: { create: answer } },
  models: { retrieve: async (id) => ({ id }) },
};
