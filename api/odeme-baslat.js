// Gercek odeme baslatma — iyzico Checkout Form
const Iyzipay = require('iyzipay');

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

module.exports = function handler(request, response) {
  // Sadece POST kabul ediyoruz (tarayici bize body ile veri yolluyor)
  if (request.method !== 'POST') {
    response.status(405).json({ basarili: false, hata: 'Sadece POST' });
    return;
  }

  // Tarayicidan gelen veri: odenecek tutar ve "fis" (odeme donusunde ne yapilacagini anlatan etiket)
  // fis ornek: "FULL-21" (tum adisyon) veya "ITEM-21-45-2" (adisyon 21, kalem 45, 2 adet)
  const body = request.body || {};
  const fis = body.fis;
  const gelenTutar = Number(body.tutar);

  // Basit kontroller
  if (!fis) {
    response.status(400).json({ basarili: false, hata: 'fis eksik' });
    return;
  }
  if (!gelenTutar || gelenTutar <= 0) {
    response.status(400).json({ basarili: false, hata: 'Gecersiz tutar' });
    return;
  }

  // iyzico tutari ondalikli metin bekliyor: 123.45 gibi
  const fiyat = gelenTutar.toFixed(2);

  // Geri donus adresini istegin geldigi yere gore otomatik kur
  // (localhost'ta http, canli sitede https)
  const host = request.headers.host;
  const protokol = host.includes('localhost') ? 'http' : 'https';
  const callbackUrl = protokol + '://' + host + '/api/odeme-sonuc';

  // Musterinin IP'si (iyzico istiyor) — yoksa varsayilan koy
  const ip = (request.headers['x-forwarded-for'] || '85.34.78.112').split(',')[0].trim();

  const istek = {
    locale: 'tr',
    // VESTIYER FISI: odeme donusunde ne yapilacagini anlatan etiketi
    // hem conversationId hem basketId'ye koyuyoruz (biri bos donerse otekini kullaniriz)
    conversationId: fis,
    price: fiyat,
    paidPrice: fiyat,
    currency: 'TRY',
    basketId: fis,
    paymentGroup: 'PRODUCT',
    callbackUrl: callbackUrl,
    buyer: {
      id: 'MUSTERI1',
      name: 'Bolus',
      surname: 'Musteri',
      gsmNumber: '+905350000000',
      email: 'musteri@bolus.com',
      identityNumber: '11111111111',
      registrationAddress: 'Eminonu, Istanbul',
      city: 'Istanbul',
      country: 'Turkey',
      ip: ip
    },
    shippingAddress: {
      contactName: 'Bolus Musteri',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Eminonu, Istanbul'
    },
    billingAddress: {
      contactName: 'Bolus Musteri',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Eminonu, Istanbul'
    },
    basketItems: [
      {
        id: 'BI1',
        name: 'Hesap odemesi',
        category1: 'Restoran',
        itemType: 'VIRTUAL',
        price: fiyat
      }
    ]
  };

  iyzipay.checkoutFormInitialize.create(istek, function (hata, sonuc) {
    if (hata) {
      response.status(500).json({ basarili: false, hata: hata });
    } else {
      response.status(200).json({ basarili: true, sonuc: sonuc });
    }
  });
};
