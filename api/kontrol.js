// OTOMATIK KONTROLCU — beklemede kalmis odemeleri toparlar.
// Vercel Cron ile periyodik calisir. "beklemede" olan ve uzerinden biraz
// zaman gecmis odemeleri iyzico'ya sorar; odenmisse tamamlar, odenmemisse iptal eder.
const Iyzipay = require('iyzipay');
const { createClient } = require('@supabase/supabase-js');

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com'
});

const supabase = createClient(
  'https://ybgzysyojshulpmdyrrm.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

// iyzico retrieve'i Promise'e ceviren kucuk yardimci
function iyzicoSor(token) {
  return new Promise((resolve) => {
    iyzipay.checkoutForm.retrieve({ locale: 'tr', token: token }, function (hata, sonuc) {
      if (hata) resolve({ ok: false, hata: hata });
      else resolve({ ok: true, sonuc: sonuc });
    });
  });
}

module.exports = async function handler(request, response) {
  // GUVENLIK: CRON_SECRET tanimliysa, sadece o anahtari tasiyan istekler calistirabilir.
  // (Vercel Cron, Authorization: Bearer <CRON_SECRET> basligiyla cagirir.)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers['authorization'] || '';
    if (auth !== 'Bearer ' + secret) {
      response.status(401).json({ ok: false, hata: 'yetkisiz' });
      return;
    }
  }

  try {
    // 3 dakikadan eski, hala "beklemede" olan odemeleri al
    const ucDkOnce = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    const { data: bekleyenler, error } = await supabase
      .from('odemeler')
      .select('id, token, created_at')
      .eq('durum', 'beklemede')
      .lt('created_at', ucDkOnce)
      .limit(50);

    if (error) {
      response.status(500).json({ ok: false, hata: error });
      return;
    }

    let tamamlanan = 0;
    let iptalEdilen = 0;

    for (const odeme of (bekleyenler || [])) {
      if (!odeme.token) continue;

      const cevap = await iyzicoSor(odeme.token);
      if (!cevap.ok || !cevap.sonuc) continue;

      const s = cevap.sonuc;

      if (s.status === 'success' && s.paymentStatus === 'SUCCESS') {
        // Gercekten odenmis: tamamla
        await odemeyiTamamla(odeme.token, s);
        tamamlanan++;
      } else if (s.status === 'success' && s.paymentStatus && s.paymentStatus !== 'SUCCESS') {
        // iyzico kesin "odenmedi" diyor: iptal isaretle
        await supabase.from('odemeler')
          .update({ durum: 'iptal' })
          .eq('id', odeme.id)
          .eq('durum', 'beklemede');
        iptalEdilen++;
      }
      // Belirsizse dokunma, bir sonraki turda tekrar bakariz.
    }

    response.status(200).json({ ok: true, bakilan: (bekleyenler || []).length, tamamlanan, iptalEdilen });
  } catch (e) {
    console.error('kontrol hatasi:', e);
    response.status(500).json({ ok: false, hata: String(e) });
  }
};

// ---- Asagidakiler odeme-sonuc.js ile ayni mantik (kilitli, cift islemez) ----

async function odemeyiTamamla(token, sonuc) {
  const fis = sonuc.conversationId || sonuc.basketId;
  const odenenTutar = Number(sonuc.paidPrice);
  const paymentId = String(sonuc.paymentId);

  const { data: yakalanan, error: claimHata } = await supabase
    .from('odemeler')
    .update({ durum: 'basarili', iyzico_odeme_id: paymentId })
    .eq('token', token)
    .eq('durum', 'beklemede')
    .select();

  if (claimHata) throw new Error('claim: ' + JSON.stringify(claimHata));
  if (!yakalanan || yakalanan.length === 0) return; // baskasi islemis

  const parcalar = fis.split('-');
  const tip = parcalar[0];
  const adisyonId = Number(parcalar[1]);

  if (tip === 'FULL') {
    await tumAdisyonuUygula(adisyonId);
  } else if (tip === 'ITEM') {
    await kalemiUygula(adisyonId, Number(parcalar[2]), Number(parcalar[3]));
  }

  await adisyonuKapatmayiDene(adisyonId);
}

async function tumAdisyonuUygula(adisyonId) {
  const { data: kalemler } = await supabase
    .from('adisyon_kalemleri').select('id, adet').eq('adisyon_id', adisyonId);
  for (const k of (kalemler || [])) {
    await supabase.from('adisyon_kalemleri').update({ odenmis_adet: k.adet }).eq('id', k.id);
  }
}

async function kalemiUygula(adisyonId, kalemId, odenenAdet) {
  const { data: kalem } = await supabase
    .from('adisyon_kalemleri').select('adet, odenmis_adet').eq('id', kalemId).single();
  if (!kalem) return;
  let yeni = kalem.odenmis_adet + odenenAdet;
  if (yeni > kalem.adet) yeni = kalem.adet;
  await supabase.from('adisyon_kalemleri').update({ odenmis_adet: yeni }).eq('id', kalemId);
}

async function adisyonuKapatmayiDene(adisyonId) {
  const { data: kalemler } = await supabase
    .from('adisyon_kalemleri').select('adet, odenmis_adet').eq('adisyon_id', adisyonId);
  if (!kalemler || kalemler.length === 0) return;
  const hepsiOdendi = kalemler.every(k => k.odenmis_adet >= k.adet);
  if (hepsiOdendi) {
    await supabase.from('adisyonlar')
      .update({ durum: 'odendi', kapanis_zamani: new Date().toISOString() })
      .eq('id', adisyonId)
      .eq('durum', 'acik');
  }
}
