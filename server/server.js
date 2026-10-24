/* ============================================================
   Entop Police Mod — سيرفر الدفع + رتب الديسكورد
   ------------------------------------------------------------
   التشغيل:
     1) npm install
     2) انسخ .env.example إلى .env وعبّه
     3) npm start
   ============================================================ */
const path = require("path");
const fs = require("fs");

/* يقرأ .env من مجلد السيرفر مهما كان مكان تشغيل الأمر.
   قبل كذا كان يقرأه من المجلد الحالي فقط، فلو شغّلت
   «node server/server.js» من مجلد المشروع ما كان يلقاه
   وتطلع لوحة التحكم مقفلة. */
const ENV_PATHS = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "..", ".env"),
  path.join(process.cwd(), ".env")
];
const ENV_FILE = ENV_PATHS.find(p => fs.existsSync(p));
require("dotenv").config(ENV_FILE ? { path: ENV_FILE } : {});

const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { loadProducts, saveProducts, BUYER_ROLE, VAT, FILE: PRODUCTS_FILE } = require("./products");
const DB = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const SITE = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECRET = (process.env.SESSION_SECRET || "dev_secret_change_me").trim();

const MOYASAR_KEY  = (process.env.MOYASAR_SECRET_KEY || "").trim();
const MOYASAR_HOOK = (process.env.MOYASAR_WEBHOOK_SECRET || "").trim();
const MOYASAR_API  = "https://api.moyasar.com/v1";
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();

const DC = {
  api: "https://discord.com/api/v10",
  id: process.env.DISCORD_CLIENT_ID || "",
  secret: process.env.DISCORD_CLIENT_SECRET || "",
  bot: process.env.DISCORD_BOT_TOKEN || "",
  guild: process.env.DISCORD_GUILD_ID || "",
  log: process.env.DISCORD_LOG_CHANNEL_ID || ""
};

/* وضع التجربة: بدون مفتاح ميسر يشتغل دفع وهمي عشان تختبر كل شي محلياً */
const MOCK = !MOYASAR_KEY;

app.use(express.json({
  // نحتاج نسخة خام من الجسم للتحقق من الويبهوك
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));
app.use(cookieParser(SECRET));
app.use(express.static(path.join(__dirname, "..")));   // يخدم index.html و style.css و script.js

/* ============================================================
   تخزين بسيط بملف JSON (يكفي لمتجر صغير)
   لمتجر كبير: بدّله بقاعدة بيانات مثل SQLite أو MongoDB
   ============================================================ */
const DB_FILE = path.join(__dirname, "data", "orders.json");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");

const readOrders  = () => JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
const writeOrders = list => { fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2)); DB.push("orders", list); };
const findOrder   = fn => readOrders().find(fn);
function saveOrder(order) {
  const list = readOrders();
  const i = list.findIndex(o => o.no === order.no);
  i > -1 ? (list[i] = order) : list.push(order);
  writeOrders(list);
  return order;
}

const halalas = sar => Math.round(sar * 100);
const money   = h => (h / 100).toFixed(2);

/* ============================================================
   الديسكورد
   ============================================================ */
async function discordFetch(url, opts = {}) {
  const r = await fetch(DC.api + url, {
    ...opts,
    headers: {
      Authorization: `Bot ${DC.bot}`,
      "Content-Type": "application/json",
      "X-Audit-Log-Reason": "Entop Store purchase",
      ...(opts.headers || {})
    }
  });
  return r;
}

/** يضيف العضو للسيرفر إذا مو موجود (يحتاج صلاحية guilds.join) */
async function ensureMember(userId, accessToken) {
  const check = await discordFetch(`/guilds/${DC.guild}/members/${userId}`);
  if (check.ok) return true;
  if (!accessToken) return false;
  const add = await discordFetch(`/guilds/${DC.guild}/members/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ access_token: accessToken })
  });
  return add.ok || add.status === 204;
}

/** يعطي الرتب للمشتري */
async function grantRoles(userId, roleIds, accessToken) {
  if (!DC.bot || !DC.guild) return { ok: false, error: "بيانات بوت الديسكورد ناقصة" };
  const done = [], failed = [];
  await ensureMember(userId, accessToken);
  for (const role of roleIds) {
    if (!role || role.startsWith("ROLE_ID_")) { failed.push(role); continue; }
    const r = await discordFetch(`/guilds/${DC.guild}/members/${userId}/roles/${role}`, { method: "PUT" });
    (r.ok || r.status === 204) ? done.push(role) : failed.push(role);
  }
  return { ok: failed.length === 0, done, failed };
}

/** إشعار في قناة الطلبات (اختياري) */
async function logToDiscord(order, result) {
  if (!DC.log || !DC.bot) return;
  const lines = order.items.map(i => `• ${i.name} ×${i.qty}`).join("\n");
  await discordFetch(`/channels/${DC.log}/messages`, {
    method: "POST",
    body: JSON.stringify({
      embeds: [{
        title: `طلب جديد #${order.no}`,
        color: 0x1fe3b6,
        description: lines,
        fields: [
          { name: "المشتري", value: `<@${order.discordId}>`, inline: true },
          { name: "المبلغ", value: `${money(order.amount)} ر.س`, inline: true },
          { name: "الرتب", value: result?.done?.length ? result.done.map(r => `<@&${r}>`).join(" ") : "لم تُعطَ", inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    })
  });
}

/* ============================================================
   ربط حساب الديسكورد (OAuth2)
   ============================================================ */
app.get("/auth/discord", (req, res) => {
  if (!DC.id) return res.status(500).send("DISCORD_CLIENT_ID غير معبأ في .env");
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("dc_state", state, { httpOnly: true, signed: true, maxAge: 6e5, sameSite: "lax" });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", DC.id);
  url.searchParams.set("redirect_uri", `${SITE}/auth/discord/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds.join");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.signedCookies.dc_state) return res.redirect("/#/dashboard?discord=error");

    const body = new URLSearchParams({
      client_id: DC.id,
      client_secret: DC.secret,
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: `${SITE}/auth/discord/callback`
    });
    const tokRes = await fetch(`${DC.api}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!tokRes.ok) return res.redirect("/#/dashboard?discord=error");
    const tok = await tokRes.json();

    const meRes = await fetch(`${DC.api}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const me = await meRes.json();

    res.cookie("dc_user", JSON.stringify({
      id: me.id,
      username: me.username,
      display: me.global_name || me.username,
      avatar: me.avatar,
      at: tok.access_token
    }), { httpOnly: true, signed: true, maxAge: 30 * 864e5, sameSite: "lax" });

    // سجّل/حدّث العضو في قائمة من دخل بالديسكورد (تظهر في لوحة الأدمن)
    upsertMember({ id: me.id, username: me.username, display: me.global_name || me.username, avatar: me.avatar });

    res.redirect("/#/dashboard?discord=ok");
  } catch (e) {
    console.error("discord callback:", e);
    res.redirect("/#/dashboard?discord=error");
  }
});

app.post("/api/discord/unlink", (req, res) => { res.clearCookie("dc_user"); res.json({ ok: true }); });

const currentDiscord = req => {
  try { return req.signedCookies.dc_user ? JSON.parse(req.signedCookies.dc_user) : null; }
  catch { return null; }
};

app.get("/api/me", (req, res) => {
  const d = currentDiscord(req);
  // سجّل العضو في القائمة حتى لو كان داخل بكوكي سابق (يضمن ظهوره في لوحة الأدمن)
  if (d && d.id) upsertMember({ id: d.id, username: d.username, display: d.display || d.username, avatar: d.avatar });
  res.json({ discord: d ? { id: d.id, username: d.username, display: d.display || d.username, avatar: d.avatar } : null, mock: MOCK });
});

app.get("/api/products", (_req, res) =>
  res.json(loadProducts().filter(p => p.active !== false)
    .map(({ id, cat, name, price }) => ({ id, cat, name, price })))
);

/* ============================================================
   إنشاء الطلب وفاتورة الدفع
   الفاتورة من ميسر تفتح صفحة دفع تدعم:
   مدى · فيزا · ماستركارد · Apple Pay · STC Pay
   ============================================================ */
app.post("/api/checkout", async (req, res) => {
  try {
    const dc = currentDiscord(req);
    if (!dc) return res.status(401).json({ error: "no_discord" });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "السلة فارغة" });

    // الأسعار تُحسب من ملف السيرفر فقط
    let subtotal = 0;
    const lines = [], roles = new Set();
    for (const it of items) {
      const p = loadProducts().find(x => x.id === it.id && x.active !== false);
      if (!p) return res.status(400).json({ error: "منتج غير متاح" });
      const qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
      subtotal += p.price * qty;
      lines.push({ id: p.id, name: p.name, qty, price: p.price });
      (p.roles || []).forEach(r => roles.add(r));
    }
    if (BUYER_ROLE) roles.add(BUYER_ROLE);

    const amount = halalas(subtotal * (1 + VAT));
    const no = String(Date.now()).slice(-9);
    const order = {
      no, amount, items: lines, roles: [...roles],
      discordId: dc.id, discordName: dc.username, discordToken: dc.at,
      email: (req.body?.email || "").slice(0, 120),
      status: "pending", invoiceId: null, rolesGiven: null,
      createdAt: new Date().toISOString()
    };

    /* --- وضع التجربة: صفحة دفع وهمية --- */
    if (MOCK) {
      saveOrder(order);
      return res.json({ url: `${SITE}/mock-pay?no=${no}`, no, mock: true });
    }

    /* --- إنشاء فاتورة ميسر --- */
    const inv = await fetch(`${MOYASAR_API}/invoices`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(MOYASAR_KEY + ":").toString("base64"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount,
        currency: "SAR",
        description: `Entop #${no} — ${lines.map(l => l.name).join(", ")}`.slice(0, 250),
        callback_url: `${SITE}/api/moyasar/callback`,
        success_url:  `${SITE}/#/thanks?no=${no}`,
        back_url:     `${SITE}/#/cart`
      })
    });
    const data = await inv.json();
    if (!inv.ok || !data.url) {
      console.error("moyasar invoice error:", data);
      return res.status(502).json({ error: "تعذّر إنشاء الفاتورة، تأكد من مفتاح ميسر" });
    }

    order.invoiceId = data.id;
    saveOrder(order);
    res.json({ url: data.url, no });
  } catch (e) {
    console.error("checkout:", e);
    res.status(500).json({ error: "خطأ في السيرفر" });
  }
});

/* ============================================================
   تأكيد الدفع → إعطاء الرتب
   لا نثق بأي طلب جاي من برّا: نرجع نسأل ميسر عن حالة الفاتورة
   ============================================================ */
async function fetchInvoice(invoiceId) {
  const r = await fetch(`${MOYASAR_API}/invoices/${invoiceId}`, {
    headers: { Authorization: "Basic " + Buffer.from(MOYASAR_KEY + ":").toString("base64") }
  });
  return r.ok ? r.json() : null;
}

async function fulfil(order) {
  if (order.status === "paid") return order;            // ما نعطي الرتب مرتين
  order.status = "paid";
  order.paidAt = new Date().toISOString();
  const result = await grantRoles(order.discordId, order.roles, order.discordToken);
  order.rolesGiven = result;
  delete order.discordToken;                            // ما نحتفظ بالتوكن بعد الاستخدام
  saveOrder(order);
  logToDiscord(order, result).catch(() => {});
  return order;
}

/* callback الفاتورة: ميسر يرسل كائن الفاتورة عند الدفع */
app.post("/api/moyasar/callback", async (req, res) => {
  res.sendStatus(200);                                  // نرد بسرعة أولاً
  try {
    const id = req.body?.id;
    if (!id) return;
    const inv = await fetchInvoice(id);
    if (!inv || inv.status !== "paid") return;
    const order = findOrder(o => o.invoiceId === id);
    if (order && order.amount === inv.amount) await fulfil(order);
  } catch (e) { console.error("callback:", e); }
});

/* ويبهوك الحساب (payment_paid) — يحتاج تفعيله من لوحة ميسر */
app.post("/api/moyasar/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const evt = req.body || {};
    if (MOYASAR_HOOK && evt.secret_token !== MOYASAR_HOOK) return;  // تحقق من السر
    if (evt.type !== "payment_paid") return;
    const invoiceId = evt.data?.invoice_id;
    if (!invoiceId) return;
    const inv = await fetchInvoice(invoiceId);
    if (!inv || inv.status !== "paid") return;
    const order = findOrder(o => o.invoiceId === invoiceId);
    if (order && order.amount === inv.amount) await fulfil(order);
  } catch (e) { console.error("webhook:", e); }
});

/* حالة الطلب لصفحة الشكر (تتحقق كل ثانيتين) */
app.get("/api/order/:no", async (req, res) => {
  const order = findOrder(o => o.no === req.params.no);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

  // احتياط: لو تأخر الويبهوك نسأل ميسر مباشرة
  if (order.status === "pending" && order.invoiceId && !MOCK) {
    const inv = await fetchInvoice(order.invoiceId);
    if (inv?.status === "paid" && inv.amount === order.amount) await fulfil(order);
  }
  const o = findOrder(x => x.no === order.no);
  res.json({
    no: o.no,
    status: o.status,
    amount: money(o.amount),
    items: o.items,
    discord: o.discordName,
    rolesGiven: o.rolesGiven?.done?.length || 0,
    rolesFailed: o.rolesGiven?.failed?.length || 0
  });
});

/* صفحة دفع وهمية — تشتغل فقط بدون مفتاح ميسر (للتجربة المحلية) */
app.get("/mock-pay", async (req, res) => {
  if (!MOCK) return res.sendStatus(404);
  const order = findOrder(o => o.no === req.query.no);
  if (!order) return res.status(404).send("الطلب غير موجود");
  res.send(`<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">
  <body style="background:#05070E;color:#EAF1FB;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
    <div>
      <h2>صفحة دفع تجريبية</h2>
      <p>طلب #${order.no} — ${money(order.amount)} ر.س</p>
      <p style="color:#8CA0BE;font-size:14px">تظهر هذي الصفحة لأن MOYASAR_SECRET_KEY فاضي في .env</p>
      <a href="/api/mock-pay/${order.no}" style="display:inline-block;margin-top:16px;padding:14px 28px;border-radius:12px;background:linear-gradient(115deg,#1FE3B6,#2F8BF2,#E51FC4);color:#04070E;font-weight:800;text-decoration:none">تأكيد الدفع (تجربة)</a>
    </div>
  </body></html>`);
});
app.get("/api/mock-pay/:no", async (req, res) => {
  if (!MOCK) return res.sendStatus(404);
  const order = findOrder(o => o.no === req.params.no);
  if (!order) return res.sendStatus(404);
  await fulfil(order);
  res.redirect(`/#/thanks?no=${order.no}`);
});


/* ============================================================
   لوحة تحكم المالك — /admin
   محمية بكلمة مرور من .env (ADMIN_PASSWORD)
   ============================================================ */
const isAdmin = req => req.signedCookies.adm === "1";

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "ADMIN_PASSWORD غير معبأ في .env" });
  if (!isAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  next();
}

/* حماية بسيطة من تخمين كلمة المرور */
const tries = new Map();
app.post("/api/admin/login", (req, res) => {
  const ip = req.ip || "x";
  const rec = tries.get(ip) || { n: 0, at: 0 };
  if (rec.n >= 6 && Date.now() - rec.at < 6e5)
    return res.status(429).json({ error: "محاولات كثيرة، انتظر 10 دقائق" });
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "ADMIN_PASSWORD غير معبأ في .env" });

  const pass = String(req.body?.password || "").trim();
  const ok = pass.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(ADMIN_PASSWORD));
  if (!ok) {
    tries.set(ip, { n: rec.n + 1, at: Date.now() });
    return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  }
  tries.delete(ip);
  res.cookie("adm", "1", { httpOnly: true, signed: true, maxAge: 12 * 36e5, sameSite: "lax" });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => { res.clearCookie("adm"); res.json({ ok: true }); });

app.get("/api/admin/session", (req, res) =>
  res.json({ admin: isAdmin(req), configured: !!ADMIN_PASSWORD }));

/* حالة الإعدادات — يوضح وش ناقص قبل الإطلاق */
app.get("/api/admin/health", requireAdmin, (_req, res) => {
  const products = loadProducts();
  res.json({
    payments: { moyasar: !!MOYASAR_KEY, live: MOYASAR_KEY.startsWith("sk_live"), webhookSecret: !!MOYASAR_HOOK, mock: MOCK },
    discord: { client: !!DC.id, secret: !!DC.secret, bot: !!DC.bot, guild: !!DC.guild, logChannel: !!DC.log },
    site: { url: SITE, https: SITE.startsWith("https://") },
    products: { total: products.length, active: products.filter(p => p.active !== false).length,
                withoutRoles: products.filter(p => !(p.roles || []).length).map(p => p.name) }
  });
});

/* إحصائيات */
app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  const all = readOrders();
  const paid = all.filter(o => o.status === "paid");
  const sum = list => list.reduce((s, o) => s + o.amount, 0) / 100;
  const since = d => new Date(Date.now() - d * 864e5).toISOString();
  const top = {};
  paid.forEach(o => o.items.forEach(i => { top[i.name] = (top[i.name] || 0) + i.qty; }));
  res.json({
    revenueTotal: sum(paid).toFixed(2),
    revenue30:  sum(paid.filter(o => o.paidAt > since(30))).toFixed(2),
    revenueToday: sum(paid.filter(o => (o.paidAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10))).toFixed(2),
    ordersPaid: paid.length,
    ordersPending: all.filter(o => o.status === "pending").length,
    avg: paid.length ? (sum(paid) / paid.length).toFixed(2) : "0.00",
    top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5)
  });
});

/* الطلبات */
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "all");
  let list = readOrders().slice().reverse();
  if (status !== "all") list = list.filter(o => o.status === status);
  if (q) list = list.filter(o =>
    o.no.includes(q) || (o.discordName || "").toLowerCase().includes(q) ||
    (o.email || "").toLowerCase().includes(q) || (o.discordId || "").includes(q));
  res.json(list.slice(0, 200).map(o => ({
    no: o.no, status: o.status, amount: money(o.amount),
    items: o.items, discordName: o.discordName, discordId: o.discordId,
    email: o.email, createdAt: o.createdAt, paidAt: o.paidAt || null,
    rolesGiven: o.rolesGiven?.done?.length || 0,
    rolesFailed: o.rolesGiven?.failed?.length || 0
  })));
});

/* إعادة إعطاء الرتبة يدوياً (لو فشلت لأي سبب) */
app.post("/api/admin/orders/:no/regrant", requireAdmin, async (req, res) => {
  const order = findOrder(o => o.no === req.params.no);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });
  if (order.status !== "paid") return res.status(400).json({ error: "الطلب غير مدفوع" });
  const result = await grantRoles(order.discordId, order.roles, order.discordToken);
  order.rolesGiven = result;
  saveOrder(order);
  res.json({ ok: result.ok, done: result.done?.length || 0, failed: result.failed?.length || 0, error: result.error });
});

/* المنتجات: عرض وتعديل */
app.get("/api/admin/products", requireAdmin, (_req, res) => res.json(loadProducts()));
app.post("/api/admin/products", requireAdmin, (req, res) => {
  if (!Array.isArray(req.body?.products)) return res.status(400).json({ error: "صيغة غير صحيحة" });
  const saved = saveProducts(req.body.products); DB.push("products", saved); res.json({ ok: true, products: saved });
});

/* ============================================================
   طلبات التحويل البنكي (يدوية) — إنشاء/عرض/اعتماد/إلغاء
   مخزّنة في ملف منفصل، ومفتاحها معرّف الديسكورد للعميل.
   ============================================================ */
const M_FILE = path.join(__dirname, "data", "manual_orders.json");
if (!fs.existsSync(M_FILE)) fs.writeFileSync(M_FILE, "[]");
const readManual  = () => { try { return JSON.parse(fs.readFileSync(M_FILE, "utf8")); } catch (e) { return []; } };
const writeManual = list => { fs.writeFileSync(M_FILE, JSON.stringify(list, null, 2)); DB.push("manual_orders", list); };

// إنشاء طلب تحويل جديد
app.post("/api/order", (req, res) => {
  try {
    const user  = String(req.body?.user || "").trim().replace(/^@/, "").toLowerCase().slice(0, 40);
    const name  = String(req.body?.name || "").trim().slice(0, 60);
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 40).map(i => ({
      name: String(i.name || "").slice(0, 80),
      qty:  Math.max(1, Math.min(20, parseInt(i.qty, 10) || 1))
    })) : [];
    const total = String(req.body?.total || "").slice(0, 40);
    if (!user || !items.length) return res.status(400).json({ error: "بيانات ناقصة" });

    const list = readManual();
    const no = String(100000 + list.length + 1);
    const order = {
      no, user, name, items, total,
      status: "بانتظار التحويل",
      date: new Date().toLocaleDateString("en-GB"),
      createdAt: new Date().toISOString()
    };
    list.push(order);
    writeManual(list);
    res.json({ ok: true, no });
  } catch (e) { res.status(500).json({ error: "خطأ في السيرفر" }); }
});

// طلبات العميل الحالي (للوحة التحكم في المتجر)
app.get("/api/order/mine", (req, res) => {
  const u = String(req.query.u || "").trim().replace(/^@/, "").toLowerCase();
  if (!u) return res.json([]);
  const mine = readManual().filter(o => o.user === u).reverse()
    .map(o => ({ no: o.no, items: o.items, total: o.total, status: o.status, date: o.date }));
  res.json(mine);
});

// أدمن: عرض كل طلبات التحويل
app.get("/api/admin/manual-orders", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  let list = readManual().slice().reverse();
  if (q) list = list.filter(o => o.no.includes(q) || (o.user || "").includes(q) || (o.name || "").toLowerCase().includes(q));
  res.json(list.slice(0, 300));
});

// أدمن: اعتماد / إلغاء طلب
function setManualStatus(no, status) {
  const list = readManual();
  const o = list.find(x => x.no === no);
  if (!o) return null;
  o.status = status;
  o.updatedAt = new Date().toISOString();
  writeManual(list);
  return o;
}
app.post("/api/admin/manual-orders/:no/approve", requireAdmin, (req, res) => {
  const o = setManualStatus(req.params.no, "معتمد");
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  res.json({ ok: true, status: o.status });
});
app.post("/api/admin/manual-orders/:no/cancel", requireAdmin, (req, res) => {
  const o = setManualStatus(req.params.no, "ملغي");
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  res.json({ ok: true, status: o.status });
});

/* ============================================================
   الأعضاء — من سجّل دخول عن طريق الديسكورد
   ============================================================ */
const U_FILE = path.join(__dirname, "data", "members.json");
if (!fs.existsSync(U_FILE)) fs.writeFileSync(U_FILE, "[]");
const readMembers  = () => { try { return JSON.parse(fs.readFileSync(U_FILE, "utf8")); } catch (e) { return []; } };
const writeMembers = list => { fs.writeFileSync(U_FILE, JSON.stringify(list, null, 2)); DB.push("members", list); };
function upsertMember(m) {
  try {
    const list = readMembers();
    const now = new Date().toISOString();
    const ex = list.find(x => x.id === m.id);
    if (ex) {
      ex.username = m.username; ex.display = m.display; ex.avatar = m.avatar;
      ex.lastLogin = now; ex.logins = (ex.logins || 1) + 1;
    } else {
      list.push({ id: m.id, username: m.username, display: m.display, avatar: m.avatar, firstLogin: now, lastLogin: now, logins: 1 });
    }
    writeMembers(list);
  } catch (e) {}
}

// أدمن: قائمة من دخل بالديسكورد + عدد مشترياته
app.get("/api/admin/members", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const manual = readManual();
  const paid = readOrders().filter(o => o.status === "paid");
  let list = readMembers().slice().reverse().map(m => {
    const uname = String(m.username || "").toLowerCase();
    const mCount = manual.filter(o => (o.user || "") === uname).length;
    const pCount = paid.filter(o => o.discordId === m.id).length;
    return {
      id: m.id, username: m.username, display: m.display, avatar: m.avatar,
      firstLogin: m.firstLogin, lastLogin: m.lastLogin, logins: m.logins || 1,
      orders: mCount + pCount
    };
  });
  if (q) list = list.filter(m => (m.username || "").toLowerCase().includes(q) || (m.display || "").toLowerCase().includes(q) || (m.id || "").includes(q));
  res.json(list.slice(0, 500));
});

/* صفحة اللوحة */
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));

/* ============================================================
   الإقلاع: مزامنة مع MongoDB (إن وُجد) ثم تشغيل السيرفر
   ============================================================ */
async function syncFromDB() {
  try {
    const connected = await DB.initDB();
    if (!connected) {
      console.log("⚠️  MONGODB_URI فاضي — التخزين بالملفات فقط (يُمسح عند إعادة النشر/النوم على Render المجاني)");
      return;
    }
    console.log("🍃 MongoDB متصل — التخزين الدائم مفعّل");
    const stores = [
      { name: "orders",        file: DB_FILE },
      { name: "manual_orders", file: M_FILE },
      { name: "members",       file: U_FILE },
      { name: "products",      file: PRODUCTS_FILE }
    ];
    for (const st of stores) {
      const data = await DB.pull(st.name);
      if (Array.isArray(data)) {
        fs.writeFileSync(st.file, JSON.stringify(data, null, 2));   // استرجاع من القاعدة
      } else {
        let cur = [];
        try { cur = JSON.parse(fs.readFileSync(st.file, "utf8")); } catch (e) {}
        DB.push(st.name, cur);                                       // أول مرة: ازرع القاعدة من الملف
      }
    }
  } catch (e) {
    console.error("MongoDB sync error:", e.message, "— التخزين بالملفات فقط");
  }
}

syncFromDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ Entop store server → http://localhost:${PORT}`);
    console.log(MOCK ? "⚠️  وضع التجربة: الدفع وهمي (MOYASAR_SECRET_KEY فاضي)" : "💳 ميسر مفعّل");
    if (!DC.bot || !DC.guild) console.log("⚠️  بيانات بوت الديسكورد ناقصة — الرتب ما راح تنعطى");
    console.log(DB.hasDB() ? "🍃 التخزين الدائم: MongoDB" : "📄 التخزين: ملفات محلية فقط");
    console.log(ADMIN_PASSWORD
      ? `🔐 لوحة التحكم → ${SITE}/admin  (كلمة المرور طولها ${ADMIN_PASSWORD.length} حرف)`
      : "❌ ADMIN_PASSWORD فاضي — اللوحة مقفلة");
  });
});
