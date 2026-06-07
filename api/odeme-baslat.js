// Gercek odeme baslatma — iyzico Checkout Form
const Iyzipay = require('iyzipay');

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

module.exports = function handler(request, response) {
  // Simdilik sabit bir tutar — sonra adisyondan gelecek
  const tutar = '100.0';

  const istek = {
    locale: 'tr',
    conversationId: 'test-' + Date.now(),
    price: tutar,
    paidPrice: tutar,
    currency: 'TRY',
    basketId: 'B1',
    paymentGroup: 'PRODUCT',
    callbackUrl: 'http://localhost:3000/api/odeme-sonuc',
    buyer: {
      id: 'MUSTERI1',
      name: 'Test',
      surname: 'Musteri',
      gsmNumber: '+905350000000',
      email: 'test@bolus.com',
      identityNumber: '11111111111',
      registrationAddress: 'Eminonu, Istanbul',
      city: 'Istanbul',
      country: 'Turkey',
      ip: '85.34.78.112'
    },
    shippingAddress: {
      contactName: 'Test Musteri',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Eminonu, Istanbul'
    },
    billingAddress: {
      contactName: 'Test Musteri',
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
        price: tutar
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