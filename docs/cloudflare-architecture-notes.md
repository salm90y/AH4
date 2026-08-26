# ملاحظات بنية Cloudflare لـ AH4 Watch Party

## نتائج مؤكدة

- يمكن ربط Worker بنطاق أو نطاق فرعي مخصص ضمن منطقة Cloudflare، ويُناسب ذلك عندما يكون Worker هو خادم أصل التطبيق. المصدر: [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
- يمكن أن يعمل Durable Object كخادم WebSocket، وأن ينسّق عدة عملاء في الغرفة نفسها؛ وتوصي Cloudflare بواجهة WebSocket ذات السبات للحفاظ على الاتصالات في فترات الخمول. المصدر: [Use WebSockets with Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## التصميم المبدئي المقترح

| الطبقة | خدمة Cloudflare | الاستخدام في AH4 |
| --- | --- | --- |
| واجهة API | Worker على `api.ahmed1986y.com` | إنشاء الغرف، الانضمام إليها، والتحقق من كلمة المرور المجزأة. |
| بيانات الغرفة الأساسية | D1 | حفظ اسم الغرفة والمضيف وكلمة المرور المجزأة عبر SQL مُدار من Cloudflare. |
| الحالة الفورية | خدمة WebSocket مستقبلية | الدردشة والمزامنة اللحظية ستُضاف بعد نجاح طبقة إنشاء الغرف الأساسية. |
| سجل الرسائل | D1 | يُضاف عند تفعيل الدردشة الحية، مع فصل البيانات الدائمة عن APK. |
| الملفات عند الحاجة | R2 اختياري | ملفات M3U المرفوعة إذا تقرر حفظها مركزيًا. |

## قيود التنفيذ

سيُثبّت عنوان HTTPS العام `https://api.ahmed1986y.com` في APK التالي عبر متغير بناء عام. أمّا رمز Cloudflare فيُحفظ كـ GitHub Secret ولا يُضمّن في التطبيق أو المستودع.

## سبب التحول إلى D1

أعاد Cloudflare خطأ وقت تشغيل `1101` عند إنشاء Durable Object في هذا الحساب؛ لذلك استُبدل بتخزين D1 المتاح بنفس رمز الصلاحيات. توثيق Cloudflare يوضح أن D1 يُنشأ عبر `wrangler d1 create` ويرتبط بالـ Worker من خلال binding؛ وتُنفَّذ الاستعلامات باستخدام `prepare().bind()` لتفادي حقن SQL. المصدر: [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/) و[D1 getting started](https://developers.cloudflare.com/d1/get-started/).
