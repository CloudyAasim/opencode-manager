import { z } from "zod";

export const SSESubscribeSchema = z.object({
  clientId: z.string().min(1),
  directories: z.array(z.string()),
});

export type SSESubscribeRequest = z.infer<typeof SSESubscribeSchema>;
