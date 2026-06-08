// iyzico odeme sonrasi buraya doner — sonucu kontrol edip veritabanini guncelliyoruz
const Iyzipay = require('iyzipay');
const { createClient } = require('@supabase/supabase-js');

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

// Service anahtari (RLS'yi asar). Sadece sunucuda calisir, guvenli.
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
      const odenenTutar = Number(sonuc.paidPrice);

      try {
        await odemeyiTamamla(token, sonuc);
      } catch (e) {
        // Para alindi ama islem takildi: musteriyi korkutma, sorunu kaydet.
        // "beklemede" kaydi durdugu icin otomatik kontrolcu sonra toparlayabilir.
        console.error('ODEME ALINDI AMA ISLENEMEDI:', e, 'token:', token);
      }

      response.status(200).send(
        sayfa('Ödeme başarılı!', odenenTutar.toFixed(2) + ' ₺ ödemeniz alındı. Teşekkürler!', 'yesil')
      );
    }
  );
};

// Bir basarili odemeyi isle. Iki kez calissa bile bir kez uygular (kilit mantigi).
async function odemeyiTamamla(token, sonuc) {
  const fis = sonuc.conversationId || sonuc.basketId;
  const odenenTutar = Number(sonuc.paidPrice);
  const paymentId = String(sonuc.paymentId);

  // KILIT: sadece "beklemede" olan kaydi "basarili"ya cevir. Bu islem atomik:
  // iki istek ayni anda gelse bile sadece BIRI kaydi yakalar.
  const { data: yakalanan, error: claimHata } = await supabase
    .from('odemeler')
    .update({ durum: 'basarili', iyzico_odeme_id: paymentId })
    .eq('token', token)
    .eq('durum', 'beklemede')
    .select();

  if (claimHata) throw new Error('claim: ' + JSON.stringify(claimHata));

  let uygula = false;

  if (yakalanan && yakalanan.length > 0) {
    // Biz yakaladik: kalemleri uygulayacagiz.
    uygula = true;
  } else {
    // Yakalayamadik. Ya bu token icin hic "beklemede" kayit yoktu, ya da baskasi isledi.
    const { data: varolan } = await supabase
      .from('odemeler').select('id, durum').eq('token', token);

    if (!varolan || varolan.length === 0) {
      // baslat tarafinda kayit atilamamis. Yedek: simdi basarili kayit ekle ve uygula.
      await supabase.from('odemeler').insert({
        adisyon_id: Number(fis.split('-')[1]),
        tutar: odenenTutar,
        durum: 'basarili',
        iyzico_odeme_id: paymentId,
        token: token
      });
      uygula = true;
    } else {
      // Zaten islenmis (basarili). Tekrar uygulama (cift islemeyi onler).
      uygula = false;
    }
  }

  if (!uygula) return;

  // --- Kalemleri uygula (fis'e gore) ---
  const parcalar = fis.split('-');
  const tip = parcalar[0];
  const adisyonId = Number(parcalar[1]);

  if (tip === 'FULL') {
    await tumAdisyonuUygula(adisyonId);
  } else if (tip === 'ITEM') {
    await kalemiUygula(adisyonId, Number(parcalar[2]), Number(parcalar[3]));
  } else {
    throw new Error('Taninmayan fis tipi: ' + fis);
  }

  await adisyonuKapatmayiDene(adisyonId);
}

// Tum adisyonun kalemlerini tamamen odendi yap
async function tumAdisyonuUygula(adisyonId) {
  const { data: kalemler, error } = await supabase
    .from('adisyon_kalemleri').select('id, adet').eq('adisyon_id', adisyonId);
  if (error) throw new Error('kalem okuma: ' + JSON.stringify(error));
  for (const k of (kalemler || [])) {
    await supabase.from('adisyon_kalemleri').update({ odenmis_adet: k.adet }).eq('id', k.id);
  }
}

// Tek kalemin belli adedini odendi say
async function kalemiUygula(adisyonId, kalemId, odenenAdet) {
  const { data: kalem, error } = await supabase
    .from('adisyon_kalemleri').select('adet, odenmis_adet').eq('id', kalemId).single();
  if (error || !kalem) throw new Error('kalem okuma: ' + JSON.stringify(error));

  let yeni = kalem.odenmis_adet + odenenAdet;
  if (yeni > kalem.adet) yeni = kalem.adet;

  const { error: updHata } = await supabase
    .from('adisyon_kalemleri').update({ odenmis_adet: yeni }).eq('id', kalemId);
  if (updHata) throw new Error('kalem guncelleme: ' + JSON.stringify(updHata));
}

// Adisyonun tum kalemleri odendiyse adisyonu kapat
async function adisyonuKapatmayiDene(adisyonId) {
  const { data: kalemler, error } = await supabase
    .from('adisyon_kalemleri').select('adet, odenmis_adet').eq('adisyon_id', adisyonId);
  if (error || !kalemler || kalemler.length === 0) return;

  const hepsiOdendi = kalemler.every(k => k.odenmis_adet >= k.adet);
  if (hepsiOdendi) {
    await supabase.from('adisyonlar')
      .update({ durum: 'odendi', kapanis_zamani: new Date().toISOString() })
      .eq('id', adisyonId)
      .eq('durum', 'acik');
  }
}
