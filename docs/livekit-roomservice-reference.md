# مرجع LiveKit لإدارة المشاركين

المصدر الرسمي: <https://docs.livekit.io/reference/other/roomservice-api/>، و<https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/>. تمت المراجعة في 27 أغسطس 2026.

تستخدم عمليات RoomService مسار Twirp التالي: `/twirp/livekit.RoomService/<MethodName>` مع طلب POST وترويسة `Authorization: Bearer <signed-token>`.

| الإجراء | واجهة LiveKit | الغرض في AH4 |
| --- | --- | --- |
| طرد عضو | `RemoveParticipant` | قطع اتصال العضو وإبطال رمز دخوله الحالي في LiveKit Cloud. |
| إسكات مسار | `GetParticipant` ثم `MutePublishedTrack` | البحث عن مسار الميكروفون أو الكاميرا ثم إسكات المسار المطلوب. |
| منع نشر جديد | `UpdateParticipant` | تقييد `can_publish_sources` وفق حالة الإسكات أو حظر الكاميرا. |

تتطلب هذه الواجهات امتياز `roomAdmin` في رمز خدمة قصير العمر على الخادم. لذلك لا تنتقل أسرار LiveKit أو رمز الخدمة إلى تطبيق Android.
