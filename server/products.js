/* ============================================================
   المنتجات + رتب الديسكورد
   ------------------------------------------------------------
   الأسعار والرتب تُحفظ في data/products.json وتُعدّل من لوحة تحكم
   المالك (/admin). القائمة تحت هي القيم الأولى فقط — أول تشغيل
   ينسخها للملف، وبعدها التعديل يصير من اللوحة.

   ⚠️ السيرفر يحسب المبلغ من هنا ولا يثق بالسعر الجاي من المتصفح.

   👈 رتبة كل حزمة: حط ID رتبة الديسكورد داخل roles، مثال:
      roles:["123456789012345678"]
      (فعّل Developer Mode في الديسكورد → كبسة يمين على الرتبة → Copy ID)
      عند نجاح الدفع يُعطى المشتري رتبة الحزمة تلقائياً.
   ============================================================ */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "data", "products.json");

const DEFAULTS = [
  /* ---------- حزم المواطنين ---------- */
  { id:"cit-1", cat:"citizens", name:"حزمة المواطنين",                 price:80.99,  roles:[], active:true },
  { id:"cit-2", cat:"citizens", name:"حزمة القولد",                    price:149.99, roles:[], active:true },
  { id:"cit-3", cat:"citizens", name:"حزمة المرهمات",                  price:249.99, roles:[], active:true },
  { id:"cit-4", cat:"citizens", name:"حزمة التهريب + تهريب (الحبوش)",  price:185.49, roles:[], active:true },
  { id:"cit-5", cat:"citizens", name:"حزمة التوالف",                   price:119.99, roles:[], active:true },
  { id:"cit-6", cat:"citizens", name:"حزمة الشاحنات + مركز الوظائف",   price:149.99, roles:[], active:true },
  { id:"cit-7", cat:"citizens", name:"حزمة الاسلحة",                   price:99.99,  roles:[], active:true },
  { id:"cit-8", cat:"citizens", name:"حزمة VIP",                       price:349.99, roles:[], active:true },

  /* ---------- الحزم العسكرية ---------- */
  { id:"mil-1", cat:"military", name:"حزم السريات (Special)",          price:239.99, roles:[], active:true },
  { id:"mil-2", cat:"military", name:"حزم السريات (Standard)",         price:69.99,  roles:[], active:true },
  { id:"mil-3", cat:"military", name:"حزمة المكافحة",                  price:69.99,  roles:[], active:true },
  { id:"mil-4", cat:"military", name:"حزمة الطوارئ",                   price:89.99,  roles:[], active:true },

  /* ---------- سيارات مميزة ---------- */
  { id:"car-1", cat:"special",  name:"حزمة الهدروليك",                 price:59.99,  roles:[], active:true },

  /* ---------- التعزيز ---------- */
  { id:"boost-1", cat:"boost",  name:"حزمة التعزيز",                   price:79.99,  roles:[], active:true },

  /* ---------- الدراجات ---------- */
  { id:"bike-1", cat:"bikes",   name:"حزمة الدراجات النارية",          price:119.99, roles:[], active:true },

  /* ---------- حزم أخرى ---------- */
  { id:"other-1", cat:"other",  name:"حزمة السكنات",                   price:109.99, roles:[], active:true },
  { id:"other-2", cat:"other",  name:"فك الباند النهائي",              price:199.99, roles:[], active:true },
  { id:"other-3", cat:"other",  name:"فك سحب الحزم",                   price:89.99,  roles:[], active:true }
];

const CATS = ["citizens", "military", "special", "boost", "bikes", "other"];

fs.mkdirSync(path.dirname(FILE), { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2));

function loadProducts() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(list) && list.length ? list : DEFAULTS;
  } catch { return DEFAULTS; }
}

function saveProducts(list) {
  const clean = list.map(p => ({
    id: String(p.id).slice(0, 40),
    cat: CATS.includes(p.cat) ? p.cat : "citizens",
    name: String(p.name || "").slice(0, 80),
    price: Math.max(1, Math.min(100000, Number(p.price) || 0)),
    roles: (Array.isArray(p.roles) ? p.roles : [])
      .map(r => String(r).trim())
      .filter(r => /^\d{15,25}$/.test(r)),          // أرقام رتب ديسكورد فقط
    active: p.active !== false
  }));
  fs.writeFileSync(FILE, JSON.stringify(clean, null, 2));
  return clean;
}

/* رتبة تُعطى لأي مشتري مهما كانت الحزمة (من .env، اختياري) */
const BUYER_ROLE = process.env.DISCORD_BUYER_ROLE || "";

/* نسبة ضريبة القيمة المضافة — 0 لأن الأسعار المعروضة نهائية.
   لو تبي تضيف ضريبة فوق السعر، غيّرها (مثال 0.15). */
const VAT = Number(process.env.VAT_RATE || 0);

module.exports = { loadProducts, saveProducts, DEFAULTS, BUYER_ROLE, VAT, FILE };
