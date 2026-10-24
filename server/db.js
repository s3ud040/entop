/* ============================================================
   db.js — تخزين دائم عبر MongoDB (اختياري)
   ------------------------------------------------------------
   إذا كان MONGODB_URI موجوداً، تُحفظ البيانات في MongoDB وتبقى
   للأبد حتى لو أُعيد نشر السيرفر أو نام (مهم على Render المجاني).
   بدون MONGODB_URI يرجع hasDB=false ويبقى التخزين في الملفات فقط.

   الفكرة: كل "مخزن" (الطلبات، طلبات التحويل، الأعضاء، المنتجات)
   يُحفظ كمستند واحد { _id:<الاسم>, data:[...] } في مجموعة store.
   ============================================================ */
const URI = process.env.MONGODB_URI || "";
let col = null;

async function initDB() {
  if (!URI) return false;
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  col = client.db("entop").collection("store");
  return true;
}

function hasDB() { return !!col; }

// اقرأ مصفوفة مخزن من MongoDB (أو null لو غير موجود)
async function pull(name) {
  if (!col) return null;
  const doc = await col.findOne({ _id: name });
  return doc ? doc.data : null;
}

// احفظ مصفوفة مخزن في MongoDB (fire-and-forget مع تسجيل الأخطاء)
function push(name, data) {
  if (!col) return;
  col.updateOne({ _id: name }, { $set: { data } }, { upsert: true })
    .catch(e => console.error("mongo push", name, e.message));
}

module.exports = { initDB, hasDB, pull, push };
