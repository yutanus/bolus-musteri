// iyzico baglanti testi — gercek odeme DEGIL, sadece taksit sorgusu
const Iyzipay = require('iyzipay');

// .env dosyasindan anahtarlari okuyoruz
const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

// Vercel bu fonksiyonu, birisi adrese istek atinca calistirir
module.exports = function handler(request, response) {
  // iyzico'ya soruyoruz: bu kartin ilk 6 hanesi icin taksit secenekleri ne?
  const istek = {
    locale: 'tr',
    binNumber: '454360',
    price: '100.0'
  };

  iyzipay.installmentInfo.retrieve(istek, function (hata, sonuc) {
    if (hata) {
      response.status(500).json({ basarili: false, hata: hata });
    } else {
      response.status(200).json({ basarili: true, iyzicoCevabi: sonuc });
    }
  });
};