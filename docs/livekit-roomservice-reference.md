# مرجع LiveKit لإدارة المشاركين

المصدر الرسمي: <https://docs.livekit.io/reference/other/roomservice-api/>، و<https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/>. تمت المراجعة في 27 أغسطس 2026.

تستخدم عمليات RoomService مسار Twirp التالي: `/twirp/livekit.RoomService/<MethodName>` مع طلب POST وترويسة `Authorization: Bearer <signed-token>`.

| الإجراء | واجهة LiveKit | الغرض في AH4 |
| --- | --- | --- |
| طرد عضو | `RemoveParticipant` | قطع اتصال العضو وإبطال رمز دخوله الحالي في LiveKit Cloud. |
| إسكات مسار | `GetParticipant` ثم `MutePublishedTrack` | البحث عن مسار الميكروفون أو الكاميرا ثم إسكات المسار المطلوب. |
| منع نشر جديد | `UpdateParticipant` | تقييد `can_publish_sources` وفق حالة الإسكات أو حظر الكاميرا. |

تتطلب هذه الواجهات امتياز `roomAdmin` في رمز خدمة قصير العمر على الخادم. لذلك لا تنتقل أسرار LiveKit أو رمز الخدمة إلى تطبيق Android.

## تهيئة Expo الأصلية

المصدر: <https://docs.livekit.io/transport/sdk-platforms/expo/>، تمت المراجعة في 27 أغسطس 2026.

توضح الوثائق أن Expo Go لا يدعم LiveKit لأن الميزة تعتمد على وحدات أصلية، وأن إصدار Android مستقل أو development build مطلوب. كما تطلب تهيئة Expo الإضافتين `@livekit/react-native-expo-plugin` و`@config-plugins/react-native-webrtc` واستدعاء `registerGlobals()` قبل إنشاء اتصال الغرفة. يبدأ نموذج LiveKit جلسة الصوت عبر `AudioSession.startAudioSession()`، ثم يمرر `connect` و`audio` و`video` إلى `LiveKitRoom`، ويشغّل الكاميرا والميكروفون عند طلب المستخدم.
