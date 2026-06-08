// iyzico odeme sonrasi buraya doner — sonucu kontrol edip veritabanina yaziyoruz
const Iyzipay = require('iyzipay');
const { createClient } = require('@supabase/supabase-js');

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

// DIKKAT: Burada service anahtarini kullaniyoruz. Bu anahtar RLS'yi asar,
// yani sunucu yazma yetkisine sahip olur. Bu dosya SADECE sunucuda (Vercel
// Function) calistigi icin guvenli; anahtar tarayiciya asla gitmiyor.
const supabase = createClient(
  'https://ybgzysyojshulpmdyrrm.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

// Musteriye gosterilecek sade sonuc sayfasi
function sayfa(baslik, mesaj, renk) {
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bölüş</title></head>
  <body style="font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;
    display:flex;align-items:center;justify-content:center;min-height:100vh;">
    <div style="background:white;padding:40px 30px;border-radius:16px;text-align:center;
      max-width:360px;margin:20px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <div style="font-size:48px;margin-bottom:10px;">${renk === 'yesil' ? '✅' : '⚠️'}</div>
      <h1 style="color:#333;font-size:22px;margin:0 0 10px;">${baslik}</h1>
      <p style="color:#777;font-size:15px;margin:0;">${mesaj}</p>
    </div>
  </body></html>`;
}

module.exports = function handler(request, response) {
  const token = request.body && request.body.token;

  if (!token) {
    response.status(400).send(sayfa('Bir sorun oluştu', 'Ödeme bilgisi bulunamadı.', 'sari'));
    return;
  }

  iyzipay.checkoutForm.retrieve(
    { locale: 'tr', token: token },
    async function (hata, sonuc) {
      if (hata || sonuc.status !== 'success' || sonuc.paymentStatus !== 'SUCCESS') {
        console.error('Odeme basarisiz:', hata || sonuc);
        response.status(200).send(sayfa('Ödeme alınamadı', 'Ödeme tamamlanamadı. Lütfen tekrar deneyin.', 'sari'));
        return;
      }

      // --- Odeme basarili ---
      const fis = sonuc.conversationId || sonuc.basketId;
      const odenenTutar = Number(sonuc.paidPrice);

      try {
        if (!fis) throw new Error('fis geri gelmedi: ' + JSON.stringify({ c: sonuc.conversationId, b: sonuc.basketId }));

        const parcalar = fis.split('-');
        const tip = parcalar[0];
        let adisyonId = null;

        if (tip === 'FULL') {
          adisyonId = Number(parcalar[1]);
          await tumAdisyonuOde(adisyonId, odenenTutar, sonuc.paymentId);
        } else if (tip === 'ITEM') {
          adisyonId = Number(parcalar[1]);
          await kalemOde(adisyonId, Number(parcalar[2]), Number(parcalar[3]), odenenTutar, sonuc.paymentId);
        } else {
          throw new Error('Taninmayan fis tipi: ' + fis);
        }

        // Odeme islendikten sonra: bu adisyonun kalani sifirsa adisyonu kapat
        await adisyonuKapatmayiDene(adisyonId);

      } catch (e) {
        // Para alindi ama kayit takildi: musteriyi korkutma, sorunu bize bildir.
        console.error('ODEME ALINDI AMA VERITABANI YAZILAMADI:', e, 'paymentId:', sonuc.paymentId);
      }

      response.status(200).send(
        sayfa('Ödeme başarılı!', odenenTutar.toFixed(2) + ' ₺ ödemeniz alındı. Teşekkürler!', 'yesil')
      );
    }
  );
};

async function tumAdisyonuOde(adisyonId, tutar, paymentId) {
  const { error: insertHata } = await supabase.from('odemeler').insert({
    adisyon_id: adisyonId, tutar: tutar, iyzico_odeme_id: String(paymentId), durum: 'basarili'
  });
  if (insertHata) throw new Error('odemeler insert: ' + JSON.stringify(insertHata));

  const { data: kalemler, error: kalemHata } = await supabase
    .from('adisyon_kalemleri').select('id, adet').eq('adisyon_id', adisyonId);
  if (kalemHata) throw new Error('kalem okuma: ' + JSON.stringify(kalemHata));

  for (const k of (kalemler || [])) {
    await supabase.from('adisyon_kalemleri').update({ odenmis_adet: k.adet }).eq('id', k.id);
  }
}

async function kalemOde(adisyonId, kalemId, odenenAdet, tutar, paymentId) {
  const { error: insertHata } = await supabase.from('odemeler').insert({
    adisyon_id: adisyonId, tutar: tutar, iyzico_odeme_id: String(paymentId), durum: 'basarili'
  });
  if (insertHata) throw new Error('odemeler insert: ' + JSON.stringify(insertHata));

  const { data: kalem, error: okumaHata } = await supabase
    .from('adisyon_kalemleri').select('adet, odenmis_adet').eq('id', kalemId).single();
  if (okumaHata || !kalem) throw new Error('kalem okuma: ' + JSON.stringify(okumaHata));

  let yeni = kalem.odenmis_adet + odenenAdet;
  if (yeni > kalem.adet) yeni = kalem.adet;

  const { error: updHata } = await supabase
    .from('adisyon_kalemleri').update({ odenmis_adet: yeni }).eq('id', kalemId);
  if (updHata) throw new Error('kalem guncelleme: ' + JSON.stringify(updHata));
}

// Adisyonun tum kalemleri tamamen odendiyse adisyonu kapat.
// (Eskiden musteri sayfasi yapiyordu; artik guvenli sekilde sunucu yapiyor.)
async function adisyonuKapatmayiDene(adisyonId) {
  const { data: kalemler, error } = await supabase
    .from('adisyon_kalemleri').select('adet, odenmis_adet').eq('adisyon_id', adisyonId);
  if (error || !kalemler || kalemler.length === 0) return;

  const hepsiOdendi = kalemler.every(k => k.odenmis_adet >= k.adet);
  if (hepsiOdendi) {
    await supabase.from('adisyonlar')
      .update({ durum: 'odendi', kapanis_zamani: new Date().toISOString() })
      .eq('id', adisyonId)
      .eq('durum', 'acik'); // sadece hala acikse kapat
  }
}
