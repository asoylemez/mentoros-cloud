const settings = require("../db/settings");
const { assertClean } = require("./privacy");
const audit = require("./audit");

/**
 * ====================================================================
 * TEK YAPAY ZEKA GIRIS NOKTASI
 * ====================================================================
 *
 * Uygulamadaki hicbir yer Claude'u dogrudan cagirmaz; hepsi buradan
 * gecer. Boylece:
 *   - Gizlilik kontrolu tek yerde zorunlu kilinir
 *   - Saglayici (anthropic / bedrock / vertex) tek yerden degisir
 *   - Denetim logu tek yerde tutulur
 *
 * Yapilandirma VERITABANINDAN okunur (admin paneli), .env'den degil.
 * Admin panelden ayar degistirince onbellek sifirlanir ve yeni ayar
 * aninda gecerli olur - sunucuyu yeniden baslatmaya gerek yok.
 */

let cached = null;

/** Ayar degisince cagrilir; bir sonraki istekte yeni istemci kurulur. */
function resetClient() {
  cached = null;
}

function signatureOf(cfg) {
  return [
    cfg.provider, cfg.model, cfg.anthropicApiKey,
    cfg.awsRegion, cfg.awsAccessKeyId, cfg.gcpProject, cfg.gcpRegion
  ].join("|");
}

function getClient() {
  const cfg = settings.getAiConfig();

  if (!cfg.configured) {
    const err = new Error(
      "Yapay zeka baglantisi yapilandirilmamis. " +
      "Yonetici panelinden baglantiyi kurun: /admin.html"
    );
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const signature = signatureOf(cfg);
  if (cached && cached.signature === signature) return cached;

  let client;

  switch (cfg.provider) {
    case "bedrock": {
      const { AnthropicBedrock } = require("@anthropic-ai/bedrock-sdk");
      client = new AnthropicBedrock({
        awsRegion: cfg.awsRegion,
        awsAccessKey: cfg.awsAccessKeyId || undefined,
        awsSecretKey: cfg.awsSecretAccessKey || undefined
      });
      break;
    }

    case "vertex": {
      const { AnthropicVertex } = require("@anthropic-ai/vertex-sdk");
      client = new AnthropicVertex({
        projectId: cfg.gcpProject,
        region: cfg.gcpRegion
      });
      break;
    }

    case "anthropic":
    default: {
      const Anthropic = require("@anthropic-ai/sdk");
      client = new Anthropic({ apiKey: cfg.anthropicApiKey });
      break;
    }
  }

  cached = { client, signature, cfg };
  return cached;
}

/**
 * ====================================================================
 * HATA TESHISI
 * ====================================================================
 * SDK hatalari teknik ve Ingilizce. Bunlari, IT ekibinin okuyup NE
 * YAPACAGINI anlayacagi Turkce mesajlara cevirir.
 */
function diagnose(error, provider, model, lang = "en") {
  const status = error?.status || error?.statusCode;
  const message = String(error?.message || "");
  const tr = lang === "tr";

  const pick = (code, t, e) => ({ ok: false, code, ...(tr ? t : e) });

  if (error?.code === "AI_NOT_CONFIGURED") {
    return pick("not_configured",
      { title: "Baglanti henuz kurulmadi",
        detail: "Yapay zeka baglantisi yapilandirilmamis.",
        action: "Asagidaki formdan kendi Claude erisiminizi baglayin." },
      { title: "Not connected yet",
        detail: "The AI connection has not been configured.",
        action: "Use the form below to connect your own Claude access." });
  }

  if (status === 401) {
    return pick("invalid_key",
      { title: "Kimlik bilgisi gecersiz",
        detail: provider === "anthropic"
          ? "Girilen API anahtari reddedildi. Anahtar yanlis, silinmis veya suresi dolmus olabilir."
          : "Bulut kimlik bilgileri reddedildi.",
        action: provider === "anthropic"
          ? "console.anthropic.com > Settings > API Keys adresinden yeni bir anahtar olusturup buraya yapistirin."
          : "Bulut erisim anahtarlarinizi kontrol edin." },
      { title: "Invalid credentials",
        detail: provider === "anthropic"
          ? "The API key was rejected. It may be wrong, revoked or expired."
          : "The cloud credentials were rejected.",
        action: provider === "anthropic"
          ? "Create a new key at console.anthropic.com > Settings > API Keys and paste it here."
          : "Check your cloud access keys." });
  }

  if (status === 403) {
    return pick("no_access",
      { title: "Bu modele erisim izni yok",
        detail: `Kimlik bilgileri gecerli, ancak "${model}" modeline erisiminiz bulunmuyor.`,
        action: provider === "bedrock"
          ? "AWS konsolunda Bedrock > Model access bolumunden Anthropic modelleri icin erisim talebi olusturun."
          : "Hesabinizin bu modele erisimi oldugunu dogrulayin veya baska bir model secin." },
      { title: "No access to this model",
        detail: `The credentials are valid, but you do not have access to "${model}".`,
        action: provider === "bedrock"
          ? "In the AWS console, request access to Anthropic models under Bedrock > Model access."
          : "Verify that your account has access to this model, or select a different one." });
  }

  if (status === 404) {
    return pick("model_not_found",
      { title: "Model bulunamadi",
        detail: `"${model}" adinda bir model bulunamadi.`,
        action: "Model adini kontrol edin. Onerilen: claude-sonnet-5" },
      { title: "Model not found",
        detail: `No model named "${model}" exists.`,
        action: "Check the model name. Recommended: claude-sonnet-5" });
  }

  if (status === 429) {
    return pick("rate_limited",
      { title: "Limit asildi",
        detail: "Hesabin istek limiti veya harcama limiti dolmus.",
        action: "Anthropic Console > Limits bolumunu kontrol edin veya bakiye yukleyin." },
      { title: "Rate or spend limit reached",
        detail: "The account has hit its request or spending limit.",
        action: "Check Anthropic Console > Limits, or top up your balance." });
  }

  if (status >= 500) {
    return pick("provider_down",
      { title: "Saglayici kaynakli hata",
        detail: "Yapay zeka saglayicisinda gecici bir sorun var.",
        action: "Birkac dakika sonra tekrar deneyin." },
      { title: "Provider error",
        detail: "The AI provider is having a temporary problem.",
        action: "Try again in a few minutes." });
  }

  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network|proxy/i.test(message)) {
    return pick("network",
      { title: "Aga erisilemiyor",
        detail: "Sunucu yapay zeka saglayicisina ulasamiyor. Guvenlik duvari veya proxy engelliyor olabilir.",
        action: provider === "anthropic"
          ? "IT ekibinden su adrese giden HTTPS (443) trafigini acmasini isteyin: api.anthropic.com"
          : "Bulut saglayicisinin uc noktalarina erisimi kontrol edin." },
      { title: "Cannot reach the network",
        detail: "The server cannot reach the AI provider. A firewall or proxy may be blocking it.",
        action: provider === "anthropic"
          ? "Ask your IT team to allow outbound HTTPS (443) to: api.anthropic.com"
          : "Check access to your cloud provider's endpoints." });
  }

  if (/credential|CredentialsProviderError|Could not load credentials|ADC/i.test(message)) {
    return pick("cloud_credentials",
      { title: "Bulut kimlik bilgileri bulunamadi",
        detail: "Sunucu bulut hesabina giris yapamiyor.",
        action: provider === "vertex"
          ? "Sunucuda su komutu calistirin: gcloud auth application-default login"
          : "AWS erisim anahtarlarini girin veya sunucuda 'aws configure' calistirin." },
      { title: "Cloud credentials not found",
        detail: "The server cannot authenticate to your cloud account.",
        action: provider === "vertex"
          ? "Run this on the server: gcloud auth application-default login"
          : "Enter AWS access keys, or run 'aws configure' on the server." });
  }

  return pick("unknown",
    { title: "Beklenmeyen hata", detail: message || "Bilinmeyen bir hata olustu.", action: null },
    { title: "Unexpected error", detail: message || "An unknown error occurred.", action: null });
}

/**
 * Yapilandirilmis (JSON) cikti uretir.
 *
 * TOOL USE kullanilir: modele bir sema verilir ve cevabin o semaya
 * uymasi zorunludur. `JSON.parse(serbest_metin)` gibi kirilgan bir
 * yol yok - parse hatasi riski sifir.
 */
async function generateStructured({
  system,
  prompt,
  toolName,
  schema,
  maxTokens = 2000
}) {
  // Gizlilik: son savunma hatti. Metinde kimlik bilgisi kaldiysa firlatir.
  assertClean(prompt);

  const { client, cfg } = getClient();
  const started = Date.now();

  try {
    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      tools: [{
        name: toolName,
        description: "Sonucu bu arac uzerinden yapilandirilmis olarak dondur.",
        input_schema: schema
      }],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: prompt }]
    });

    /**
     * SESSIZ HATA TUZAGI:
     * Cikti token limitine takilirsa (stop_reason = "max_tokens") model
     * cevabi YARIDA kesilir. Tool use girdisi eksik kalir, `matches`
     * dizisi hic gelmez ve uygulama "sonuc yok" sanip BOS EKRAN gosterir.
     *
     * Kullanici hicbir sey anlamaz, biz de hata gormeyiz.
     * Bu yuzden acikca yakaliyoruz.
     */
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "Yapay zekanin cevabi cikti limitine takildi ve yarida kesildi. " +
        "Mentor sayisi fazla olabilir. Sunucu yoneticisine bildirin " +
        `(operation: ${toolName}, limit: ${maxTokens} token).`
      );
    }

    const toolUse = response.content.find(
      b => b.type === "tool_use" && b.name === toolName
    );

    if (!toolUse) {
      throw new Error(
        "Yapay zeka beklenen yapilandirilmis cevabi dondurmedi. " +
        `(stop_reason: ${response.stop_reason})`
      );
    }

    audit.record({
      operation: toolName,
      provider: cfg.provider,
      model: cfg.model,
      promptSent: prompt,               // AI'a giden TAM metin - KVKK denetimi icin
      durationMs: Date.now() - started,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      ok: true
    });

    return toolUse.input;

  } catch (error) {
    audit.record({
      operation: toolName,
      provider: cfg?.provider,
      model: cfg?.model,
      promptSent: prompt,
      durationMs: Date.now() - started,
      ok: false,
      error: error.message
    });

    error.diagnosis = diagnose(error, cfg?.provider, cfg?.model);
    throw error;
  }
}

/** Gercek bir cagri atarak baglantiyi test eder. */
async function testConnection(lang = "en") {
  const cfg = settings.getAiConfig();
  const started = Date.now();

  try {
    const { client } = getClient();

    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Baglanti testi. Sadece 'TAMAM' yaz." }]
    });

    const reply = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join(" ")
      .trim();

    const durationMs = Date.now() - started;

    audit.record({
      operation: "baglanti_testi",
      provider: cfg.provider,
      model: cfg.model,
      promptSent: "(baglanti testi)",
      durationMs,
      ok: true
    });

    return {
      ok: true,
      title: lang === "tr" ? "Baglanti basarili" : "Connection successful",
      detail: lang === "tr"
        ? `${cfg.provider} / ${cfg.model} calisiyor. Model cevabi: "${reply}"`
        : `${cfg.provider} / ${cfg.model} is working. Model replied: "${reply}"`,
      provider: cfg.provider,
      model: cfg.model,
      durationMs
    };

  } catch (error) {
    audit.record({
      operation: "baglanti_testi",
      provider: cfg.provider,
      model: cfg.model,
      promptSent: "(baglanti testi)",
      durationMs: Date.now() - started,
      ok: false,
      error: error.message
    });

    return {
      ...diagnose(error, cfg.provider, cfg.model, lang),
      provider: cfg.provider,
      model: cfg.model
    };
  }
}

module.exports = { generateStructured, testConnection, resetClient, diagnose };
