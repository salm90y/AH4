import { AccessToken } from "livekit-server-sdk";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { hashRoomPassword, verifyRoomPassword } from "./room-security";

const participantIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{8,96}$/);
const roomCodeSchema = z.string().regex(/^AH4-[A-F0-9]{8}$/);

function assertLiveKitConfiguration() {
  if (!ENV.livekitUrl || !ENV.livekitApiKey || !ENV.livekitApiSecret) {
    throw new Error("إعدادات LiveKit غير مكتملة على الخادم");
  }
}

async function createRoomToken({
  code,
  participantId,
  displayName,
  host,
}: {
  code: string;
  participantId: string;
  displayName: string;
  host: boolean;
}) {
  assertLiveKitConfiguration();
  const token = new AccessToken(ENV.livekitApiKey, ENV.livekitApiSecret, {
    identity: participantId,
    name: displayName,
    ttl: "2h",
  });
  token.addGrant({
    room: code,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    roomAdmin: host,
  });

  return {
    serverUrl: ENV.livekitUrl,
    token: await token.toJwt(),
  };
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  watchRooms: router({
    create: publicProcedure
      .input(z.object({
        name: z.string().trim().min(2).max(120),
        password: z.string().max(128),
        participantId: participantIdSchema,
        displayName: z.string().trim().min(1).max(40),
      }))
      .mutation(async ({ input }) => {
        const code = `AH4-${randomBytes(4).toString("hex").toUpperCase()}`;
        const passwordDigest = hashRoomPassword(input.password);
        const room = await db.createWatchRoom({
          code,
          name: input.name,
          hostParticipantId: input.participantId,
          ...passwordDigest,
        });
        if (!room) throw new Error("تعذر إنشاء الغرفة");

        return {
          code: room.code,
          name: room.name,
          passwordProtected: Boolean(room.passwordHash),
          host: true,
          ...(await createRoomToken({
            code: room.code,
            participantId: input.participantId,
            displayName: input.displayName,
            host: true,
          })),
        };
      }),
    join: publicProcedure
      .input(z.object({
        code: roomCodeSchema,
        password: z.string().max(128),
        participantId: participantIdSchema,
        displayName: z.string().trim().min(1).max(40),
      }))
      .mutation(async ({ input }) => {
        const room = await db.getWatchRoomByCode(input.code);
        if (!room) throw new Error("الغرفة غير موجودة أو انتهت صلاحيتها");
        if (!verifyRoomPassword(input.password, room)) {
          throw new Error("كلمة مرور الغرفة غير صحيحة");
        }

        const host = room.hostParticipantId === input.participantId;
        return {
          code: room.code,
          name: room.name,
          passwordProtected: Boolean(room.passwordHash),
          host,
          ...(await createRoomToken({
            code: room.code,
            participantId: input.participantId,
            displayName: input.displayName,
            host,
          })),
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
