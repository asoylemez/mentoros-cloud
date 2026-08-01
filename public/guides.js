/**
 * ====================================================================
 * MENTORLUK REHBERLERI  (mentee + mentor, TR + EN)
 * ====================================================================
 *
 * Calisma alani sayfasindaki acilir "Rehber" panelinin icerigi.
 *
 * NEDEN AYRI DOSYA?
 *   Dort surum (mentee/mentor x TR/EN) tek HTML dosyasina gomulseydi
 *   sayfa okunamaz hale gelirdi. Burada duruyorlar; sayfa <script src>
 *   ile yukluyor. Icerik guncellemek isteyen SADECE bu dosyaya bakar.
 *
 * BICIM
 *   GUIDES[dil][rol] = [ { t: "Bolum basligi", h: "<p>HTML icerik</p>" }, ... ]
 *
 *   Her bolum sayfada katlanabilir bir baslik olarak cizilir.
 *
 * NOT: Icerikte KURUM ADI GECMEZ. Rehber her kurulumda oldugu gibi
 * kullanilabilsin diye bilerek marka-bagimsiz yazildi.
 */

const GUIDES = {

  /* ================================================================
     TURKCE
     ================================================================ */
  tr: {

    // ---------------------------------------------------------------
    // MENTEE
    // ---------------------------------------------------------------
    mentee: [
      {
        t: "1. Mentorluk nedir, ne değildir?",
        h: `
          <p>Bu programda kastedilen şey <b>resmî bir mentorluk ilişkisi</b>:
          bir mentor ile bir mentee arasında, asıl amacı <b>mentee'nin gelişimi</b>
          olan yapılandırılmış bir çalışma. Bu ilişki genellikle yöneticinin
          önerisiyle başlar ve senin gelişim planının bir parçasıdır.</p>

          <table class="guide-table">
            <tr><th>Mentorluk şudur</th><th>Mentorluk şu değildir</th></tr>
            <tr><td>Senin gelişimine odaklanan bir ilişki</td><td>Performans değerlendirmesi</td></tr>
            <tr><td>Deneyim aktarımı ve birlikte düşünme</td><td>Hazır çözüm alma yeri</td></tr>
            <tr><td>Senin yönlendirdiğin bir süreç</td><td>Mentorun sana ödev verdiği bir ders</td></tr>
            <tr><td>Güvene dayalı, gizli bir alan</td><td>Yöneticine rapor edilen bir toplantı</td></tr>
            <tr><td>9–12 aylık, sonu olan bir çalışma</td><td>Süresiz bir danışmanlık</td></tr>
          </table>

          <div class="guide-callout">En önemli nokta: Bu süreç <b>senin</b> sürecin.
          Mentorun yol gösterir, ama direksiyon sende.</div>`
      },
      {
        t: "2. Süreç nasıl işliyor?",
        h: `
          <ol class="guide-steps">
            <li><b>Gelişim ihtiyacının belirlenmesi</b> — Yöneticin, genellikle yetenek
                değerlendirme sürecinde, senin için bir gelişim fırsatı belirler.</li>
            <li><b>Mentorun belirlenmesi</b> — Yöneticin, liderlik ve ilgili paydaşlarla
                birlikte sana uygun bir iç mentor belirler ve mentorle ön görüşme yapar.</li>
            <li><b>İlk görüşme</b> — Mentorunla bir araya gelir, çalışma kurallarınızı ve
                görüşme sıklığınızı belirlersiniz.</li>
            <li><b>Düzenli görüşmeler</b> — Düzenli aralıklarla buluşursunuz. Mentorun
                gelişimin için aksiyonlar önerir, sen de sonuçlarını paylaşırsın.</li>
            <li><b>Kapanış</b> — Mentorun ve sen, yöneticinle birlikte ilişkinin ne zaman
                sonlanacağına karar verirsiniz. İdeal süre <b>9–12 aydır</b>.</li>
          </ol>`
      },
      {
        t: "3. Senin sorumlulukların",
        h: `
          <ul class="guide-list">
            <li><b>Açıklık göster.</b> Kendi içgörülerini ve bakış açını keşfetmeye istekli ol.</li>
            <li><b>Dinle, sor, meydan oku.</b> Kendi varsayımlarını sorgula. Yardım istemekten çekinme.</li>
            <li><b>Sorumluluğu üstlen.</b> Görüşmenin sorumluluğu sende. İlişkiyi sen yönlendir,
                aktif ve tam olarak katıl.</li>
            <li><b>Gündemi sen kur.</b> Görüşmelerin odağını belirle, ulaşmak istediğin sonuçları
                netleştir, aksiyon planlarını hazırla ve uygula.</li>
            <li><b>Sözünü tut.</b> Takip ve aksiyon konusunda verdiğin sözleri yerine getir.
                Bu, güven kurmanın en hızlı yoludur.</li>
            <li><b>Bir sorun varsa konuş.</b> İlişkiyle ilgili bir endişen varsa mentorunla ya da
                yöneticinle paylaş.</li>
          </ul>
          <div class="guide-callout">Sık yapılan hata: Görüşmeye hazırlıksız gelip
          "mentorum bugün ne anlatacak?" diye beklemek. Bu süreçte gündemi getiren taraf sensin.</div>`
      },
      {
        t: "4. İlk görüşme",
        h: `
          <ul class="guide-list">
            <li><b>Bağlantı kurun.</b> Ortak noktalarınızı arayın; benzerlikler samimiyeti hızlandırır.</li>
            <li><b>Bir düzene karar verin.</b> Görüşme sıklığını belirleyin, randevuları önceden
                takvime koyun, iptal/erteleme durumunda ne yapacağınızı baştan konuşun.</li>
            <li><b>Hedefleri belirleyin.</b> Yöneticin bazı hedefler belirlemiş olabilir; onları
                gözden geçirin, belirlenmemişse birlikte oluşturun.</li>
            <li><b>Güven inşa edin.</b> Senin tarafında bu şu demek: görüşmelere hazırlıklı gelmek,
                aksiyonları takip etmek, verdiğin sözü tutmak.</li>
          </ul>`
      },
      {
        t: "5. Birbirinizi tanıma",
        h: `
          <p>İyi bir mentorluk ilişkisi kişisel bağ üzerine kurulur. İlk görüşmelerde birbirinizin
          <b>güçlü yönlerini</b>, <b>kişilik ve iletişim tarzlarınızı</b> ve <b>temel değerlerinizi</b>
          konuşun.</p>
          <p class="guide-sub">Konuşma başlatıcı sorular — hepsini kullanmak zorunda değilsin,
          sana uygun gelenleri seç:</p>
          <ul class="guide-list">
            <li><b>İş ve profesyonel geçmiş:</b> En iyi ve en kötü iş deneyimin neydi?
                Neden bu işleri seçtin?</li>
            <li><b>Geçmiş başarılar:</b> Profesyonel ve kişisel olarak en çok gurur duyduğun şeyler neler?</li>
            <li><b>Geçmiş zorluklar:</b> En büyük engellerin nelerdi? Hâlâ üzerinde çalıştığın
                zorlu bir konu var mı?</li>
            <li><b>Dayanıklılık:</b> Dayanıklılığının sınandığı anlar hangileriydi?</li>
            <li><b>İlgi alanları:</b> Profesyonel ve kişisel olarak ilk üç ilgi alanın ne?</li>
            <li><b>Hayaller ve hedefler:</b> Önümüzdeki bir yılda ne başarmak istiyorsun?
                Senin başarı tanımın ne?</li>
            <li><b>Eğitim:</b> En iyi öğretmenlerin kimlerdi, onlardan ne öğrendin?</li>
            <li><b>Keyifli sorular:</b> Bir zaman makinen olsa nereye giderdin? Listendeki
                yapmak istediğin şeyler neler?</li>
          </ul>`
      },
      {
        t: "6. Hedef belirleme",
        h: `
          <p>Resmî bir mentorluk ilişkisinde <b>net hedefler</b> olmalı. Hedefler genellikle
          bilgi ve beceri geliştirmek, organizasyon yapısını ve kültürünü anlamak, belirli bir
          fonksiyonu daha yakından tanımak ya da liderlik becerileri kazanmak üzerine kurulur.</p>

          <p class="guide-sub">Hedef şablonu — mentorunla birlikte doldurun. Her hedef için
          <b>iki tarafın da</b> ne yapacağını yazın:</p>

          <div class="guide-box">
            <p><b>Önümüzdeki 3–6 aylık hedeflerimiz</b><br>
            <i>Örnek: "Önümüzdeki 3–6 ayda mentorumla birlikte, tedarikçi belirlemeden sözleşme
            görüşmesine kadar satın alma sürecinin tamamını gözlemleyeceğim."</i></p>
            <p>Mentorun adımları: ……<br>Mentee'nin adımları: ……</p>

            <p><b>Önümüzdeki 7–12 aylık hedeflerimiz</b><br>
            <i>Örnek: "Mentorumun rehberliğinde, sürecin bir bölümünü kendim yönetebileceğim
            bir fırsat belirlemek."</i></p>
            <p>Mentorun adımları: ……<br>Mentee'nin adımları: ……</p>

            <p><b>Uzun vadeli hedefler</b><br>
            <i>Örnek: "Bu alanı daha iyi anlayarak ilgili ekiple daha etkin çalışmak ve bu
            disiplini kendi deneyimime katmak."</i></p>
          </div>

          <div class="guide-callout">İyi bir hedef <b>somut</b> olur ("liderliğimi geliştirmek"
          değil, "ekip toplantılarını üç ay boyunca ben yönetmek"), <b>ölçülebilir</b> bir sonucu
          vardır ve <b>süresi bellidir</b>.</div>`
      },
      {
        t: "7. Zorlukları önceden konuşun",
        h: `
          <p>Her mentorluk ilişkisi bir noktada zorlanır. Bunu <b>önceden</b> konuşmak,
          yaşandığında çözmeyi kolaylaştırır.</p>
          <p class="guide-sub">Sık karşılaşılan zorluklar:</p>
          <ul class="guide-list">
            <li>Coğrafi mesafe</li>
            <li>Diğer işlerin zaman alması</li>
            <li>Teknolojik aksaklıklar</li>
            <li>Kültürel farklılıklar</li>
            <li>Basit yanlış anlaşılmalar</li>
          </ul>
          <p><b>Birlikte cevaplayın:</b> Bizi hangi zorluklar bekliyor olabilir?
          Bu zorlukları aşmak için ne yapacağımıza şimdiden söz veriyoruz?</p>`
      },
      {
        t: "8. Lojistik ve iletişim",
        h: `
          <ul class="guide-list">
            <li><b>Ne sıklıkta</b> buluşacağız?</li>
            <li><b>Nerede</b> buluşacağız ve aramızda <b>nasıl</b> iletişim kuracağız?
                (Mesaj, telefon, e-posta, anlık mesajlaşma — hangisi ikimize de uyuyor?)</li>
            <li><b>Kim başlatacak?</b> <i>(Öneri: görüşmeleri mentee başlatır.)</i></li>
            <li>Plan değişikliklerini nasıl yöneteceğiz?</li>
            <li><b>Sonraki adım:</b> Bir sonraki görüşme ne zaman, nerede, nasıl? Gündemi ne olacak?</li>
          </ul>`
      },
      {
        t: "9. Her görüşme için kontrol listesi",
        h: `
          <p class="guide-sub">Görüşmeden önce</p>
          <ul class="guide-check">
            <li>Gündemi belirledim ve mentoruma önceden ilettim</li>
            <li>Geçen görüşmede söz verdiğim aksiyonları tamamladım</li>
            <li>Tamamlayamadıysam nedenini açıklayabiliyorum</li>
            <li>Konuşmak istediğim somut bir durum/örnek hazırladım</li>
          </ul>
          <p class="guide-sub">Görüşme sırasında</p>
          <ul class="guide-check">
            <li>Not alıyorum</li>
            <li>Anlamadığım yerde soru soruyorum</li>
            <li>Duymak istemediğim geri bildirimi de dinliyorum</li>
            <li>Yeni aksiyonları ve son tarihlerini netleştiriyorum</li>
          </ul>
          <p class="guide-sub">Görüşmeden sonra</p>
          <ul class="guide-check">
            <li>Görüşme notunu çalışma alanına girdim</li>
            <li>Aksiyon maddelerini yazdım</li>
            <li>Bir sonraki görüşmeyi takvime koydum</li>
          </ul>`
      },
      {
        t: "10. Çalışma alanını kullanmak",
        h: `
          <p>Mentorluk süreciniz için size özel bir çalışma alanı açıldı. Giriş yapmak için ayrı
          bir kullanıcı adı/şifre gerekmez; e-postandaki bağlantı yeterlidir.</p>
          <ul class="guide-list">
            <li><b>Görüşme notu eklemek</b> — konuşulanlar, kararlar, çıkarımlar</li>
            <li><b>Aksiyon maddeleri yazmak</b> — her satır ayrı bir madde olarak kaydedilir,
                tamamlayınca işaretlersin</li>
            <li><b>Sonraki görüşmeyi planlamak</b> — tarih ve saat girdiğinde ikinize de takvim
                daveti gider</li>
            <li><b>Geçmişe bakmak</b> — tüm görüşme geçmişi burada durur</li>
          </ul>
          <div class="guide-callout">Notları düzenli tutmak angarya gibi görünür, ama süreç sonunda
          "ne kadar yol aldım?" sorusuna cevap veren tek şey bu kayıtlardır.</div>`
      },
      {
        t: "11. Kapanış",
        h: `
          <p>Mentorluk ilişkisinin <b>bir sonu vardır</b> ve bu normaldir. İdeal süre 9–12 aydır.
          Kapanış kararını mentorun ve sen, yöneticinle koordineli olarak verirsiniz.</p>
          <p class="guide-sub">Kapanış görüşmesinde konuşulması faydalı olanlar:</p>
          <ul class="guide-list">
            <li>Hedeflerin neresindeyiz?</li>
            <li>En çok neyde ilerleme kaydettim?</li>
            <li>Bundan sonra kendi başıma neye devam edeceğim?</li>
          </ul>
          <p>Süreç sonunda sana kısa bir <b>değerlendirme anketi</b> gönderilir. Dürüst cevapların
          programın gelişmesine doğrudan katkı sağlar.</p>`
      }
    ],

    // ---------------------------------------------------------------
    // MENTOR
    // ---------------------------------------------------------------
    mentor: [
      {
        t: "1. Mentorluk nedir, ne değildir?",
        h: `
          <p>Bu programda kastedilen şey <b>resmî bir mentorluk ilişkisi</b>:
          bir mentor ile bir mentee arasında, asıl amacı <b>mentee'nin gelişimi</b> olan
          yapılandırılmış bir çalışma. Bu ilişki genellikle mentee'nin yöneticisinin
          önerisiyle başlar.</p>

          <table class="guide-table">
            <tr><th>Mentorluk şudur</th><th>Mentorluk şu değildir</th></tr>
            <tr><td>Mentee'nin gelişimine odaklanan bir ilişki</td><td>Performans değerlendirmesi</td></tr>
            <tr><td>Deneyim aktarımı ve birlikte düşünme</td><td>Hazır çözüm dağıtma yeri</td></tr>
            <tr><td>Mentee'nin yönlendirdiği bir süreç</td><td>Senin ders anlattığın bir eğitim</td></tr>
            <tr><td>Güvene dayalı, gizli bir alan</td><td>Yöneticiye rapor edilen bir toplantı</td></tr>
            <tr><td>Sorular sorarak yol açmak</td><td>Kendi kariyerini reçete olarak sunmak</td></tr>
          </table>

          <div class="guide-callout">En sık düşülen tuzak: Kendi deneyimini anlatmaya kaptırıp
          mentee'yi dinlememek. Deneyimin değerli, ama ancak mentee'nin durumuna uyarlandığında
          işe yarar.</div>`
      },
      {
        t: "2. Süreç nasıl işliyor?",
        h: `
          <ol class="guide-steps">
            <li><b>Gelişim ihtiyacının belirlenmesi</b> — Mentee'nin yöneticisi, genellikle yetenek
                değerlendirme sürecinde, bir gelişim fırsatı belirler.</li>
            <li><b>Mentorun belirlenmesi</b> — Yönetici, liderlik ve paydaşlarla birlikte uygun bir
                iç mentor belirler ve mentorle ön görüşme yapar.</li>
            <li><b>İlk görüşme</b> — Mentee ile bir araya gelir, çalışma kurallarınızı ve görüşme
                sıklığınızı belirlersiniz.</li>
            <li><b>Düzenli görüşmeler</b> — Sen gelişimi için aksiyonlar önerirsin, mentee
                sonuçlarını paylaşır.</li>
            <li><b>Kapanış</b> — Sen ve mentee, yöneticiyle koordineli olarak ilişkinin ne zaman
                sonlanacağına karar verirsiniz. İdeal süre <b>9–12 aydır</b>.</li>
          </ol>`
      },
      {
        t: "3. Senin sorumlulukların",
        h: `
          <ul class="guide-list">
            <li><b>İlgi göster.</b> Merak ederek, derinlemesine dinleyerek ve verdiğin sözleri
                tutarak önemsediğini göster.</li>
            <li><b>Gizliliği koru.</b> Mentee ile aranızda konuşulanlar gizlidir. Bu, ilişkinin
                taşıyıcı sütunudur.</li>
            <li><b>Olumlu bir deneyim kur.</b> Açık uçlu sorular sor; mentee'nin güçlü yönlerini,
                değerlerini ve önündeki engelleri birlikte keşfedin.</li>
            <li><b>Harekete geçir.</b> Net ve iddialı hedefler kurmasını, o hedeflere odaklı adımlar
                atmasını destekle ve bu adımlar için taahhüt al.</li>
            <li><b>Bir sorun varsa konuş.</b> İlişkiyle ilgili bir endişen varsa mentee ile ya da
                onun yöneticisiyle paylaş.</li>
          </ul>
          <div class="guide-callout">Rolünün sınırı: Sen mentee'nin yöneticisi değilsin.
          Görevin değerlendirmek değil, geliştirmek. Performans konuları yöneticinin alanıdır.</div>`
      },
      {
        t: "4. İlk görüşme",
        h: `
          <ul class="guide-list">
            <li><b>Bağlantı kurun.</b> Ortak noktalarınızı arayın; benzerlikler samimiyeti hızlandırır.</li>
            <li><b>Bir düzene karar verin.</b> Görüşme sıklığını belirleyin, randevuları önceden
                takvime koyun, iptal/erteleme durumunda ne yapacağınızı baştan konuşun.</li>
            <li><b>Hedefleri belirleyin.</b> Yönetici bazı hedefler belirlemiş olabilir; onları
                gözden geçirin, belirlenmemişse birlikte oluşturun.</li>
            <li><b>Güven inşa edin.</b> Senin tarafında bu şu demek: randevulara katılmak,
                uygulanabilir geri bildirim vermek ve mentee'nin gelişimine yardımcı olacak
                fırsatlar aramak.</li>
          </ul>`
      },
      {
        t: "5. Birbirinizi tanıma",
        h: `
          <p>İyi bir mentorluk ilişkisi kişisel bağ üzerine kurulur. İlk görüşmelerde birbirinizin
          <b>güçlü yönlerini</b>, <b>kişilik ve iletişim tarzlarınızı</b> ve <b>temel değerlerinizi</b>
          konuşun.</p>
          <p class="guide-sub">Konuşma başlatıcı sorular — uygun gelenleri seç, mentee'ye rahatsızlık
          veren bir konuyu zorlamana gerek yok:</p>
          <ul class="guide-list">
            <li><b>İş ve profesyonel geçmiş:</b> En iyi ve en kötü iş deneyimin neydi?</li>
            <li><b>Geçmiş başarılar:</b> En çok gurur duyduğun şeyler neler?</li>
            <li><b>Geçmiş zorluklar:</b> En büyük engellerin nelerdi?</li>
            <li><b>Dayanıklılık:</b> Dayanıklılığının sınandığı anlar hangileriydi?</li>
            <li><b>İlgi alanları:</b> Profesyonel ve kişisel olarak ilk üç ilgi alanın ne?</li>
            <li><b>Hayaller ve hedefler:</b> Senin başarı tanımın ne?</li>
            <li><b>Eğitim:</b> En iyi öğretmenlerin kimlerdi, onlardan ne öğrendin?</li>
            <li><b>Keyifli sorular:</b> Bir zaman makinen olsa nereye giderdin?</li>
          </ul>
          <div class="guide-callout">İpucu: Bu soruları sadece sorma — sen de cevapla.
          Karşılıklı paylaşım, tek taraflı sorgudan çok daha hızlı güven kurar.</div>`
      },
      {
        t: "6. Hedef belirleme",
        h: `
          <p>Resmî bir mentorluk ilişkisinde <b>net hedefler</b> olmalı. Hedefler genellikle
          bilgi ve beceri geliştirmek, organizasyon yapısını ve kültürünü anlamak, belirli bir
          fonksiyonu daha yakından tanımak ya da liderlik becerileri kazanmak üzerine kurulur.</p>

          <p class="guide-sub">Hedef şablonu — mentee ile birlikte doldurun. Her hedef için
          <b>iki tarafın da</b> ne yapacağını yazın:</p>

          <div class="guide-box">
            <p><b>Önümüzdeki 3–6 aylık hedeflerimiz</b><br>
            <i>Örnek: "Önümüzdeki 3–6 ayda mentee, tedarikçi belirlemeden sözleşme görüşmesine
            kadar satın alma sürecinin tamamını mentoruyla birlikte gözlemleyecek."</i></p>
            <p>Mentorun adımları: ……<br>Mentee'nin adımları: ……</p>

            <p><b>Önümüzdeki 7–12 aylık hedeflerimiz</b><br>
            <i>Örnek: "Mentorun rehberliğinde, mentee'nin sürecin bir bölümünü kendi
            yönetebileceği bir fırsat belirlemek."</i></p>
            <p>Mentorun adımları: ……<br>Mentee'nin adımları: ……</p>

            <p><b>Uzun vadeli hedefler</b><br>
            <i>Örnek: "Bu alanı daha iyi anlayarak ilgili ekiple daha etkin çalışmak ve bu
            disiplini kendi deneyimine katmak."</i></p>
          </div>

          <div class="guide-callout">Hedefi <b>mentee'ye kurdur</b>. Sen netleştirici sorular sor:
          "Bunu başardığını nasıl anlayacaksın?", "Üç ay sonra elinde ne olacak?" Hedef senin
          ağzından çıkarsa mentee onu sahiplenmez.</div>`
      },
      {
        t: "7. İyi mentorluk pratikleri",
        h: `
          <ul class="guide-list">
            <li><b>Konuşmadan çok dinle.</b> Genel kural: konuşmanın dörtte birinden azı sana ait olsun.</li>
            <li><b>Cevap yerine soru ver.</b> "Ben olsam şunu yapardım" demeden önce
                "sen hangi seçenekleri düşündün?" diye sor.</li>
            <li><b>Somutlaştır.</b> Mentee "iletişimimi geliştirmek istiyorum" dediğinde,
                geçen hafta yaşadığı gerçek bir durumu konuşun.</li>
            <li><b>Geri bildirimi yumuşatma, netleştir.</b> Belirsiz övgü kimseyi geliştirmez.
                Ne olduğunu, etkisini ve bunun yerine ne yapılabileceğini söyle.</li>
            <li><b>Sessizliğe izin ver.</b> Mentee düşünürken araya girme. En değerli cevaplar
                genellikle o boşluktan çıkar.</li>
            <li><b>Kendi hatalarını da anlat.</b> Sadece başarılarını anlatan mentor ulaşılmaz
                görünür ve öğretmez.</li>
            <li><b>Sınırını bil.</b> Uzmanlık alanının dışında bir konu geldiğinde tahmin yürütmek
                yerine doğru kişiye yönlendir.</li>
          </ul>`
      },
      {
        t: "8. Zorlukları önceden konuşun",
        h: `
          <p>Her mentorluk ilişkisi bir noktada zorlanır. Bunu <b>önceden</b> konuşmak,
          yaşandığında çözmeyi kolaylaştırır.</p>
          <p class="guide-sub">Sık karşılaşılan zorluklar:</p>
          <ul class="guide-list">
            <li>Coğrafi mesafe</li>
            <li>Diğer işlerin zaman alması</li>
            <li>Teknolojik aksaklıklar</li>
            <li>Kültürel farklılıklar</li>
            <li>Basit yanlış anlaşılmalar</li>
          </ul>
          <p><b>Birlikte cevaplayın:</b> Bizi hangi zorluklar bekliyor olabilir?
          Bu zorlukları aşmak için ne yapacağımıza şimdiden söz veriyoruz?</p>`
      },
      {
        t: "9. Lojistik ve iletişim",
        h: `
          <ul class="guide-list">
            <li><b>Ne sıklıkta</b> buluşacağız?</li>
            <li><b>Nerede</b> buluşacağız ve aramızda <b>nasıl</b> iletişim kuracağız?</li>
            <li><b>Kim başlatacak?</b> <i>(Öneri: görüşmeleri mentee başlatır. Bu, sürecin
                sahipliğini mentee'de tutar.)</i></li>
            <li>Plan değişikliklerini nasıl yöneteceğiz?</li>
            <li><b>Sonraki adım:</b> Bir sonraki görüşme ne zaman, nerede, nasıl? Gündemi ne olacak?</li>
          </ul>`
      },
      {
        t: "10. Her görüşme için kontrol listesi",
        h: `
          <p class="guide-sub">Görüşmeden önce</p>
          <ul class="guide-check">
            <li>Geçen görüşmenin notlarına ve aksiyon maddelerine baktım</li>
            <li>Mentee'nin gönderdiği gündemi okudum</li>
            <li>Verdiğim sözleri (tanıştırma, kaynak paylaşımı vb.) yerine getirdim</li>
          </ul>
          <p class="guide-sub">Görüşme sırasında</p>
          <ul class="guide-check">
            <li>Konuşmadan çok dinledim</li>
            <li>Açık uçlu sorular sordum</li>
            <li>Somut ve uygulanabilir geri bildirim verdim</li>
            <li>Yeni aksiyonları ve son tarihlerini netleştirdik</li>
          </ul>
          <p class="guide-sub">Görüşmeden sonra</p>
          <ul class="guide-check">
            <li>Görüşme notunu çalışma alanına girdim</li>
            <li>Aksiyon maddelerini yazdım</li>
            <li>Bir sonraki görüşmeyi takvime koydum</li>
          </ul>`
      },
      {
        t: "11. Çalışma alanını kullanmak",
        h: `
          <p>Mentorluk süreciniz için size özel bir çalışma alanı açıldı. Giriş yapmak için ayrı
          bir kullanıcı adı/şifre gerekmez; e-postandaki bağlantı yeterlidir.</p>
          <ul class="guide-list">
            <li><b>Görüşme notu eklemek</b> — konuşulanlar, kararlar, çıkarımlar</li>
            <li><b>Aksiyon maddeleri yazmak</b> — her satır ayrı bir madde olarak kaydedilir</li>
            <li><b>Sonraki görüşmeyi planlamak</b> — tarih ve saat girdiğinde ikinize de takvim
                daveti gider; gerekirse ek katılımcı da davet edebilirsin</li>
            <li><b>Geçmişe bakmak</b> — tüm görüşme geçmişi burada durur</li>
          </ul>
          <div class="guide-callout">Notlar aynı zamanda kapanışta "ne kadar yol alındı?"
          sorusunun tek somut cevabıdır.</div>`
      },
      {
        t: "12. Kapanış",
        h: `
          <p>Mentorluk ilişkisinin <b>bir sonu vardır</b> ve bu normaldir. İdeal süre 9–12 aydır.
          Kapanış kararını sen ve mentee, yöneticiyle koordineli olarak verirsiniz.</p>
          <p class="guide-sub">Kapanış görüşmesinde konuşulması faydalı olanlar:</p>
          <ul class="guide-list">
            <li>Hedeflerin neresindeyiz?</li>
            <li>Mentee en çok neyde ilerleme kaydetti?</li>
            <li>Bundan sonra kendi başına neye devam etmeli?</li>
            <li>Bu ilişkiden ben ne öğrendim?</li>
          </ul>
          <p>Süreç sonunda sana kısa bir <b>değerlendirme anketi</b> gönderilir.</p>`
      }
    ]
  },

  /* ================================================================
     ENGLISH
     ================================================================ */
  en: {

    // ---------------------------------------------------------------
    // MENTEE
    // ---------------------------------------------------------------
    mentee: [
      {
        t: "1. What mentoring is — and is not",
        h: `
          <p>In this programme, mentoring means a <b>formal mentoring relationship</b>:
          structured work between a mentor and a mentee whose primary purpose is the
          <b>mentee's development</b>. It is usually recommended by your manager and forms
          part of your development plan.</p>

          <table class="guide-table">
            <tr><th>Mentoring is</th><th>Mentoring is not</th></tr>
            <tr><td>A relationship focused on your development</td><td>A performance review</td></tr>
            <tr><td>Sharing experience and thinking together</td><td>A place to collect ready-made answers</td></tr>
            <tr><td>A process you drive</td><td>A class where your mentor sets homework</td></tr>
            <tr><td>A confidential space built on trust</td><td>A meeting reported back to your manager</td></tr>
            <tr><td>A 9–12 month relationship with an end point</td><td>Open-ended consulting</td></tr>
          </table>

          <div class="guide-callout">The key point: this is <b>your</b> process. Your mentor
          shows the way, but you steer.</div>`
      },
      {
        t: "2. How the process works",
        h: `
          <ol class="guide-steps">
            <li><b>Identify the development need</b> — Your manager identifies a development
                opportunity, typically through the talent review process.</li>
            <li><b>Identify a mentor</b> — Your manager works with leadership and other
                stakeholders to identify an internal mentor and aligns with them first.</li>
            <li><b>Initial meeting</b> — You and your mentor meet to agree working guidelines
                and a meeting cadence.</li>
            <li><b>Regular meetings</b> — You meet regularly. Your mentor suggests development
                actions and you report back on them.</li>
            <li><b>Closure</b> — You and your mentor, in coordination with your manager, decide
                when the relationship should end. The ideal length is <b>9–12 months</b>.</li>
          </ol>`
      },
      {
        t: "3. Your responsibilities",
        h: `
          <ul class="guide-list">
            <li><b>Be open.</b> Show a willingness to explore your own insights and views.</li>
            <li><b>Listen, ask, challenge.</b> Question your own assumptions and ask for help.</li>
            <li><b>Take ownership.</b> The session is your responsibility. Drive the relationship
                and participate actively and fully.</li>
            <li><b>Set the agenda.</b> Determine the focus of meetings, establish the outcomes and
                goals you want, and prepare and implement action plans.</li>
            <li><b>Keep your commitments.</b> Follow through on what you said you would do —
                it is the fastest way to build trust.</li>
            <li><b>Speak up if something is wrong.</b> If you have concerns about the relationship,
                raise them with your mentor or your manager.</li>
          </ul>
          <div class="guide-callout">A common mistake: arriving unprepared and waiting to see what
          your mentor will talk about. In this process, you are the one who brings the agenda.</div>`
      },
      {
        t: "4. The initial meeting",
        h: `
          <ul class="guide-list">
            <li><b>Establish a connection.</b> Look for things you have in common — similarities
                build rapport quickly.</li>
            <li><b>Commit to a process.</b> Agree a cadence, schedule appointments in advance, and
                decide up front what happens if a meeting is cancelled or rescheduled.</li>
            <li><b>Identify and set goals.</b> Your manager may already have identified goals —
                review them, or create them together if they do not exist yet.</li>
            <li><b>Build trust.</b> On your side this means coming prepared, following through on
                actions, and keeping your commitments.</li>
          </ul>`
      },
      {
        t: "5. Getting to know each other",
        h: `
          <p>A good mentoring relationship rests on a personal connection. In your first meetings,
          discuss each other's <b>strengths</b>, <b>personality and communication styles</b>, and
          <b>core values</b>.</p>
          <p class="guide-sub">Conversation starters — you do not have to use them all, pick the
          ones that appeal to you:</p>
          <ul class="guide-list">
            <li><b>Work and professional background:</b> What was your best and worst experience?
                Why did you choose the jobs you did?</li>
            <li><b>Past successes:</b> What are you most proud of, professionally and personally?</li>
            <li><b>Past difficulties:</b> What have been your greatest challenges or obstacles?
                What are you still working on?</li>
            <li><b>Resilience:</b> When have your powers of resilience been tested?</li>
            <li><b>Interests:</b> What are your top three interests, professionally and personally?</li>
            <li><b>Dreams and aspirations:</b> What do you hope to accomplish in the next year?
                What is your definition of success?</li>
            <li><b>Education:</b> Who were your best teachers and advisors, and what did you learn
                from them?</li>
            <li><b>For fun:</b> If you had a time machine, where would you go and who would you
                meet? What is on your bucket list?</li>
          </ul>`
      },
      {
        t: "6. Setting goals",
        h: `
          <p>A formal mentoring relationship needs <b>clear goals</b>. They usually focus on
          improving knowledge and skills, better understanding organisational structure and
          culture, gaining broader knowledge of a specific function, or building leadership skills.</p>

          <p class="guide-sub">Goal template — complete it with your mentor. For each goal, write
          what <b>both sides</b> will do:</p>

          <div class="guide-box">
            <p><b>Our goals for the next 3–6 months</b><br>
            <i>Example: "In the next 3–6 months I will shadow the full-cycle procurement process
            from vendor identification and selection through to contract negotiation with my
            mentor."</i></p>
            <p>Action steps for mentor: ……<br>Action steps for mentee: ……</p>

            <p><b>Our goals for the next 7–12 months</b><br>
            <i>Example: "Identify an opportunity for me to lead part of the process with my mentor
            guiding me."</i></p>
            <p>Action steps for mentor: ……<br>Action steps for mentee: ……</p>

            <p><b>Long-term goals</b><br>
            <i>Example: "Gain a better understanding of this area so I can partner more effectively
            with the team and add breadth to my experience."</i></p>
          </div>

          <div class="guide-callout">A good goal is <b>specific</b> ("chair the team meeting for
          three months", not "improve my leadership"), has a <b>measurable</b> outcome, and has a
          <b>deadline</b>.</div>`
      },
      {
        t: "7. Anticipating challenges together",
        h: `
          <p>Every mentoring relationship runs into difficulty at some point. Discussing this
          <b>in advance</b> makes it far easier to resolve when it happens.</p>
          <p class="guide-sub">Typical challenges:</p>
          <ul class="guide-list">
            <li>Geographical distance</li>
            <li>Time taken by other tasks</li>
            <li>Technological failure</li>
            <li>Cultural gaps</li>
            <li>Simple miscommunication</li>
          </ul>
          <p><b>Answer together:</b> What challenges do we anticipate, and how do we commit to
          overcoming them?</p>`
      },
      {
        t: "8. Logistics and communication",
        h: `
          <ul class="guide-list">
            <li><b>How often</b> will we meet?</li>
            <li><b>Where</b> will we meet and <b>how</b> will we communicate day to day?
                (Text, phone, email, instant messaging — what suits us both?)</li>
            <li><b>Who initiates?</b> <i>(Suggestion: the mentee initiates.)</i></li>
            <li>How will we make future plans and adjustments?</li>
            <li><b>Next steps:</b> When, where and how is the next meeting? What is the agenda?</li>
          </ul>`
      },
      {
        t: "9. Checklist for every meeting",
        h: `
          <p class="guide-sub">Before the meeting</p>
          <ul class="guide-check">
            <li>I set the agenda and sent it to my mentor in advance</li>
            <li>I completed the actions I committed to last time</li>
            <li>If I did not, I can explain why</li>
            <li>I prepared a concrete situation or example to discuss</li>
          </ul>
          <p class="guide-sub">During the meeting</p>
          <ul class="guide-check">
            <li>I am taking notes</li>
            <li>I ask when I do not understand something</li>
            <li>I listen to feedback I did not want to hear</li>
            <li>We are agreeing new actions and their deadlines</li>
          </ul>
          <p class="guide-sub">After the meeting</p>
          <ul class="guide-check">
            <li>I added the meeting note to the workspace</li>
            <li>I wrote down the action items</li>
            <li>I scheduled the next meeting</li>
          </ul>`
      },
      {
        t: "10. Using the workspace",
        h: `
          <p>A dedicated workspace has been created for your mentoring relationship. You do not need
          a separate username or password — the link in your email is enough.</p>
          <ul class="guide-list">
            <li><b>Add meeting notes</b> — what was discussed, decisions, reflections</li>
            <li><b>Write action items</b> — each line is saved as a separate item you tick off
                when done</li>
            <li><b>Schedule the next meeting</b> — entering a date and time sends a calendar
                invitation to both of you</li>
            <li><b>Look back</b> — your full meeting history is kept here</li>
          </ul>
          <div class="guide-callout">Keeping notes can feel like admin, but at the end of the
          process these records are the only thing that answers "how far have I come?"</div>`
      },
      {
        t: "11. Closure",
        h: `
          <p>A mentoring relationship <b>has an end</b>, and that is normal. The ideal length is
          9–12 months. You and your mentor decide on closure in coordination with your manager.</p>
          <p class="guide-sub">Worth discussing in the closing meeting:</p>
          <ul class="guide-list">
            <li>Where are we against the goals?</li>
            <li>Where did I make the most progress?</li>
            <li>What will I continue on my own from here?</li>
          </ul>
          <p>At the end of the process you will receive a short <b>feedback survey</b>. Honest
          answers directly improve the programme.</p>`
      }
    ],

    // ---------------------------------------------------------------
    // MENTOR
    // ---------------------------------------------------------------
    mentor: [
      {
        t: "1. What mentoring is — and is not",
        h: `
          <p>In this programme, mentoring means a <b>formal mentoring relationship</b>:
          structured work between a mentor and a mentee whose primary purpose is the
          <b>mentee's development</b>. It usually begins on the recommendation of the mentee's
          manager.</p>

          <table class="guide-table">
            <tr><th>Mentoring is</th><th>Mentoring is not</th></tr>
            <tr><td>A relationship focused on the mentee's development</td><td>A performance review</td></tr>
            <tr><td>Sharing experience and thinking together</td><td>Handing out ready-made answers</td></tr>
            <tr><td>A process the mentee drives</td><td>A course you teach</td></tr>
            <tr><td>A confidential space built on trust</td><td>A meeting reported back to the manager</td></tr>
            <tr><td>Opening a path by asking questions</td><td>Prescribing your own career</td></tr>
          </table>

          <div class="guide-callout">The most common trap: getting caught up in telling your own
          story and not listening. Your experience is valuable, but only when adapted to the
          mentee's situation.</div>`
      },
      {
        t: "2. How the process works",
        h: `
          <ol class="guide-steps">
            <li><b>Identify the development need</b> — The mentee's manager identifies a
                development opportunity, typically through the talent review process.</li>
            <li><b>Identify a mentor</b> — The manager works with leadership and stakeholders to
                identify an internal mentor and aligns with them first.</li>
            <li><b>Initial meeting</b> — You and the mentee meet to agree working guidelines and a
                meeting cadence.</li>
            <li><b>Regular meetings</b> — You suggest development actions and the mentee reports
                back on them.</li>
            <li><b>Closure</b> — You and the mentee, in coordination with the manager, decide when
                the relationship should end. The ideal length is <b>9–12 months</b>.</li>
          </ol>`
      },
      {
        t: "3. Your responsibilities",
        h: `
          <ul class="guide-list">
            <li><b>Demonstrate care.</b> Show curiosity, listen deeply, and follow through on the
                commitments you make to your mentee.</li>
            <li><b>Maintain confidentiality.</b> What is discussed between you stays between you.
                This is the load-bearing pillar of the relationship.</li>
            <li><b>Create a positive experience.</b> Ask open-ended questions and explore the
                mentee's strengths, values and obstacles together.</li>
            <li><b>Inspire action.</b> Encourage clear and compelling goals, focused action toward
                them, and gain commitment to that action.</li>
            <li><b>Speak up if something is wrong.</b> If you have concerns about the relationship,
                raise them with the mentee or their manager.</li>
          </ul>
          <div class="guide-callout">The limit of your role: you are not the mentee's manager.
          Your job is to develop, not to assess. Performance matters belong to the manager.</div>`
      },
      {
        t: "4. The initial meeting",
        h: `
          <ul class="guide-list">
            <li><b>Establish a connection.</b> Look for things you have in common — similarities
                build rapport quickly.</li>
            <li><b>Commit to a process.</b> Agree a cadence, schedule appointments in advance, and
                decide up front what happens if a meeting is cancelled or rescheduled.</li>
            <li><b>Identify and set goals.</b> The manager may already have identified goals —
                review them, or create them together if they do not exist yet.</li>
            <li><b>Build trust.</b> On your side this means showing up for appointments, providing
                actionable feedback, and looking for opportunities to help the mentee develop.</li>
          </ul>`
      },
      {
        t: "5. Getting to know each other",
        h: `
          <p>A good mentoring relationship rests on a personal connection. In your first meetings,
          discuss each other's <b>strengths</b>, <b>personality and communication styles</b>, and
          <b>core values</b>.</p>
          <p class="guide-sub">Conversation starters — pick the ones that fit; there is no need to
          push a topic the mentee is uncomfortable with:</p>
          <ul class="guide-list">
            <li><b>Work and professional background:</b> What was your best and worst experience?</li>
            <li><b>Past successes:</b> What are you most proud of?</li>
            <li><b>Past difficulties:</b> What have been your greatest obstacles?</li>
            <li><b>Resilience:</b> When have your powers of resilience been tested?</li>
            <li><b>Interests:</b> What are your top three interests?</li>
            <li><b>Dreams and aspirations:</b> What is your definition of success?</li>
            <li><b>Education:</b> Who were your best teachers, and what did you learn from them?</li>
            <li><b>For fun:</b> If you had a time machine, where would you go?</li>
          </ul>
          <div class="guide-callout">A tip: do not just ask these questions — answer them too.
          Mutual sharing builds trust far faster than a one-sided interview.</div>`
      },
      {
        t: "6. Setting goals",
        h: `
          <p>A formal mentoring relationship needs <b>clear goals</b>. They usually focus on
          improving knowledge and skills, better understanding organisational structure and
          culture, gaining broader knowledge of a specific function, or building leadership skills.</p>

          <p class="guide-sub">Goal template — complete it with the mentee. For each goal, write
          what <b>both sides</b> will do:</p>

          <div class="guide-box">
            <p><b>Our goals for the next 3–6 months</b><br>
            <i>Example: "In the next 3–6 months the mentee will shadow the full-cycle procurement
            process from vendor identification and selection through to contract negotiation with
            their mentor."</i></p>
            <p>Action steps for mentor: ……<br>Action steps for mentee: ……</p>

            <p><b>Our goals for the next 7–12 months</b><br>
            <i>Example: "Identify an opportunity for the mentee to lead part of the process with
            the mentor guiding them."</i></p>
            <p>Action steps for mentor: ……<br>Action steps for mentee: ……</p>

            <p><b>Long-term goals</b><br>
            <i>Example: "Gain a better understanding of this area so the mentee can partner more
            effectively with the team and add breadth to their experience."</i></p>
          </div>

          <div class="guide-callout">Let the <b>mentee</b> set the goal. Your job is to ask
          clarifying questions: "How will you know you have achieved this?", "What will you have
          in three months?" A goal that comes out of your mouth is not one the mentee owns.</div>`
      },
      {
        t: "7. Good mentoring practices",
        h: `
          <ul class="guide-list">
            <li><b>Listen more than you talk.</b> A rule of thumb: less than a quarter of the
                conversation should be yours.</li>
            <li><b>Ask rather than answer.</b> Before saying "here is what I would do", ask
                "what options have you considered?"</li>
            <li><b>Make it concrete.</b> When the mentee says "I want to improve my communication",
                discuss a real situation from last week.</li>
            <li><b>Do not soften feedback — sharpen it.</b> Vague praise develops no one. Say what
                happened, what its effect was, and what could be done instead.</li>
            <li><b>Allow silence.</b> Do not fill the pause while the mentee is thinking. The most
                valuable answers usually come out of that gap.</li>
            <li><b>Share your mistakes too.</b> A mentor who only recounts successes looks
                unreachable and teaches nothing.</li>
            <li><b>Know your limits.</b> When a topic falls outside your expertise, point the
                mentee to the right person rather than guessing.</li>
          </ul>`
      },
      {
        t: "8. Anticipating challenges together",
        h: `
          <p>Every mentoring relationship runs into difficulty at some point. Discussing this
          <b>in advance</b> makes it far easier to resolve when it happens.</p>
          <p class="guide-sub">Typical challenges:</p>
          <ul class="guide-list">
            <li>Geographical distance</li>
            <li>Time taken by other tasks</li>
            <li>Technological failure</li>
            <li>Cultural gaps</li>
            <li>Simple miscommunication</li>
          </ul>
          <p><b>Answer together:</b> What challenges do we anticipate, and how do we commit to
          overcoming them?</p>`
      },
      {
        t: "9. Logistics and communication",
        h: `
          <ul class="guide-list">
            <li><b>How often</b> will we meet?</li>
            <li><b>Where</b> will we meet and <b>how</b> will we communicate day to day?</li>
            <li><b>Who initiates?</b> <i>(Suggestion: the mentee initiates. This keeps ownership
                of the process with them.)</i></li>
            <li>How will we make future plans and adjustments?</li>
            <li><b>Next steps:</b> When, where and how is the next meeting? What is the agenda?</li>
          </ul>`
      },
      {
        t: "10. Checklist for every meeting",
        h: `
          <p class="guide-sub">Before the meeting</p>
          <ul class="guide-check">
            <li>I reviewed the last meeting's notes and action items</li>
            <li>I read the agenda the mentee sent</li>
            <li>I delivered on what I promised (introductions, resources, and so on)</li>
          </ul>
          <p class="guide-sub">During the meeting</p>
          <ul class="guide-check">
            <li>I listened more than I talked</li>
            <li>I asked open-ended questions</li>
            <li>I gave concrete, actionable feedback</li>
            <li>We agreed new actions and their deadlines</li>
          </ul>
          <p class="guide-sub">After the meeting</p>
          <ul class="guide-check">
            <li>I added the meeting note to the workspace</li>
            <li>I wrote down the action items</li>
            <li>I scheduled the next meeting</li>
          </ul>`
      },
      {
        t: "11. Using the workspace",
        h: `
          <p>A dedicated workspace has been created for your mentoring relationship. You do not need
          a separate username or password — the link in your email is enough.</p>
          <ul class="guide-list">
            <li><b>Add meeting notes</b> — what was discussed, decisions, reflections</li>
            <li><b>Write action items</b> — each line is saved as a separate item</li>
            <li><b>Schedule the next meeting</b> — entering a date and time sends a calendar
                invitation to both of you, and you can invite additional guests if needed</li>
            <li><b>Look back</b> — your full meeting history is kept here</li>
          </ul>
          <div class="guide-callout">These notes are also the only concrete answer to
          "how far did we get?" at closure.</div>`
      },
      {
        t: "12. Closure",
        h: `
          <p>A mentoring relationship <b>has an end</b>, and that is normal. The ideal length is
          9–12 months. You and the mentee decide on closure in coordination with the manager.</p>
          <p class="guide-sub">Worth discussing in the closing meeting:</p>
          <ul class="guide-list">
            <li>Where are we against the goals?</li>
            <li>Where did the mentee make the most progress?</li>
            <li>What should they continue on their own from here?</li>
            <li>What did I learn from this relationship?</li>
          </ul>
          <p>At the end of the process you will receive a short <b>feedback survey</b>.</p>`
      }
    ]
  }
};
