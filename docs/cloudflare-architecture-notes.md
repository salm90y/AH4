# ملاحظات بنية Cloudflare لـ AH4 Watch Party

## نتائج مؤكدة

- يمكن ربط Worker بنطاق أو نطاق فرعي مخصص ضمن منطقة Cloudflare، ويُناسب ذلك عندما يكون Worker هو خادم أصل التطبيق. المصدر: [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
- يمكن أن يعمل Durable Object كخادم WebSocket، وأن ينسّق عدة عملاء في الغرفة نفسها؛ وتوصي Cloudflare بواجهة WebSocket ذات السبات للحفاظ على الاتصالات في فترات الخمول. المصدر: [Use WebSockets with Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## التصميم المبدئي المقترح

| الطبقة | خدمة Cloudflare | الاستخدام في AH4 |
| --- | --- | --- |
| واجهة API | Worker على `api.ahmed1986y.com` | إنشاء الغرف، الانضمام إليها، والتحقق من كلمة المرور المجزأة. |
| الحالة الفورية | Durable Object واحد لكل غرفة | المزامنة، الحضور، الدردشة، ورسائل WebSocket. |
| بيانات الغرفة الأساسية | Durable Object واحد لكل غرفة | بيانات الغرفة وكلمة المرور المجزأة في تخزين خاص ومتسق بقوة، من دون أسرار داخل APK. |
| D1 مستقبلاً | D1 اختياري | تقارير الغرف أو سجل الرسائل الطويل عند الحاجة، مع إبقاء بنية الإصدار الأساسي خفيفة. |
| الملفات عند الحاجة | R2 اختياري | ملفات M3U المرفوعة إذا تقرر حفظها مركزيًا. |

## قيود التنفيذ

سيُثبّت عنوان HTTPS العام `https://api.ahmed1986y.com` في APK التالي عبر متغير بناء عام. أمّا رمز Cloudflare فيُحفظ كـ GitHub Secret ولا يُضمّن في التطبيق أو المستودع.
