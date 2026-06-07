// iyzico odeme sonrasi buraya doner — sonucu kontrol ediyoruz
const Iyzipay = require('iyzipay');

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

module.exports = function handler(request, response) {
  // iyzico, odeme bitince bize bir "token" geri yollar
  const token = request.body && request.body.token;

  if (!token) {
    response.status(400).send('Token bulunamadi');
    return;
  }

  // Bu token ile iyzico'ya soruyoruz: odeme ne oldu?
  iyzipay.checkoutForm.retrieve(
    { locale: 'tr', token: token },
    function (hata, sonuc) {
      if (hata || sonuc.status !== 'success') {
        response.status(200).send('<h1>Odeme basarisiz</h1><p>' + JSON.stringify(hata || sonuc) + '</p>');
      } else if (sonuc.paymentStatus === 'SUCCESS') {
        response.status(200).send('<h1>Odeme basarili!</h1><p>Tutar: ' + sonuc.paidPrice + ' TL</p><p>Odeme ID: ' + sonuc.paymentId + '</p>');
      } else {
        response.status(200).send('<h1>Odeme tamamlanmadi</h1><p>Durum: ' + sonuc.paymentStatus + '</p>');
      }
    }
  );
};