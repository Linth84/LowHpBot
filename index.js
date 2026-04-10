import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionsBitField,
  EmbedBuilder,
} from "discord.js";
import "dotenv/config";
import fs from "node:fs";
import express from "express";
/* =========================================================
   SINGLE INSTANCE LOCK
========================================================= */
// BORRAR todo el bloque del lock file

process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err);
});

client.on("error", (err) => {
  console.error("Discord client error:", err);
});

console.log("✅ ENV CHECK", {
  hasToken: !!process.env.DISCORD_TOKEN,
  hasClientId: !!process.env.CLIENT_ID,
  hasGuildId: !!process.env.GUILD_ID,
  hasHomeGuildId: !!process.env.HOME_GUILD_ID,
  hasVentEs: !!process.env.VENTS_CHANNEL_ID_ES,
  hasVentEn: !!process.env.VENTS_CHANNEL_ID_EN,
  hasModlog: !!process.env.MODLOG_CHANNEL_ID,
  port: process.env.PORT,
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Login a Discord iniciado"))
  .catch((err) => {
    console.error("❌ ERROR LOGIN DISCORD:", err);
    process.exit(1);
  });

/* =========================================================
   CONFIG (.env)
========================================================= */
/* =========================================================
   CONFIG (.env)
========================================================= */
const VENTS_CHANNEL_ID_ES = process.env.VENTS_CHANNEL_ID_ES;
const VENTS_CHANNEL_ID_EN = process.env.VENTS_CHANNEL_ID_EN;
const VENT_SOFT_MIN_LEN = Number(process.env.VENT_SOFT_MIN_LEN ?? 50);
const MODLOG_CHANNEL_ID = process.env.MODLOG_CHANNEL_ID;
const HOME_GUILD_ID = process.env.HOME_GUILD_ID || process.env.GUILD_ID;

const REPORT_THRESHOLD = Number(process.env.REPORT_THRESHOLD ?? 3);
const REPLY_MIN_LEN = Number(process.env.REPLY_MIN_LEN ?? 5);
const REPLY_SOFT_MIN_LEN = Number(process.env.REPLY_SOFT_MIN_LEN ?? 20);
const VENT_MAX_LEN = Number(process.env.VENT_MAX_LEN ?? 200);
const VENT_MIN_LEN = Number(process.env.VENT_MIN_LEN ?? 10);

const AUTO_HIDE_ON_TRIGGERS =
  String(process.env.AUTO_HIDE_ON_TRIGGERS ?? "true").toLowerCase() === "true";

const REPORT_WINDOW_MIN = Number(process.env.REPORT_WINDOW_MIN ?? 60);
const REPORT_COOLDOWN_MIN = Number(process.env.REPORT_COOLDOWN_MIN ?? 10);

const REPLY_REPORT_THRESHOLD = Number(process.env.REPLY_REPORT_THRESHOLD ?? 2);

const STRIKE_LIMIT = Number(process.env.STRIKE_LIMIT ?? 3);
const STRIKE_BLOCK_MIN = Number(process.env.STRIKE_BLOCK_MIN ?? 1440);

const TRIGGER_HIGH = String(process.env.TRIGGER_HIGH ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const TRIGGER_MEDIUM = String(process.env.TRIGGER_MEDIUM ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const TRIGGER_LOW = String(process.env.TRIGGER_LOW ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const CONTACT_TRIGGER_WORDS = String(process.env.CONTACT_TRIGGER_WORDS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

console.log("TRIGGER_HIGH:", TRIGGER_HIGH);
console.log("TRIGGER_MEDIUM:", TRIGGER_MEDIUM);
console.log("TRIGGER_LOW:", TRIGGER_LOW);
console.log("CONTACT_TRIGGER_WORDS:", CONTACT_TRIGGER_WORDS);

if (!VENTS_CHANNEL_ID_ES) {
  console.error("❌ Falta VENTS_CHANNEL_ID_ES en .env");
  process.exit(1);
}
if (!VENTS_CHANNEL_ID_EN) {
  console.error("❌ Falta VENTS_CHANNEL_ID_EN en .env");
  process.exit(1);
}
if (!MODLOG_CHANNEL_ID) {
  console.warn("⚠️ Falta MODLOG_CHANNEL_ID (sin panel de moderación).");
}
if (!HOME_GUILD_ID) {
  console.warn("⚠️ Falta HOME_GUILD_ID/GUILD_ID (ban/timeout/unban HOME no funcionará).");
}

const REPORT_WINDOW_MS = REPORT_WINDOW_MIN * 60_000;
const REPORT_COOLDOWN_MS = REPORT_COOLDOWN_MIN * 60_000;
const STRIKE_BLOCK_MS = STRIKE_BLOCK_MIN * 60_000;

/* =========================================================
   BLACKLIST GLOBAL
========================================================= */
const BLOCKLIST_FILE = "./blocked_users.json";
let blockedUsers = new Map();

function loadBlocklist() {
  try {
    const raw = fs.readFileSync(BLOCKLIST_FILE, "utf8");
    const obj = JSON.parse(raw);
    blockedUsers = new Map(Object.entries(obj));
  } catch {
    blockedUsers = new Map();
  }
}
function saveBlocklist() {
  try {
    const obj = Object.fromEntries(blockedUsers);
    fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("❌ saveBlocklist failed:", e?.message ?? e);
  }
}
function isBlocked(userId) {
  const entry = blockedUsers.get(String(userId));
  if (!entry) return { blocked: false };

  const until = Number(entry.until ?? 0);
  const now = Date.now();

  if (until === 0) return { blocked: true, until: 0, reason: entry.reason ?? "" };

  if (until <= now) {
    blockedUsers.delete(String(userId));
    saveBlocklist();
    return { blocked: false };
  }

  return { blocked: true, until, reason: entry.reason ?? "" };
}
function blockUser(userId, minutes, reason = "", by = "mod") {
  const until = minutes <= 0 ? 0 : Date.now() + minutes * 60_000;
  blockedUsers.set(String(userId), { until, reason, by, at: Date.now() });
  saveBlocklist();
  return until;
}
function unblockUser(userId) {
  blockedUsers.delete(String(userId));
  saveBlocklist();
}

/* =========================================================
   ESTADOS (RAM)
========================================================= */
// userId -> { categoria, lang }
const pendingVents = new Map();

// userId -> { categoria, texto, lang }
const confirmVents = new Map();

// ventId -> { authorId, categoria, texto, lang, answered, channelId, messageId, guildId, hidden, deleted }
const vents = new Map();

// replyId -> { ventId, authorId, responderId, texto, deliveredAt, hidden, deleted, strikesApplied }
const replies = new Map();

const responderDiscipline = new Map();
const seenVents = new Map();
const currentFeedVent = new Map();
const processingVent = new Set();
const handledInteractions = new Set();
const dmCooldown = new Map();
const ventReports = new Map();
const replyReports = new Map();

/* =========================================================
   CLIENT
========================================================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("LowHP Bot alive ❤️‍🩹");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Web server activo en puerto ${PORT}`);
});

process.on("unhandledRejection", (err) => console.error("UnhandledRejection:", err));

client.once("clientReady", () => {
  console.log(`❤️‍🩹 LowHP Bot conectado como ${client.user.tag} | PID ${process.pid}`);
});

/* =========================================================
   SHUTDOWN limpio
========================================================= */
let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`❤️‍🩹 Recibí ${signal}. Cerrando LowHP Bot...`);

  const forceTimer = setTimeout(() => {
    console.log("🧯 Force exit (timeout).");
    cleanupLock();
    process.exit(0);
  }, 3000);

  try {
    await Promise.race([
      (async () => { try { await client.destroy(); } catch {} })(),
      new Promise((res) => setTimeout(res, 2500)),
    ]);
  } finally {
    clearTimeout(forceTimer);
    cleanupLock();
    process.exit(0);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));

const BOT_TEXT = {
  es: {
    published:
      "❤️‍🩹 Listo, ya lo publiqué.\n\nMientras esperás, podés ayudar a alguien más:",
    
    sentReply:
      "❤️‍🩹 Respuesta enviada. Gracias por estar.",
    
    dmSent:
      "❤️‍🩹 Te escribí por DM.",
    
    exit:
      "❤️‍🩹 Está bien. Gracias por estar acá.",
    
    hiddenReview:
      "❤️‍🩹 Vent ocultado para revisión",
    
    supportIntro:
      "❤️‍🩹 LowHP Bot",
    
    supportFollowup:
      "❤️‍🩹 Sigo acá con vos.",
    
    tagline:
      "HP bajo ≠ Game Over.",
    
    gentle:
      "No estás solo en esta partida.",
  },

  en: {
    published:
      "❤️‍🩹 Done, your vent was posted.\n\nWhile you wait, you can help someone else:",
    
    sentReply:
      "❤️‍🩹 Reply sent. Thank you for being here.",
    
    dmSent:
      "❤️‍🩹 I sent you a DM.",
    
    exit:
      "❤️‍🩹 It's okay. Thanks for being here.",
    
    hiddenReview:
      "❤️‍🩹 Vent hidden for review",
    
    supportIntro:
      "❤️‍🩹 LowHP Bot",
    
    supportFollowup:
      "❤️‍🩹 I'm still here with you.",
    
    tagline:
      "Low HP ≠ Game Over.",
    
    gentle:
      "You're not alone in this run.",
  }
};
/* =========================================================
   HELPERS
========================================================= */
function dedupeInteraction(interaction) {
  if (!interaction?.id) return false;
  if (handledInteractions.has(interaction.id)) return true;
  handledInteractions.add(interaction.id);
  setTimeout(() => handledInteractions.delete(interaction.id), 60_000);
  return false;
}

function inCooldown(userId, ms = 2500) {
  const now = Date.now();
  const last = dmCooldown.get(userId) || 0;
  if (now - last < ms) return true;
  dmCooldown.set(userId, now);
  return false;
}

async function safeDefer(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    return true;
  } catch {
    return false;
  }
}

async function safeEdit(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {}
}

function makeVentId() {
  return `v_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeReplyId() {
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ensureSeen(userId) {
  if (!seenVents.has(userId)) seenVents.set(userId, new Set());
  return seenVents.get(userId);
}

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[.,!?;:()[\]{}"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAnyTrigger(text, words) {
  if (!words?.length) return false;
  const t = normalizeText(text);
  return words.some((w) => w && t.includes(normalizeText(w)));
}

function getRiskMatch(text) {
  const t = normalizeText(text);

  // 1) listas del .env
  for (const trigger of TRIGGER_HIGH) {
    if (t.includes(normalizeText(trigger))) {
      return { level: "high", matched: trigger, source: "env" };
    }
  }

  for (const trigger of TRIGGER_MEDIUM) {
    if (t.includes(normalizeText(trigger))) {
      return { level: "medium", matched: trigger, source: "env" };
    }
  }

  for (const trigger of TRIGGER_LOW) {
    if (t.includes(normalizeText(trigger))) {
      return { level: "low", matched: trigger, source: "env" };
    }
  }

  // 2) patrones regex
  const highPatterns = [
    { regex: /\b(me quiero matar|me voy a matar|quiero matarme|me quiero suicidar|me voy a suicidar|quiero suicidarme)\b/, label: "frase suicida directa" },
    { regex: /\b(kill myself|want to die|going to kill myself|i want to die)\b/, label: "english suicidal phrase" },
    { regex: /\b(no quiero vivir|no quiero seguir|no quiero seguir viviendo|no vale la pena vivir|no tiene sentido vivir)\b/, label: "sin deseo de vivir" },
    { regex: /\b(quiero desaparecer|ojala no despertar|ojala morirme|desearia no despertar)\b/, label: "desaparicion / no despertar" },
    { regex: /\b(no aguanto vivir|no puedo seguir asi)\b/, label: "no puede seguir asi" },
  ];

  const mediumPatterns = [
    { regex: /\b(me corto|cortarme|me lastimo|lastimarme|me hago dano|autolesion|auto lesion)\b/, label: "autolesion" },
    { regex: /\b(self harm|cut myself|hurting myself)\b/, label: "self harm" },
    { regex: /\b(me abusaron|abuso sexual|violacion|violaron|rape|sexual abuse|sexual assault)\b/, label: "abuso sexual" },
    { regex: /\b(me quiero hacer dano|quiero hacerme dano)\b/, label: "dano a si mismo" },
  ];

  const lowPatterns = [
    { regex: /\b(estoy destruido|estoy destruida|me siento solo|me siento sola|me siento vacio|me siento vacia)\b/, label: "soledad / vacio" },
    { regex: /\b(no doy mas|no aguanto mas|estoy muy mal|estoy devastado|estoy devastada)\b/, label: "agotamiento emocional" },
    { regex: /\b(no tengo ganas de nada|estoy apagado|estoy apagada|no le veo sentido a nada)\b/, label: "apatia / sin ganas" },
    { regex: /\b(im overwhelmed|i feel alone|i feel hopeless|im very sad|i feel empty)\b/, label: "english emotional distress" },
  ];

  for (const p of highPatterns) {
    if (p.regex.test(t)) return { level: "high", matched: p.label, source: "regex" };
  }

  for (const p of mediumPatterns) {
    if (p.regex.test(t)) return { level: "medium", matched: p.label, source: "regex" };
  }

  for (const p of lowPatterns) {
    if (p.regex.test(t)) return { level: "low", matched: p.label, source: "regex" };
  }

  return null;
}

function containsContactTriggers(text) {
  return containsAnyTrigger(text, CONTACT_TRIGGER_WORDS);
}

function containsContactRegex(text) {
  const invite = /(discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i;
  const mention = /<@!?(\d+)>|@[\w.\-]{2,}/i;
  const discrim = /#\d{4}\b/;
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /(\+?\d[\d\s().-]{7,}\d)/;
  return invite.test(text) || mention.test(text) || discrim.test(text) || email.test(text) || phone.test(text);
}

function responderIsLocallyBlocked(userId) {
  const info = responderDiscipline.get(userId);
  if (!info) return false;
  const now = Date.now();
  return Boolean(info.blockedUntil && now < info.blockedUntil);
}

function addStrike(userId) {
  const now = Date.now();
  const info = responderDiscipline.get(userId) || { strikes: 0, blockedUntil: 0 };
  info.strikes += 1;
  if (info.strikes >= STRIKE_LIMIT) info.blockedUntil = now + STRIKE_BLOCK_MS;
  responderDiscipline.set(userId, info);
  return info;
}

function getNextVentForHelper(userId) {
  const seen = ensureSeen(userId);
  for (const [ventId, vent] of vents.entries()) {
    if (vent.authorId === userId) continue;
    if (vent.answered) continue;
    if (vent.hidden) continue;
    if (vent.deleted) continue;
    if (seen.has(ventId)) continue;
    return { ventId, vent };
  }
  return null;
}

async function fetchVentsChannel(lang = "es") {
  const channelId = lang === "en" ? VENTS_CHANNEL_ID_EN : VENTS_CHANNEL_ID_ES;
  const ch = await client.channels.fetch(channelId);
  if (!ch?.isTextBased()) throw new Error("Canal de vents no es un canal de texto válido");
  return ch;
}

async function fetchModlogChannel() {
  if (!MODLOG_CHANNEL_ID) throw new Error("Falta MODLOG_CHANNEL_ID");
  const ch = await client.channels.fetch(MODLOG_CHANNEL_ID);
  if (!ch?.isTextBased()) throw new Error("MODLOG_CHANNEL_ID no es un canal de texto válido");
  return ch;
}

function formatUntil(ts) {
  if (!ts || ts === 0) return "PERMANENTE";
  return new Date(ts).toLocaleString();
}

function ensureReport(map, id) {
  let rep = map.get(id);
  if (!rep) {
    rep = { reporters: new Map(), reasons: [], autoFlagged: false };
    map.set(id, rep);
  }
  return rep;
}

function pruneOldReports(rep) {
  const now = Date.now();
  for (const [uid, ts] of rep.reporters.entries()) {
    if (now - ts > REPORT_WINDOW_MS) rep.reporters.delete(uid);
  }
  rep.reasons = rep.reasons.filter((r) => now - r.at <= REPORT_WINDOW_MS).slice(-20);
}

function reportsCountRecent(rep) {
  pruneOldReports(rep);
  return rep.reporters.size + (rep.autoFlagged ? 1 : 0);
}

function t(lang, es, en) {
  return lang === "en" ? en : es;
}
/* =========================================================
   UI BUILDERS
========================================================= */
function buildCategoryRow(lang = "es") {
  if (lang === "en") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cat_relationships").setLabel("💔 Relationships").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("cat_friendships").setLabel("🫂 Friendships").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("cat_work").setLabel("💼 Work").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("cat_studies").setLabel("🎓 Studies").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("cat_other_en").setLabel("❓ Other").setStyle(ButtonStyle.Secondary),
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cat_pareja").setLabel("💔 Pareja").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("cat_amistades").setLabel("🫂 Amistades").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("cat_trabajo").setLabel("💼 Trabajo").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("cat_estudios").setLabel("🎓 Estudios").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("cat_otro").setLabel("❓ Otro").setStyle(ButtonStyle.Secondary),
  );
}

function buildConfirmRow(userId, lang = "es") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`publish:${userId}`)
      .setLabel(lang === "en" ? "✅ Publish" : "✅ Publicar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`edit:${userId}`)
      .setLabel(lang === "en" ? "✏️ Edit" : "✏️ Editar")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cancel:${userId}`)
      .setLabel(lang === "en" ? "❌ Cancel" : "❌ Cancelar")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildPostRow(ventId, lang = "es") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reply:${ventId}`)
      .setLabel(lang === "en" ? "🫂 Reply" : "🫂 Responder")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`flag:${ventId}`)
      .setLabel(lang === "en" ? "🚩 Report" : "🚩 Denunciar")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildAfterPublishRow(lang = "es") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("help_first")
      .setLabel(lang === "en" ? "🫂 Help others" : "🫂 Ayudar a otros")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("exit")
      .setLabel(lang === "en" ? "Exit" : "Salir")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildFeedRow(ventId, lang = "es") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reply:${ventId}`)
      .setLabel(lang === "en" ? "🫂 Reply" : "🫂 Responder")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("help")
      .setLabel(lang === "en" ? "⏭️ Next" : "⏭️ Siguiente")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("exit")
      .setLabel(lang === "en" ? "Exit" : "Salir")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildReplyReportRow(replyId, lang = "es") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`flag_reply:${replyId}`)
      .setLabel(lang === "en" ? "🚩 Report reply" : "🚩 Denunciar respuesta")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildModVentContentRow(ventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_restore:${ventId}`).setLabel("✅ Restaurar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mod_delete:${ventId}`).setLabel("🗑️ Borrar").setStyle(ButtonStyle.Danger),
  );
}

function buildModReplyContentRow(replyId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_reply_ok:${replyId}`).setLabel("✅ OK").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mod_reply_action:${replyId}`).setLabel("🗑️ Acción (Strike)").setStyle(ButtonStyle.Danger),
  );
}

function buildModUserRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_timeout1h:${userId}`).setLabel("🔇 Timeout 1h").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_timeout24h:${userId}`).setLabel("🔇 Timeout 24h").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_ban:${userId}`).setLabel("🔨 Ban (HOME)").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mod_unban:${userId}`).setLabel("🟢 Unban (HOME)").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mod_block7d:${userId}`).setLabel("⛔ Block 7d").setStyle(ButtonStyle.Danger),
  );
}
function buildModUserRow2(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_blockperm:${userId}`).setLabel("⛔ Block PERM").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mod_unblock:${userId}`).setLabel("✅ Unblock (LowHP Bot)").setStyle(ButtonStyle.Success),
  );
}

function disableRows(rows = []) {
  return rows.map((row) => {
    const newRow = new ActionRowBuilder();
    for (const c of row.components) {
      newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
    }
    return newRow;
  });
}

/* =========================================================
   MOD / MODLOG HELPERS
========================================================= */
function isMod(interaction) {
  if (!interaction.inGuild?.()) return false;
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return perms.has(PermissionsBitField.Flags.ManageMessages) || perms.has(PermissionsBitField.Flags.Administrator);
}

async function logToModlog(content, components = [], embedData = null) {
  if (!MODLOG_CHANNEL_ID) return;

  try {
    const modlog = await fetchModlogChannel();

    // 👉 NUEVO: soporte para embed
    if (embedData) {
      const embed = new EmbedBuilder()
        .setTitle(embedData.title || "LowHP Bot Modlog")
        .setDescription(embedData.description || "")
        .setFooter({ text: embedData.footer || "LowHP Bot" })
        .setTimestamp();

      if (embedData.color) embed.setColor(embedData.color);
      if (embedData.fields?.length) embed.addFields(embedData.fields);

      await modlog.send({
        content: content || undefined,
        embeds: [embed],
        components,
      });
      return;
    }

    // 👉 comportamiento viejo (no rompe nada)
    await modlog.send({ content, components });
  } catch (e) {
    console.error("❌ modlog send failed:", e?.code, e?.message ?? e);
  }
}

function jumpLink(vent) {
  if (!vent?.guildId || !vent?.channelId || !vent?.messageId) return "(sin link)";
  return `https://discord.com/channels/${vent.guildId}/${vent.channelId}/${vent.messageId}`;
}

async function getHomeGuild() {
  if (!HOME_GUILD_ID) throw new Error("HOME_GUILD_ID no configurado");
  const g = await client.guilds.fetch(HOME_GUILD_ID);
  if (!g) throw new Error("No pude fetch HOME guild");
  return g;
}
async function timeoutInHome(userId, ms, reason = "LowHP Bot moderation") {
  const g = await getHomeGuild();
  const member = await g.members.fetch(userId);
  await member.timeout(ms, reason);
}
async function banInHome(userId, reason = "LowHP Bot moderation") {
  const g = await getHomeGuild();
  await g.members.ban(userId, { reason });
}
async function unbanInHome(userId, reason = "LowHP Bot unban") {
  const g = await getHomeGuild();
  await g.bans.remove(userId, reason);
}

const lastSupportDM = new Map();
const lastSupportFollowupDM = new Map();


async function sendHighRiskSupportDM(userId, lang = "es") {
  const now = Date.now();
  const last = lastSupportDM.get(userId) || 0;
  const lastFollowup = lastSupportFollowupDM.get(userId) || 0;

  try {
    const user = await client.users.fetch(userId);

    // Si ya recibió el DM completo hace menos de 10 min,
    // mandar como máximo un follow-up breve cada 3 min
    if (now - last < 10 * 60 * 1000) {
      if (now - lastFollowup < 3 * 60 * 1000) return;

      lastSupportFollowupDM.set(userId, now);

      const followup =
        lang === "en"
          ? "❤️‍🩹 I'm still here with you.\n\nIf this is getting worse or you feel in immediate danger, please reach out to emergency services, a crisis hotline, or someone you trust right now.\n\n💙 You can also check **#help-lines**."
          : "❤️‍🩹 Sigo acá con vos.\n\nSi esto empeora o sentís peligro inmediato, por favor contactá a emergencias, una línea de ayuda o a alguien de confianza ahora mismo.\n\n💙 También podés revisar **#lineas-de-ayuda**.";

      await user.send({ content: followup });
      return;
    }

    // Primer DM completo
    lastSupportDM.set(userId, now);

    let content;

    if (lang === "en") {
      const mensajesEN = [
        "You're not alone in this. Even if it feels overwhelming right now, things can change.",
        "What you're feeling matters. You don't have to go through this alone.",
        "Even if it feels heavy right now, this moment can pass and things can improve."
      ];

      const mensajeRandom = mensajesEN[Math.floor(Math.random() * mensajesEN.length)];

      content =
        "❤️‍🩹 I'm really sorry you're going through this.\n\n" +
        mensajeRandom +
        "\n\nIf you feel like you might be in danger, please contact emergency services or a crisis hotline.\n\nIf you can, try reaching out to someone you trust.\n\n💙 Check **#help-lines** for support resources.";
    } else {
      const mensajesES = [
        "No estás solo en esto. Aunque ahora se sienta muy pesado, esto puede cambiar.",
        "Lo que estás sintiendo importa. No tenés que atravesarlo solo.",
        "Aunque ahora parezca difícil, este momento puede pasar y las cosas pueden mejorar."
      ];

      const mensajeRandom = mensajesES[Math.floor(Math.random() * mensajesES.length)];

      content =
        "❤️‍🩹 Siento mucho que estés pasando por esto.\n\n" +
        mensajeRandom +
        "\n\nSi sentís que corrés peligro, por favor contactá a emergencias o una línea de ayuda.\n\nSi podés, tratá de hablar con alguien de confianza.\n\n💙 Revisá **#lineas-de-ayuda** para recursos disponibles.";
    }

    await user.send({ content });
  } catch (e) {
    console.error("❌ high risk support DM failed:", e?.code, e?.message ?? e);
  }
}

/* =========================================================
   VENT MOD ACTIONS
========================================================= */
async function restoreVent(ventId) {
  const vent = vents.get(ventId);
  if (!vent || vent.deleted) return { ok: false, msg: "Vent inexistente o eliminado." };

  try {
    const ch = await client.channels.fetch(vent.channelId);
    if (!ch?.isTextBased()) throw new Error("Canal inválido");
    const msg = await ch.messages.fetch(vent.messageId);

    await msg.edit({
      content:
        `${t(vent.lang, "❤️‍🩹 **Vent**", "❤️‍🩹 **Vent**")}\n` +
        `${t(vent.lang, "**Categoría:**", "**Category:**")} ${vent.categoria}\n\n` +
        `“${vent.texto}”`,
      components: [buildPostRow(ventId, vent.lang)],
    });

    vent.hidden = false;
    return { ok: true, msg: "✅ Restaurado." };
  } catch (e) {
    console.error("❌ restoreVent failed:", e?.code, e?.message ?? e);
    return { ok: false, msg: "⚠️ No pude restaurar (no encontrado/permisos)." };
  }
}

async function deleteVent(ventId) {
  const vent = vents.get(ventId);
  if (!vent || vent.deleted) return { ok: false, msg: "Vent inexistente o ya eliminado." };

  try {
    const ch = await client.channels.fetch(vent.channelId);
    if (!ch?.isTextBased()) throw new Error("Canal inválido");
    const msg = await ch.messages.fetch(vent.messageId);

    await msg.delete();

    vent.deleted = true;
    vent.hidden = true;
    return { ok: true, msg: "🗑️ Borrado." };
  } catch (e) {
    console.error("❌ deleteVent failed:", e?.code, e?.message ?? e);
    return { ok: false, msg: "⚠️ No pude borrar (no encontrado/permisos)." };
  }
}

async function hideVentForReview(ventId, by = "system", riskMatch = null) {
  const vent = vents.get(ventId);
  if (!vent || vent.hidden || vent.deleted) return;

  vent.hidden = true;

  try {
    const ch = await client.channels.fetch(vent.channelId);
    if (ch?.isTextBased()) {
      const msg = await ch.messages.fetch(vent.messageId);
      await msg.edit({
        content: t(
          vent.lang,
          "❤️‍🩹 **Vent oculto para revisión**\n\nEste contenido fue ocultado temporalmente mientras el equipo lo revisa.",
          "❤️‍🩹 **Vent hidden for review**\n\nThis content was temporarily hidden while the team reviews it."
        ),
        components: [],
      });
    }
  } catch (e) {
    console.error("❌ hideVent edit failed:", e?.code, e?.message ?? e);
  }

  const rep = ensureReport(ventReports, ventId);

  await logToModlog(
    null,
    [buildModVentContentRow(ventId), buildModUserRow(vent.authorId), buildModUserRow2(vent.authorId)],
    {
      title: "🫥 Vent ocultado para revisión",
      color: by.includes("contacto")
        ? 0x8b0000
        : by.includes("high")
        ? 0xff0000
        : by.includes("medium")
        ? 0xffa500
        : 0xffff00,
      description: `“${vent.texto}”`,
      fields: [
  { name: "Vent ID", value: ventId, inline: true },
  { name: "Autor", value: `<@${vent.authorId}> (${vent.authorId})`, inline: false },
  { name: "Motivo", value: by, inline: true },
  { name: "Matched", value: riskMatch?.matched ?? "none", inline: true },
  { name: "Source", value: riskMatch?.source ?? "none", inline: true },
  { name: "Idioma", value: vent.lang, inline: true },
  { name: "Categoría", value: vent.categoria, inline: true },
  { name: "Denuncias", value: `${reportsCountRecent(rep)}/${REPORT_THRESHOLD}`, inline: true },
  { name: "Link", value: jumpLink(vent), inline: false },
],
      footer: "LowHP Bot • Moderación automática",
    }
  );
}

/* =========================================================
   REPLY MOD ACTIONS
========================================================= */
async function modReplyOk(replyId) {
  const r = replies.get(replyId);
  if (!r) return { ok: false, msg: "Reply inexistente." };
  return { ok: true, msg: "✅ Marcado OK." };
}

async function modReplyAction(replyId) {
  const r = replies.get(replyId);
  if (!r) return { ok: false, msg: "Reply inexistente." };

  if (!r.strikesApplied) {
    const info = addStrike(r.responderId);
    r.strikesApplied = true;

    let globalMsg = "";
    if (info.strikes >= STRIKE_LIMIT) {
      const until = blockUser(r.responderId, 60 * 24 * 7, "STRIKE_LIMIT alcanzado", "mod");
      globalMsg = ` | ⛔ Blacklist global hasta: ${formatUntil(until)}`;
    }

    const blockedLocal = info.blockedUntil && Date.now() < info.blockedUntil;
    return {
      ok: true,
      msg: blockedLocal
        ? `🗑️ Acción registrada. Strikes: ${info.strikes}/${STRIKE_LIMIT} | bloqueo local hasta ${formatUntil(info.blockedUntil)}${globalMsg}`
        : `🗑️ Acción registrada. Strikes: ${info.strikes}/${STRIKE_LIMIT}${globalMsg}`,
    };
  }

  return { ok: true, msg: "🗑️ Acción ya aplicada antes." };
}

async function logReplyToModlog({ title, replyId, ventId, replyText, reasonLine }) {
  const r = replies.get(replyId);
  const v = vents.get(ventId);

  const responderLine = r ? `**responder real:** <@${r.responderId}> (${r.responderId})` : "**responder real:** (desconocido)";
  const authorLine = r ? `**autor del vent:** <@${r.authorId}> (${r.authorId})` : "**autor del vent:** (desconocido)";
  const ventLink = v ? jumpLink(v) : "(sin link)";

  await logToModlog(
    `${title}\n` +
    `**replyId:** ${replyId}\n` +
    `**ventId:** ${ventId}\n` +
    `${responderLine}\n` +
    `${authorLine}\n` +
    `**Vent link:** ${ventLink}\n` +
    (v ? `**lang:** ${v.lang}\n` : "") +
    (reasonLine ? `${reasonLine}\n` : "") +
    `\n“${replyText}”`,
    r ? [buildModReplyContentRow(replyId), buildModUserRow(r.responderId), buildModUserRow2(r.responderId)] : [buildModReplyContentRow(replyId)]
  );
}

/* =========================================================
   INTERACTIONS
========================================================= */
client.on("interactionCreate", async (interaction) => {
  /* ---------- SLASH /ventilar + /vent ---------- */
  if (
    interaction.isChatInputCommand() &&
    (interaction.commandName === "ventilar" || interaction.commandName === "vent")
  ) {
    if (dedupeInteraction(interaction)) return;

    const lang = interaction.commandName === "vent" ? "en" : "es";

    const b = isBlocked(interaction.user.id);
    if (b.blocked) {
      const msg =
        b.until === 0
          ? t(lang,
              "❤️‍🩹 No podés usar LowHP Bot (bloqueo global de moderación).",
              "❤️‍🩹 You can't use LowHP Bot right now (global moderation block).")
          : t(lang,
              `❤️‍🩹 No podés usar LowHP Bot hasta ${formatUntil(b.until)}.`,
              `❤️‍🩹 You can't use LowHP Bot until ${formatUntil(b.until)}.`);
      try {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      } catch {}
      return;
    }

    if (inCooldown(interaction.user.id)) {
      try {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Ya te escribí por DM.", "❤️‍🩹 I already sent you a DM."),
          flags: MessageFlags.Ephemeral,
        });
      } catch {}
      return;
    }

    const ok = await safeDefer(interaction);

    try {
      await interaction.user.send({
        content: t(
          lang,
          `❤️‍🩹 **LowHP Bot está acá para escucharte.**\n\nElegí la categoría (máx ${VENT_MAX_LEN} caracteres).`,
          `❤️‍🩹 **LowHP Bot is here to listen.**\n\nChoose a category (max ${VENT_MAX_LEN} characters).`
        ),
        components: [buildCategoryRow(lang)],
      });

      if (ok) {
        await safeEdit(interaction, BOT_TEXT[lang].dmSent);
      }
    } catch (e) {
      console.error("❌ DM failed:", e?.code, e?.message ?? e);
      if (ok) {
        await safeEdit(
          interaction,
          t(lang, "No pude enviarte DM 😕 (revisá tu privacidad)", "I couldn't send you a DM 😕 (check your privacy settings)")
        );
      }
    }
    return;
  }

  /* ---------- BUTTONS ---------- */
  if (interaction.isButton()) {
    const id = interaction.customId;

    /* ---------- MODALS FIRST ---------- */

    if (id.startsWith("reply:")) {
      const ventId = id.split(":")[1];
      const vent = vents.get(ventId);
      const lang = vent?.lang || "es";

      if (!vent || vent.hidden || vent.deleted) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Este vent no está disponible.", "❤️‍🩹 This vent is not available."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      const b = isBlocked(interaction.user.id);
      if (b.blocked) {
        await interaction.reply({
          content:
            b.until === 0
              ? t(lang, "❤️‍🩹 No podés responder (bloqueo global de moderación).", "❤️‍🩹 You can't reply right now (global moderation block).")
              : t(lang, `❤️‍🩹 No podés responder hasta ${formatUntil(b.until)}.`, `❤️‍🩹 You can't reply until ${formatUntil(b.until)}.`),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      if (responderIsLocallyBlocked(interaction.user.id)) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Por ahora no podés responder (bloqueo local por moderación).", "❤️‍🩹 You can't reply for now (local moderation block)."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`replymodal:${ventId}`)
        .setTitle(lang === "en" ? "Reply" : "Responder");

      const input = new TextInputBuilder()
        .setCustomId("text")
        .setLabel(lang === "en" ? "Your reply (no contact details)" : "Tu respuesta (sin datos de contacto)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(800);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      try {
        await interaction.showModal(modal);
      } catch (e) {
        console.error("❌ showModal reply failed:", e?.code, e?.message ?? e);
        await interaction.reply({
          content: t(lang, "😕 No pude abrir el formulario. Probá de nuevo.", "😕 I couldn't open the form. Please try again."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
      return;
    }

    if (id.startsWith("flag:")) {
      const ventId = id.split(":")[1];
      const vent = vents.get(ventId);
      const lang = vent?.lang || "es";

      if (!vent || vent.deleted) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Este vent ya no está disponible.", "❤️‍🩹 This vent is no longer available."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }
      if (vent.authorId === interaction.user.id) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 No podés denunciar tu propio vent.", "❤️‍🩹 You can't report your own vent."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      const rep = ensureReport(ventReports, ventId);
      pruneOldReports(rep);

      const last = rep.reporters.get(interaction.user.id);
      if (last && (Date.now() - last) < REPORT_COOLDOWN_MS) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Ya denunciaste esto hace poco. Gracias.", "❤️‍🩹 You already reported this recently. Thank you."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }
      if (rep.reporters.has(interaction.user.id)) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Ya denunciaste este vent. Gracias.", "❤️‍🩹 You already reported this vent. Thank you."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`flagmodal:${ventId}`)
        .setTitle(lang === "en" ? "Report" : "Denunciar");

      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel(lang === "en" ? "Why are you reporting this?" : "¿Por qué lo denunciás?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(400);

      modal.addComponents(new ActionRowBuilder().addComponents(reason));

      try {
        await interaction.showModal(modal);
      } catch (e) {
        console.error("❌ showModal flag failed:", e?.code, e?.message ?? e);
        await interaction.reply({
          content: t(lang, "😕 No pude abrir el formulario. Probá de nuevo.", "😕 I couldn't open the form. Please try again."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
      return;
    }

    if (id.startsWith("flag_reply:")) {
      const replyId = id.split(":")[1];
      const r = replies.get(replyId);
      const vent = r ? vents.get(r.ventId) : null;
      const lang = vent?.lang || "es";

      if (!r) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Esa respuesta ya no está disponible.", "❤️‍🩹 That reply is no longer available."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }
      if (interaction.user.id !== r.authorId) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Este botón no es para vos.", "❤️‍🩹 This button isn't for you."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      const rep = ensureReport(replyReports, replyId);
      pruneOldReports(rep);

      if (rep.reporters.has(interaction.user.id)) {
        await interaction.reply({
          content: t(lang, "❤️‍🩹 Ya denunciaste esta respuesta. Gracias.", "❤️‍🩹 You already reported this reply. Thank you."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`flagreplymodal:${replyId}`)
        .setTitle(lang === "en" ? "Report reply" : "Denunciar respuesta");

      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel(lang === "en" ? "What is abusive/problematic about it?" : "¿Qué tiene de abusivo / problemático?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(400);

      modal.addComponents(new ActionRowBuilder().addComponents(reason));

      try {
        await interaction.showModal(modal);
      } catch (e) {
        console.error("❌ showModal flag_reply failed:", e?.code, e?.message ?? e);
        await interaction.reply({
          content: t(lang, "😕 No pude abrir el formulario. Probá de nuevo.", "😕 I couldn't open the form. Please try again."),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
      return;
    }

    /* ---------- RESTO ---------- */
    const ok = await safeDefer(interaction);
    const isInModlog = MODLOG_CHANNEL_ID && interaction.channelId === MODLOG_CHANNEL_ID;

    if (
      id.startsWith("mod_timeout1h:") ||
      id.startsWith("mod_timeout24h:") ||
      id.startsWith("mod_ban:") ||
      id.startsWith("mod_unban:") ||
      id.startsWith("mod_block7d:") ||
      id.startsWith("mod_blockperm:") ||
      id.startsWith("mod_unblock:")
    ) {
      if (!isInModlog) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 Moderación solo en #lowhpbot-modlog.");
        return;
      }
      if (!isMod(interaction)) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 No tenés permisos de moderación.");
        return;
      }

      const [action, userId] = id.split(":");

      try {
        if (action === "mod_timeout1h") {
          await timeoutInHome(userId, 60 * 60_000, "LowHP Bot: timeout 1h");
          if (ok) await safeEdit(interaction, `🔇 Timeout 1h aplicado a <@${userId}> (${userId}) (HOME).`);
        } else if (action === "mod_timeout24h") {
          await timeoutInHome(userId, 24 * 60 * 60_000, "LowHP Bot: timeout 24h");
          if (ok) await safeEdit(interaction, `🔇 Timeout 24h aplicado a <@${userId}> (${userId}) (HOME).`);
        } else if (action === "mod_ban") {
          await banInHome(userId, "LowHP Bot: ban");
          if (ok) await safeEdit(interaction, `🔨 Ban aplicado a <@${userId}> (${userId}) (HOME).`);
        } else if (action === "mod_unban") {
          await unbanInHome(userId, "LowHP Bot: unban");
          if (ok) await safeEdit(interaction, `🟢 Unban aplicado a (${userId}) (HOME).`);
        } else if (action === "mod_block7d") {
          const until = blockUser(userId, 60 * 24 * 7, "Blacklist 7d", interaction.user.id);
          if (ok) await safeEdit(interaction, `⛔ Blacklist global 7d para <@${userId}> (${userId}) hasta ${formatUntil(until)}.`);
        } else if (action === "mod_blockperm") {
          blockUser(userId, 0, "Blacklist permanente", interaction.user.id);
          if (ok) await safeEdit(interaction, `⛔ Blacklist global PERMANENTE para <@${userId}> (${userId}).`);
        } else if (action === "mod_unblock") {
          unblockUser(userId);
          if (ok) await safeEdit(interaction, `✅ Unblock global (LowHP Bot) para <@${userId}> (${userId}).`);
        }
      } catch (e) {
        console.error("❌ mod user action failed:", e?.code, e?.message ?? e);
        if (ok) await safeEdit(interaction, "⚠️ No pude ejecutar esa acción (permisos / usuario no está en HOME / config).");
      }
      return;
    }

    if (id.startsWith("mod_restore:") || id.startsWith("mod_delete:")) {
      if (!isInModlog) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 Moderación solo en #lowhpbot-modlog.");
        return;
      }
      if (!isMod(interaction)) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 No tenés permisos de moderación.");
        return;
      }

      const [action, ventId] = id.split(":");
      const result = action === "mod_restore" ? await restoreVent(ventId) : await deleteVent(ventId);
      if (ok) await safeEdit(interaction, result.msg);

      try {
        await interaction.message.edit({ components: disableRows(interaction.message.components || []) }).catch(() => {});
      } catch {}
      return;
    }

    if (id.startsWith("mod_reply_ok:") || id.startsWith("mod_reply_action:")) {
      if (!isInModlog) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 Moderación solo en #lowhpbot-modlog.");
        return;
      }
      if (!isMod(interaction)) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 No tenés permisos de moderación.");
        return;
      }

      const [action, replyId] = id.split(":");
      const result = action === "mod_reply_ok" ? await modReplyOk(replyId) : await modReplyAction(replyId);
      if (ok) await safeEdit(interaction, result.msg);

      try {
        await interaction.message.edit({ components: disableRows(interaction.message.components || []) }).catch(() => {});
      } catch {}
      return;
    }

    const cats = {
      cat_pareja: { categoria: "Pareja", lang: "es" },
      cat_amistades: { categoria: "Amistades", lang: "es" },
      cat_trabajo: { categoria: "Trabajo", lang: "es" },
      cat_estudios: { categoria: "Estudios", lang: "es" },
      cat_otro: { categoria: "Otro", lang: "es" },

      cat_relationships: { categoria: "Relationships", lang: "en" },
      cat_friendships: { categoria: "Friendships", lang: "en" },
      cat_work: { categoria: "Work", lang: "en" },
      cat_studies: { categoria: "Studies", lang: "en" },
      cat_other_en: { categoria: "Other", lang: "en" },
    };

    if (cats[id]) {
      pendingVents.set(interaction.user.id, {
        categoria: cats[id].categoria,
        lang: cats[id].lang,
      });

      if (ok) {
        await safeEdit(
          interaction,
          t(
            cats[id].lang,
            `❤️‍🩹 **Categoría:** ${cats[id].categoria}\n\nAhora escribí tu vent (máx ${VENT_MAX_LEN} caracteres).`,
            `❤️‍🩹 **Category:** ${cats[id].categoria}\n\nNow write your vent (max ${VENT_MAX_LEN} characters).`
          )
        );
      }
      return;
    }

    if (id.startsWith("publish:") || id.startsWith("edit:") || id.startsWith("cancel:")) {
      const [action, uid] = id.split(":");

      if (interaction.user.id !== uid) {
        if (ok) await safeEdit(interaction, "❤️‍🩹 Estos botones no son para vos.");
        return;
      }

      const data = confirmVents.get(uid);
      const lang = data?.lang || "es";

      if (!data) {
        if (ok) await safeEdit(interaction, t(lang, "No hay un vent pendiente. Usá /ventilar.", "There is no pending vent. Use /vent."));
        return;
      }

      if (action === "edit") {
        confirmVents.delete(uid);
        pendingVents.set(uid, { categoria: data.categoria, lang: data.lang });
        if (ok) {
          await safeEdit(interaction, t(lang, `✏️ Ok. Reescribí tu vent (máx ${VENT_MAX_LEN} caracteres).`, `✏️ Okay. Rewrite your vent (max ${VENT_MAX_LEN} characters).`));
        }
        return;
      }

      if (action === "cancel") {
        confirmVents.delete(uid);
        if (ok) await safeEdit(interaction, t(lang, "❌ Cancelado. No se publicó nada.", "❌ Cancelled. Nothing was posted."));
        return;
      }

      if (action === "publish") {
        let channel;
        try {
          channel = await fetchVentsChannel(data.lang || "es");
        } catch (e) {
          console.error("❌ fetch vents channel failed:", e?.message ?? e);
          if (ok) {
            await safeEdit(
              interaction,
              t(lang, "⚠️ No pude acceder al canal de vents (ID/permisos).", "⚠️ I couldn't access the vents channel (ID/permissions).")
            );
          }
          return;
        }

        const ventId = makeVentId();
        let sent;

        try {
          sent = await channel.send({
            content:
              `${t(lang, "❤️‍🩹 **Vent**", "❤️‍🩹 **Vent**")}\n` +
              `${t(lang, "**Categoría:**", "**Category:**")} ${data.categoria}\n\n` +
              `“${data.texto}”`,
            components: [buildPostRow(ventId, data.lang)],
          });
        } catch (e) {
          console.error("❌ send vent failed:", e?.code, e?.message ?? e);
          if (ok) {
            await safeEdit(
              interaction,
              t(lang, "⚠️ No pude publicar en el canal de vents (permisos).", "⚠️ I couldn't post in the vents channel (permissions).")
            );
          }
          return;
        }

        vents.set(ventId, {
          authorId: uid,
          categoria: data.categoria,
          texto: data.texto,
          lang: data.lang,
          answered: false,
          channelId: sent.channelId,
          messageId: sent.id,
          guildId: sent.guildId ?? interaction.guildId ?? null,
          hidden: false,
          deleted: false,
        });

        confirmVents.delete(uid);
const riskMatch = getRiskMatch(data.texto);
const riskLevel = riskMatch?.level ?? null;
const hasContactTrigger = containsContactTriggers(data.texto);

if (riskLevel || hasContactTrigger) {
  const rep = ensureReport(ventReports, ventId);
  rep.autoFlagged = true;

  const reason = hasContactTrigger
    ? "trigger contacto (auto)"
    : `trigger riesgo ${riskLevel} (auto)`;

  rep.reasons.push({
    at: Date.now(),
    reason,
    via: "auto",
  });

  const shouldHide =
    hasContactTrigger || (AUTO_HIDE_ON_TRIGGERS && riskLevel === "high");

if (shouldHide) {
 await hideVentForReview(
  ventId,
  hasContactTrigger ? "trigger contacto" : `trigger riesgo ${riskLevel}`,
  riskMatch
);

  if (riskLevel === "high") {
    sendHighRiskSupportDM(uid, data.lang).catch((e) =>
      console.error("❌ support DM failed:", e?.code, e?.message ?? e)
    );
  }
} else {
    await logToModlog(
      null,
      [buildModVentContentRow(ventId), buildModUserRow(uid), buildModUserRow2(uid)],
      {
        title: "⚠️ Trigger detectado — vent",
        color:
          hasContactTrigger
            ? 0x8b0000
            : riskLevel === "high"
            ? 0xff0000
            : riskLevel === "medium"
            ? 0xffa500
            : 0xffff00,
        description: `“${data.texto}”`,
fields: [
  { name: "Vent ID", value: ventId, inline: true },
  { name: "Autor", value: `<@${uid}> (${uid})`, inline: false },
  { name: "Risk level", value: riskLevel ?? "none", inline: true },
  { name: "Matched", value: riskMatch?.matched ?? "none", inline: true },
  { name: "Source", value: riskMatch?.source ?? "none", inline: true },
  { name: "Idioma", value: data.lang, inline: true },
  { name: "Categoría", value: data.categoria, inline: true },
  { name: "Auto-hide", value: "no", inline: true },
  { name: "Link", value: jumpLink(vents.get(ventId)), inline: false },
],
        footer: "LowHP Bot • Moderación automática",
      }
    );
  }
}


       if (ok) {
  await interaction.editReply({
    content: BOT_TEXT[data.lang].published,
    components: [buildAfterPublishRow(data.lang)],
  }).catch(() => {});
}
        return;
      }
    }

    if (id === "help_first") {
      currentFeedVent.delete(interaction.user.id);

      const next = getNextVentForHelper(interaction.user.id);
      const lang = next?.vent?.lang || "es";

      if (!next) {
        if (ok) {
          await interaction.editReply({
            content: t(lang, "Por ahora no hay vents para ayudar. Probá más tarde ❤️‍🩹", "There are no vents to help with right now. Try again later ❤️‍🩹"),
            components: []
          }).catch(() => {});
        }
        return;
      }

      currentFeedVent.set(interaction.user.id, next.ventId);

      if (ok) {
        await interaction.editReply({
          content:
            t(lang, "❤️‍🩹 **Alguien compartió esto:**\n\n", "❤️‍🩹 **Someone shared this:**\n\n") +
            `${t(lang, "**Categoría:**", "**Category:**")} ${next.vent.categoria}\n` +
            `“${next.vent.texto}”`,
          components: [buildFeedRow(next.ventId, next.vent.lang)],
        }).catch(() => {});
      }
      return;
    }

    if (id === "help") {
      const current = currentFeedVent.get(interaction.user.id);
      if (current) ensureSeen(interaction.user.id).add(current);

      const next = getNextVentForHelper(interaction.user.id);
      const lang = next?.vent?.lang || "es";

      if (!next) {
        currentFeedVent.delete(interaction.user.id);
        if (ok) {
          await interaction.editReply({
            content: t(lang, "❤️‍🩹 No hay más vents disponibles por ahora.", "❤️‍🩹 There are no more vents available right now."),
            components: []
          }).catch(() => {});
        }
        return;
      }

      currentFeedVent.set(interaction.user.id, next.ventId);

      if (ok) {
        await interaction.editReply({
          content:
            t(lang, "❤️‍🩹 **Alguien compartió esto:**\n\n", "❤️‍🩹 **Someone shared this:**\n\n") +
            `${t(lang, "**Categoría:**", "**Category:**")} ${next.vent.categoria}\n` +
            `“${next.vent.texto}”`,
          components: [buildFeedRow(next.ventId, next.vent.lang)],
        }).catch(() => {});
      }
      return;
    }

if (id === "exit") {
  const currentVentId = currentFeedVent.get(interaction.user.id);
  const lang = currentVentId && vents.get(currentVentId)?.lang ? vents.get(currentVentId).lang : "es";
  currentFeedVent.delete(interaction.user.id);
  if (ok) await interaction.editReply({ content: BOT_TEXT[lang].exit, components: [] }).catch(() => {});
  return;
}

    if (ok) await safeEdit(interaction, "❤️‍🩹 Acción no reconocida.");
    return;
  }


/* ---------- MODAL SUBMIT ---------- */
if (interaction.isModalSubmit()) {

  /* ===== RESPONDER VENT ===== */
  if (interaction.customId.startsWith("replymodal:")) {
    const ventId = interaction.customId.split(":")[1];
    const vent = vents.get(ventId);
    const lang = vent?.lang || "es";

    const ok = await safeDefer(interaction);

    if (!vent || vent.hidden || vent.deleted) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Este vent no está disponible.", "❤️‍🩹 This vent is not available."));
      return;
    }

    const b = isBlocked(interaction.user.id);
    if (b.blocked) {
      if (ok) {
        await safeEdit(
          interaction,
          b.until === 0
            ? t(lang, "❤️‍🩹 No podés responder (bloqueo global de moderación).", "❤️‍🩹 You can't reply right now (global moderation block).")
            : t(lang, `❤️‍🩹 No podés responder hasta ${formatUntil(b.until)}.`, `❤️‍🩹 You can't reply until ${formatUntil(b.until)}.`)
        );
      }
      return;
    }

    if (responderIsLocallyBlocked(interaction.user.id)) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Por ahora no podés responder (bloqueo local por moderación).", "❤️‍🩹 You can't reply for now (local moderation block)."));
      return;
    }

    const replyText = interaction.fields.getTextInputValue("text").trim();
    const shouldSuggestMore = replyText.length < REPLY_SOFT_MIN_LEN;

    if (!replyText) {
      if (ok) {
        await safeEdit(
          interaction,
          t(
            lang,
            "❤️‍🩹 Tu respuesta quedó vacía.\n\nSi querés acompañar a esta persona, podés escribir unas palabras desde el corazón.",
            "❤️‍🩹 Your reply is empty.\n\nIf you want to support this person, you can write a few words from the heart."
          )
        );
      }
      return;
    }

    if (replyText.length < REPLY_MIN_LEN) {
      if (ok) {
        await safeEdit(
          interaction,
          t(
            lang,
            "❤️‍🩹 Gracias por querer acompañar.\n\nSi te sale, escribí un poquito más. A veces unas palabras extra pueden hacer mucha diferencia.",
            "❤️‍🩹 Thank you for wanting to support someone.\n\nIf you can, write a little more. Sometimes a few extra words can make a big difference."
          )
        );
      }
      return;
    }

    if (containsContactRegex(replyText)) {
      if (ok) {
        await safeEdit(
          interaction,
          t(
            lang,
            "❤️‍🩹 Para cuidar la privacidad de todos, no se permiten datos de contacto.\n\nSi querés, reescribí tu respuesta sin eso.",
            "❤️‍🩹 To protect everyone's privacy, contact details are not allowed.\n\nIf you want, rewrite your reply without that."
          )
        );
      }

      await logToModlog(
        "⛔ **Respuesta bloqueada por contacto (regex)**\n" +
          `**responder real:** <@${interaction.user.id}> (${interaction.user.id})\n` +
          `**ventId:** ${ventId}\n` +
          `**lang:** ${lang}\n` +
          `**autor del vent:** <@${vent.authorId}> (${vent.authorId})\n\n` +
          `“${replyText}”`,
        [buildModUserRow(interaction.user.id), buildModUserRow2(interaction.user.id)]
      );
      return;
    }

    const replyId = makeReplyId();
    replies.set(replyId, {
      ventId,
      authorId: vent.authorId,
      responderId: interaction.user.id,
      texto: replyText,
      deliveredAt: 0,
      hidden: false,
      deleted: false,
      strikesApplied: false,
    });

    const riskMatch = getRiskMatch(replyText);
    const riskLevel = riskMatch?.level ?? null;
    const hasContactTrigger = containsContactTriggers(replyText);

    if (riskLevel || hasContactTrigger) {
      const rep = ensureReport(replyReports, replyId);
      rep.autoFlagged = true;

      const reason = hasContactTrigger
        ? "trigger contacto (auto)"
        : `trigger riesgo ${riskLevel} (auto)`;

      rep.reasons.push({
        at: Date.now(),
        reason,
        via: "auto",
      });

      const shouldHide = hasContactTrigger || (AUTO_HIDE_ON_TRIGGERS && riskLevel === "high");

      if (shouldHide) {
        const r = replies.get(replyId);
        if (r) r.hidden = true;

        await logReplyToModlog({
          title: "⚠️ **Trigger detectado (auto) — respuesta**",
          replyId,
          ventId,
          replyText,
          reasonLine:
            `**Risk level:** ${riskLevel ?? "none"}\n` +
            `**Matched:** ${riskMatch?.matched ?? "none"}\n` +
            `**Source:** ${riskMatch?.source ?? "none"}\n` +
            `**Motivo:** trigger riesgo ${riskLevel}`,
        });

        if (ok) {
          await safeEdit(
            interaction,
            t(
              lang,
              "❤️‍🩹 Gracias por querer acompañar.\n\nTu mensaje quedó en revisión por seguridad. Es solo para cuidar a todos.\n\nSi está todo bien, se va a enviar.",
              "❤️‍🩹 Thank you for wanting to support someone.\n\nYour message is being reviewed for safety, just to keep everyone safe.\n\nIf everything is okay, it will be sent."
            )
          );
        }
        return;
      } else {
        await logReplyToModlog({
          title: "⚠️ **Trigger detectado (auto) — respuesta**",
          replyId,
          ventId,
          replyText,
          reasonLine:
            `**Risk level:** ${riskLevel ?? "none"}\n` +
            `**Motivo:** trigger riesgo ${riskLevel}`,
        });
      }
    }

    try {
      const author = await client.users.fetch(vent.authorId);

      await author.send({
        content:
          t(lang, "❤️‍🩹 **Alguien respondió a tu vent (anónimo):**\n\n", "❤️‍🩹 **Someone replied to your vent (anonymous):**\n\n") +
          `“${replyText}”\n\n` +
          t(lang, "🔒 Recordatorio: por seguridad, LowHP Bot no permite compartir datos de contacto.", "🔒 Reminder: for safety, LowHP Bot does not allow sharing contact details."),
        components: [buildReplyReportRow(replyId, lang)],
      });

      const r = replies.get(replyId);
      if (r) r.deliveredAt = Date.now();

      vent.answered = true;

      if (ok) {
        const sentMsg = shouldSuggestMore
          ? t(
              lang,
              "❤️‍🩹 Respuesta enviada. Gracias por estar.\n\nSi querés, podés mandar otra respuesta más desarrollada. A veces unas palabras más pueden ayudar mucho.",
              "❤️‍🩹 Reply sent. Thank you for being here.\n\nIf you want, you can send another, more developed reply. Sometimes a few extra words can help a lot."
            )
          : BOT_TEXT[lang].sentReply;

        await safeEdit(interaction, sentMsg);
      }

    } catch (e) {
      console.error("❌ send reply DM failed:", e?.code, e?.message ?? e);
      if (ok) await safeEdit(interaction, t(lang, "😕 No pude entregar la respuesta (DMs cerrados).", "😕 I couldn't deliver the reply (DMs are closed)."));
    }

    return;
  }

  /* ===== REPORT VENT ===== */
  if (interaction.customId.startsWith("flagmodal:")) {
    const ventId = interaction.customId.split(":")[1];
    const vent = vents.get(ventId);
    const lang = vent?.lang || "es";

    const ok = await safeDefer(interaction);

    if (!vent || vent.deleted) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Este vent ya no está disponible.", "❤️‍🩹 This vent is no longer available."));
      return;
    }

    if (vent.authorId === interaction.user.id) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 No podés denunciar tu propio vent.", "❤️‍🩹 You can't report your own vent."));
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!reason) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 El motivo está vacío.", "❤️‍🩹 The reason is empty."));
      return;
    }

    const rep = ensureReport(ventReports, ventId);
    pruneOldReports(rep);

    if (rep.reporters.has(interaction.user.id)) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Ya denunciaste este vent. Gracias.", "❤️‍🩹 You already reported this vent. Thank you."));
      return;
    }

    rep.reporters.set(interaction.user.id, Date.now());
    rep.reasons.push({ at: Date.now(), reason, via: "user" });

    const count = reportsCountRecent(rep);
    if (ok) await safeEdit(interaction, t(lang, `🚩 Gracias. Denuncias recientes: ${count}/${REPORT_THRESHOLD}`, `🚩 Thanks. Recent reports: ${count}/${REPORT_THRESHOLD}`));

    await logToModlog(
      "🚩 **Denuncia recibida — vent**\n" +
        `**ventId:** ${ventId}\n` +
        `**autor real:** <@${vent.authorId}> (${vent.authorId})\n` +
        `**lang:** ${lang}\n` +
        `**Denuncias recientes:** ${count}/${REPORT_THRESHOLD}\n` +
        `**Link:** ${jumpLink(vent)}\n` +
        `**Categoría:** ${vent.categoria}\n` +
        `**Motivo:** ${reason}\n\n` +
        `“${vent.texto}”`,
      [buildModVentContentRow(ventId), buildModUserRow(vent.authorId), buildModUserRow2(vent.authorId)]
    );

    if (count >= REPORT_THRESHOLD) {
      await hideVentForReview(ventId, `umbral de denuncias (${count})`);
    }

    return;
  }

  /* ===== REPORT REPLY ===== */
  if (interaction.customId.startsWith("flagreplymodal:")) {
    const replyId = interaction.customId.split(":")[1];
    const r = replies.get(replyId);
    const vent = r ? vents.get(r.ventId) : null;
    const lang = vent?.lang || "es";

    const ok = await safeDefer(interaction);

    if (!r) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Esa respuesta ya no está disponible.", "❤️‍🩹 That reply is no longer available."));
      return;
    }

    if (interaction.user.id !== r.authorId) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Este botón no es para vos.", "❤️‍🩹 This button isn't for you."));
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!reason) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 El motivo está vacío.", "❤️‍🩹 The reason is empty."));
      return;
    }

    const rep = ensureReport(replyReports, replyId);
    pruneOldReports(rep);

    if (rep.reporters.has(interaction.user.id)) {
      if (ok) await safeEdit(interaction, t(lang, "❤️‍🩹 Ya denunciaste esta respuesta. Gracias.", "❤️‍🩹 You already reported this reply. Thank you."));
      return;
    }

    rep.reporters.set(interaction.user.id, Date.now());
    rep.reasons.push({ at: Date.now(), reason, via: "user" });

    const count = reportsCountRecent(rep);
    if (ok) await safeEdit(interaction, t(lang, `🚩 Gracias. Reportes recientes: ${count}/${REPLY_REPORT_THRESHOLD}`, `🚩 Thanks. Recent reports: ${count}/${REPLY_REPORT_THRESHOLD}`));

    await logReplyToModlog({
      title: "🚩 **Denuncia de respuesta**",
      replyId,
      ventId: r.ventId,
      replyText: r.texto,
      reasonLine: `**Motivo:** ${reason}\n**Reportes recientes:** ${count}/${REPLY_REPORT_THRESHOLD}`,
    });

    if (count >= REPLY_REPORT_THRESHOLD) {
      r.hidden = true;
    }

    return;
  }

}
});

/* =========================================================
   DM MESSAGE (captura del vent)
========================================================= */
client.on("messageCreate", async (message) => {
  if (message.guild || message.author.bot) return;

  const userId = message.author.id;
  const state = pendingVents.get(userId);
  const lang = state?.lang || "es";

  const b = isBlocked(userId);
  if (b.blocked) {
    await message.channel.send(
      b.until === 0
        ? t(
            lang,
            "❤️‍🩹 No podés usar LowHP Bot (bloqueo global de moderación).",
            "❤️‍🩹 You can't use LowHP Bot right now (global moderation block)."
          )
        : t(
            lang,
            `❤️‍🩹 No podés usar LowHP Bot hasta ${formatUntil(b.until)}.`,
            `❤️‍🩹 You can't use LowHP Bot until ${formatUntil(b.until)}.`
          )
    ).catch(() => {});
    return;
  }

  if (processingVent.has(userId)) return;
  if (!state) return;

  const texto = message.content.trim();
  if (!texto) return;

  // 🚫 Muy corto
  if (texto.length < VENT_MIN_LEN) {
    pendingVents.set(userId, { categoria: state.categoria, lang: state.lang });
    await message.channel.send(
      t(
        lang,
        "❤️‍🩹 Gracias por compartir.\n\nSi te sale, podés contar un poquito más. A veces ayuda a que otros puedan entenderte mejor.",
        "❤️‍🩹 Thanks for sharing.\n\nIf you feel like it, you can share a bit more. It can help others understand you better."
      )
    ).catch(() => {});
    return;
  }

  // 🚫 Muy largo
  if (texto.length > VENT_MAX_LEN) {
    pendingVents.set(userId, { categoria: state.categoria, lang: state.lang });
    await message.channel.send(
      t(
        lang,
        `❤️‍🩹 Tu mensaje es bastante largo (**${texto.length}** caracteres).\n\nSi podés, intentá dividirlo en partes o resumirlo un poco. Lo importante es que puedas expresarte.`,
        `❤️‍🩹 Your message is a bit long (**${texto.length}** characters).\n\nIf you can, try breaking it into parts or shortening it a bit. What matters is that you can express yourself.`
      )
    ).catch(() => {});
    return;
  }

  if (containsContactRegex(texto)) {
    await logToModlog(
      "⛔ **Vent bloqueado por contacto (regex)**\n" +
        `**autor real:** <@${userId}> (${userId})\n` +
        `**lang:** ${lang}\n` +
        `**Categoría:** ${state.categoria}\n\n` +
        `“${texto}”`,
      [buildModUserRow(userId), buildModUserRow2(userId)]
    );

    await message.channel.send(
      t(
        lang,
        "❤️‍🩹 Para cuidar tu privacidad y la de los demás, no se permiten datos de contacto.\n\nSi querés, reescribilo sin eso y mandalo de nuevo.",
        "❤️‍🩹 To protect your privacy and everyone else’s, contact details are not allowed.\n\nIf you want, rewrite it without that and send it again."
      )
    ).catch(() => {});
    return;
  }

  processingVent.add(userId);
  pendingVents.delete(userId);

  confirmVents.set(userId, {
    categoria: state.categoria,
    texto,
    lang: state.lang,
  });

  let extraNote = "";

  if (texto.length < 50) {
    extraNote = t(
      lang,
      "\n\n❤️‍🩹 Gracias por compartir.\n\nSi te sale, podés contar un poquito más. A veces ayuda a que otros puedan entenderte mejor.",
      "\n\n❤️‍🩹 Thank you for sharing.\n\nIf you can, you could share a bit more. Sometimes it helps others understand you better."
    );
  }

  try {
    await message.channel.send({
      content:
        t(
          lang,
          "❤️‍🩹 **Confirmá tu mensaje**\n\n",
          "❤️‍🩹 **Confirm your message**\n\n"
        ) +
        `${t(lang, "**Categoría:**", "**Category:**")} ${state.categoria}\n\n` +
        `“${texto}”` +
        extraNote,
      components: [buildConfirmRow(userId, lang)],
    });
  } catch (e) {
    console.error("❌ DM confirm send failed:", e?.code, e?.message ?? e);
  } finally {
    processingVent.delete(userId);
  }
});
/* =========================================================
   START
========================================================= */
loadBlocklist();
client.login(process.env.DISCORD_TOKEN);